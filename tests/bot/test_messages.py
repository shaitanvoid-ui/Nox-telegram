from datetime import UTC, datetime, timedelta, timezone

import pytest
from aiogram.types import User
from nox.bot_messages import (
    HELP_CALLBACKS,
    anonymous_admin_message,
    error_message,
    help_keyboard,
    help_message,
    moderation_message,
    reply_required_message,
    setup_message,
)


def person(user_id: int, name: str = "Участник") -> User:
    return User(id=user_id, is_bot=False, first_name=name)


def result(**overrides: object):
    values = {
        "kind": "mute",
        "status": "applied",
        "case_id": "52b3f60d-a24b-4b98-8647-67f252abf25e",
        "target": person(20),
        "actor": person(10, "Администратор"),
        "reason": "Повторный флуд",
        "expires_at": datetime(2026, 10, 17, 20, 30, tzinfo=UTC),
    }
    values.update(overrides)
    return moderation_message(**values)


def test_help_uses_rich_entities_and_only_supported_commands() -> None:
    rendered = help_message("moderation").as_kwargs()
    assert rendered["parse_mode"] is None
    assert "Astra" in rendered["text"]
    assert "/ban 7d причина" in rendered["text"]
    assert "/mute 30m причина" in rendered["text"]
    assert "предупреждение\n/unwarn" in rendered["text"]
    assert {entity.type for entity in rendered["entities"]} == {"bold", "italic", "code"}
    assert not any(entity.type in {"url", "text_link"} for entity in rendered["entities"])
    assert len(rendered["text"]) < 4096


@pytest.mark.parametrize("page", ["home", "moderation", "setup"])
def test_help_navigation_has_only_implemented_read_only_callbacks(page) -> None:
    markup = help_keyboard(page)
    for row in markup.inline_keyboard:
        assert row
        for button in row:
            assert button.callback_data in HELP_CALLBACKS
            assert not button.url and not button.web_app
    rendered = help_message(page).as_kwargs()["text"]
    assert len(rendered) < 4096
    if page == "home":
        assert len(rendered) < 450
    if page == "setup":
        assert "/setup" in rendered


@pytest.mark.parametrize(
    "kind,title",
    [
        ("warn", "Предупреждение выдано"),
        ("unwarn", "Предупреждение снято"),
        ("ban", "Участник заблокирован"),
        ("unban", "Блокировка снята"),
        ("mute", "Сообщения ограничены"),
        ("unmute", "Ограничение сообщений снято"),
        ("kick", "Участник исключён"),
    ],
)
def test_each_applied_action_has_an_unambiguous_title(kind: str, title: str) -> None:
    rendered = result(kind=kind).as_kwargs()
    assert title in rendered["text"]
    assert "Действие выполнено и записано в журнал." in rendered["text"]
    assert "52b3f60d" in rendered["text"]
    mentions = [entity for entity in rendered["entities"] if entity.type == "text_mention"]
    assert [entity.user.id for entity in mentions] == [20, 10]


@pytest.mark.parametrize(
    "status", ["unknown", "pending", "failed", "revoking", "revoked", "expired"]
)
def test_unconfirmed_states_never_use_success_copy(status: str) -> None:
    rendered = result(status=status, error_code="telegram_forbidden").as_kwargs()
    assert "Сообщения ограничены" not in rendered["text"]
    assert "Действие выполнено и записано в журнал." not in rendered["text"]
    if status == "unknown":
        assert "Telegram не подтвердил результат" in rendered["text"]
        assert "Не повторяйте действие автоматически" in rendered["text"]
    elif status in {"pending", "revoking"}:
        assert "Результат пока не подтверждён" in rendered["text"]
    elif status in {"revoked", "expired"}:
        assert "Исходное действие повторно не выполнялось" in rendered["text"]
        assert "Код:" not in rendered["text"]
    else:
        assert "Действие не выполнено" in rendered["text"]
        assert "У Astra нет доступа" in rendered["text"]


def test_reason_and_names_cannot_inject_html_markdown_or_links() -> None:
    reason = "<b>admin</b> [click](tg://user?id=999) & _secret_ 🧨"
    rendered = result(
        reason=reason,
        target=person(20, '<a href="https://evil.example">Owner</a>'),
        actor=person(10, "Admin\nПоддельная строка"),
    ).as_kwargs()
    assert reason in rendered["text"]
    assert '<a href="https://evil.example">Owner</a>' in rendered["text"]
    assert "Admin Поддельная строка" in rendered["text"]
    assert rendered["parse_mode"] is None
    assert not any(entity.type in {"url", "text_link"} for entity in rendered["entities"])
    quoted = [entity for entity in rendered["entities"] if entity.type == "blockquote"]
    assert len(quoted) == 1
    # Telegram offsets are UTF-16 code units, including the leading emoji.
    encoded = rendered["text"].encode("utf-16-le")
    entity = quoted[0]
    assert (
        encoded[entity.offset * 2 : (entity.offset + entity.length) * 2].decode("utf-16-le")
        == reason
    )


@pytest.mark.parametrize(
    "deadline",
    [
        datetime(2026, 10, 17, 20, 30),
        datetime(2026, 10, 17, 20, 30, tzinfo=UTC),
        datetime(2026, 10, 17, 23, 30, tzinfo=timezone(timedelta(hours=3))),
    ],
)
def test_deadline_is_explicit_utc_for_database_and_aware_timestamps(deadline: datetime) -> None:
    assert "17.10.2026, 20:30 UTC" in result(expires_at=deadline).as_kwargs()["text"]


def test_permanent_ban_and_non_timed_commands_do_not_imply_wrong_duration() -> None:
    assert "Без ограничения" in result(kind="ban", expires_at=None).as_kwargs()["text"]
    rendered = result(kind="warn", expires_at=None).as_kwargs()["text"]
    assert "Срок" not in rendered and "Без ограничения" not in rendered


def test_setup_does_not_claim_unconfigured_miniapp_or_reset_settings() -> None:
    rendered = setup_message("<b>Чат</b>\nНазвание", -1001).as_kwargs()
    assert "<b>Чат</b> Название" in rendered["text"]
    assert "Текущие настройки сохранены" in rendered["text"]
    assert "Если Mini App настроен" in rendered["text"]
    assert rendered["parse_mode"] is None
    assert not any(entity.type == "text_link" for entity in rendered["entities"])


def test_error_hierarchy_and_retry_hint_preserve_literal_detail() -> None:
    rendered = error_message(
        "<private> Ошибка & причина", category="telegram", retry_after=17
    ).as_kwargs()
    assert "Telegram не подтвердил запрос" in rendered["text"]
    assert "<private> Ошибка & причина" in rendered["text"]
    assert "17 сек." in rendered["text"]
    assert rendered["parse_mode"] is None
    assert "личный профиль" in anonymous_admin_message().as_kwargs()["text"]
    assert "ответом на сообщение" in reply_required_message().as_kwargs()["text"]


def test_longest_supported_reason_fits_telegram_message_limit() -> None:
    rendered = result(
        reason="🧨" * 1000,
        target=person(20, "я" * 128),
        actor=person(10, "я" * 128),
    ).as_kwargs()
    assert len(rendered["text"].encode("utf-16-le")) // 2 <= 4096
