"""Astra's Telegram presentation layer; untrusted values are never parsed as markup.

Aiogram renders explicit MessageEntity objects. Call ``as_kwargs()`` when sending:
its ``parse_mode=None`` also overrides any bot-wide HTML/Markdown default.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, User
from aiogram.utils.formatting import (
    BlockQuote,
    Bold,
    Code,
    Italic,
    Text,
    TextMention,
    as_key_value,
    as_list,
    as_section,
)

ErrorCategory = Literal["validation", "permission", "conflict", "telegram"]
HelpPage = Literal["home", "moderation", "setup"]
HELP_CALLBACKS: dict[str, HelpPage] = {
    "astra:help:home": "home",
    "astra:help:moderation": "moderation",
    "astra:help:setup": "setup",
}

_ACTIONS = {
    "warn": ("🟡", "Предупреждение выдано", "Выдать предупреждение"),
    "unwarn": ("↩️", "Предупреждение снято", "Снять предупреждение"),
    "ban": ("⛔", "Участник заблокирован", "Заблокировать участника"),
    "unban": ("🔓", "Блокировка снята", "Снять блокировку"),
    "mute": ("🔇", "Сообщения ограничены", "Ограничить сообщения"),
    "unmute": ("🔊", "Ограничение сообщений снято", "Снять ограничение сообщений"),
    "kick": ("🚪", "Участник исключён", "Исключить участника"),
}

_FAILURES = {
    "telegram_forbidden": "У Astra нет доступа или необходимых прав в Telegram.",
    "telegram_rejected": "Telegram отклонил запрос. Проверьте права бота и статус участника.",
    "telegram_rate_limit": "Telegram ограничил частоту запросов. Проверьте дело перед повтором.",
    "telegram_not_confirmed": "Telegram не подтвердил действие. Проверьте участника и журнал.",
    "telegram_error": "Telegram не подтвердил выполнение. Проверьте участника и журнал.",
    "bot_forbidden": "Выдайте Astra право ограничивать участников в настройках группы.",
    "actor_forbidden": "У модератора нет необходимых прав Telegram.",
    "protected_target": "Владелец и администраторы чата защищены от наказаний.",
    "missing_permissions": "Не удалось получить стандартные права чата.",
}


def _section(title: Text, *body: Text | str) -> Text:
    return as_section(title, as_list(*body))


def help_message(page: HelpPage = "home") -> Text:
    """Supported commands only, with copyable examples rather than dead buttons."""
    if page == "home":
        return as_list(
            Text("✦ ", Bold("ASTRA"), "\n", "Ваше сообщество. Под вашим контролем."),
            "Модерация, защита и журнал действий в одном пространстве.",
            _section(
                Bold("С чего начнём?"),
                "🛡 Команды — предупреждения, ограничения и блокировки.",
                "⚙ Подключение — настройка Astra в вашей группе.",
            ),
            Italic("Права проверяются в Telegram. Каждое действие сохраняется в журнале."),
            sep="\n\n",
        )
    if page == "setup":
        return as_list(
            Text("⚙️ ", Bold("Подключение Astra")),
            _section(
                Bold("Три простых шага"),
                "1. Добавьте Astra в вашу группу.",
                "2. Выдайте права администратора: удаление сообщений и блокировка участников.",
                Text(
                    "3. Отправьте ", Code("/setup"), " в группе от своего профиля администратора."
                ),
            ),
            "Если Mini App настроен через BotFather, откройте его кнопкой меню бота.",
            Italic("Команда /setup проверяет реальные права и сохраняет текущие настройки."),
            sep="\n\n",
        )
    return as_list(
        Text("🛡️ ", Bold("Модерация Astra")),
        _section(
            Bold("Команды"),
            Text(Code("/warn причина"), " — выдать предупреждение"),
            Text(Code("/unwarn причина"), " — снять предупреждение"),
            Text(Code("/mute 30m причина"), " — ограничить сообщения"),
            Text(Code("/unmute причина"), " — снять ограничение"),
            Text(Code("/ban 7d причина"), " — временно заблокировать"),
            Text(Code("/ban причина"), " — заблокировать без срока"),
            Text(Code("/unban причина"), " — снять блокировку"),
            Text(Code("/kick причина"), " — исключить с возможностью вернуться"),
        ),
        _section(
            Bold("Как использовать"),
            "Отправляйте команду ответом на сообщение участника.",
            Text(
                "Срок: ",
                Code("30m"),
                " — минуты · ",
                Code("2h"),
                " — часы · ",
                Code("7d"),
                " — дни.",
            ),
            "Для временного наказания: от 1 минуты до 365 дней.",
        ),
        Italic("Права проверяются в Telegram. Каждое действие сохраняется в журнале."),
        sep="\n\n",
    )


def help_keyboard(page: HelpPage = "home") -> InlineKeyboardMarkup:
    """Every callback maps to a real, read-only handler; no guessed web-app URLs."""
    buttons = []
    if page != "moderation":
        buttons.append(
            InlineKeyboardButton(text="🛡 Модерация", callback_data="astra:help:moderation")
        )
    if page != "setup":
        buttons.append(InlineKeyboardButton(text="⚙ Подключение", callback_data="astra:help:setup"))
    rows = [buttons]
    if page != "home":
        rows.append([InlineKeyboardButton(text="← Назад", callback_data="astra:help:home")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def setup_message(title: str, chat_id: int) -> Text:
    return as_list(
        Text("✅ ", Bold("Чат подключён к Astra")),
        Text(
            Bold(" ".join(title.split())[:255]), "\n", as_key_value("ID чата", Code(str(chat_id)))
        ),
        "Права администратора подтверждены. Текущие настройки сохранены.",
        _section(
            Bold("Следующий шаг"),
            Text("Посмотрите команды в ", Code("/help"), "."),
            "Если Mini App настроен через BotFather, откройте его кнопкой меню бота.",
        ),
        sep="\n\n",
    )


def anonymous_admin_message() -> Text:
    return error_message(
        "Используйте личный профиль администратора, не анонимный режим.",
        category="permission",
    )


def reply_required_message() -> Text:
    return as_list(
        Text("↩️ ", Bold("Выберите участника")),
        "Отправьте команду ответом на сообщение участника.",
        Text("Например: ", Code("/mute 30m повторный флуд")),
        Italic("Сообщения от имени канала или группы не подходят."),
        sep="\n\n",
    )


def error_message(
    detail: str,
    *,
    category: ErrorCategory = "validation",
    retry_after: int | None = None,
) -> Text:
    icon, title, hint = {
        "validation": ("✏️", "Проверьте команду", "Примеры и доступные команды: /help"),
        "permission": ("🔐", "Недостаточно прав", "Проверьте права профиля и Astra в группе."),
        "conflict": (
            "🕓",
            "Действие требует проверки",
            "Посмотрите текущее наказание в журнале перед повтором команды.",
        ),
        "telegram": (
            "⚠️",
            "Telegram не подтвердил запрос",
            "Проверьте журнал и текущее состояние участника.",
        ),
    }[category]
    parts: list[Text | str] = [Text(icon, " ", Bold(title)), detail]
    if retry_after is not None and retry_after > 0:
        parts.append(as_key_value("Повторный запрос не ранее чем через", f"{retry_after} сек."))
    parts.append(Italic(hint))
    return as_list(*parts, sep="\n\n")


def _person(person: User) -> Text:
    # Telegram gives us a real user object. Keep its label on one readable line;
    # names and reasons remain literal text even when they contain HTML/Markdown.
    name = " ".join(person.full_name.split())[:128] or "Участник"
    return Text(TextMention(name, user=person), " · ", Code(str(person.id)))


def _deadline(value: datetime) -> str:
    # Database timestamps are UTC; SQLite may return them without tzinfo.
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return aware.strftime("%d.%m.%Y, %H:%M UTC")


def moderation_message(
    *,
    kind: str,
    status: str,
    case_id: str,
    target: User,
    actor: User,
    reason: str,
    expires_at: datetime | None = None,
    error_code: str | None = None,
) -> Text:
    """The persisted outcome controls every success label; network doubt stays explicit."""
    icon, success_title, action = _ACTIONS.get(kind, ("🛡️", "Действие выполнено", "Модерация"))
    outcome: Text
    if status == "applied":
        header = Text(icon, " ", Bold(success_title))
        outcome = Italic("Действие выполнено и записано в журнал.")
    elif status in {"pending", "revoking"}:
        header = Text("🕓 ", Bold("Действие обрабатывается"))
        outcome = Text("Повторный запрос не нужен. Результат пока не подтверждён.")
    elif status == "revoked":
        header = Text("↩️ ", Bold("Наказание уже отменено"))
        outcome = Text("Это дело отменено. Исходное действие повторно не выполнялось.")
    elif status == "expired":
        header = Text("⌛ ", Bold("Срок наказания истёк"))
        outcome = Text("Это дело завершено по сроку. Исходное действие повторно не выполнялось.")
    elif status == "unknown":
        header = Text("⚠️ ", Bold("Результат требует проверки"))
        outcome = Text(
            "Telegram не подтвердил результат. Проверьте участника и дело в журнале.\n",
            Bold("Не повторяйте действие автоматически."),
        )
    else:
        header = Text("⚠️ ", Bold("Действие не выполнено"))
        outcome = Text(
            _FAILURES.get(
                error_code or "", "Подтверждения выполнения нет. Проверьте дело в журнале."
            )
        )
    details = [
        as_key_value("Участник", _person(target)),
        as_key_value("Модератор", _person(actor)),
    ]
    if status != "applied":
        details.append(as_key_value("Действие", action))
    if expires_at is not None and kind in {"ban", "mute"}:
        details.append(as_key_value("Срок до", _deadline(expires_at)))
    elif kind == "ban":
        details.append(as_key_value("Срок", "Без ограничения"))
    footer = as_key_value("Дело", Code(case_id[:8]))
    if status not in {"applied", "pending", "unknown", "revoking", "revoked", "expired"}:
        footer = Text(footer, "\n", as_key_value("Код", Code(error_code or status)))
    return as_list(
        header,
        as_list(*details),
        _section(Bold("Причина"), BlockQuote(reason)),
        outcome,
        footer,
        sep="\n\n",
    )
