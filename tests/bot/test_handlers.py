from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aiogram import Bot
from aiogram.exceptions import TelegramForbiddenError, TelegramNetworkError
from aiogram.methods import AnswerCallbackQuery, BanChatMember, EditMessageText, SendMessage
from aiogram.types import Update
from aiogram.types import User as TelegramUser
from nox.automation_runtime import execute_automation
from nox.bot import build_dispatcher, onboard_chat
from nox.bot_messages import help_message
from nox.db import Base, Database
from nox.models import (
    AnalyticsAggregate,
    AutomationExecution,
    AutomationRule,
    Chat,
    ChatMember,
    ModerationCase,
    ShieldModule,
)
from nox.moderation import ModerationService
from nox.shield import ShieldEngine
from nox.telegram import TelegramGateway
from sqlalchemy import select


@pytest.fixture
async def db(tmp_path: Path) -> AsyncIterator[Database]:
    database = Database(f"sqlite+aiosqlite:///{tmp_path / 'handlers.db'}")
    async with database.engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield database
    await database.close()


def provider() -> tuple[Bot, dict[int, SimpleNamespace]]:
    bot = Bot("999:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890")
    bot.session = AsyncMock()
    bot.get_me = AsyncMock(
        return_value=TelegramUser(
            id=999,
            is_bot=True,
            first_name="NOX",
            username="nox_bot",
        )
    )
    members = {
        10: SimpleNamespace(status="administrator", can_restrict_members=True),
        20: SimpleNamespace(status="member"),
        999: SimpleNamespace(
            status="administrator",
            can_restrict_members=True,
            can_delete_messages=True,
        ),
    }
    bot.get_chat_member = AsyncMock(side_effect=lambda chat_id, user_id: members[user_id])
    bot.get_chat_member_count = AsyncMock(return_value=42)
    bot.ban_chat_member = AsyncMock(return_value=True)
    bot.restrict_chat_member = AsyncMock(return_value=True)
    bot.delete_message = AsyncMock(return_value=True)
    return bot, members


def command_update(text: str, message_id: int = 100) -> Update:
    return Update.model_validate(
        {
            "update_id": message_id,
            "message": {
                "message_id": message_id,
                "date": 1730000000,
                "chat": {"id": -1001, "type": "supergroup", "title": "NOX test"},
                "from": {"id": 10, "first_name": "Admin", "is_bot": False},
                "text": text,
                "entities": [{"type": "bot_command", "offset": 0, "length": len(text.split()[0])}],
                "reply_to_message": {
                    "message_id": 99,
                    "date": 1730000000,
                    "chat": {"id": -1001, "type": "supergroup", "title": "NOX test"},
                    "from": {"id": 20, "first_name": "Member", "is_bot": False},
                    "text": "hello",
                },
            },
        }
    )


async def test_reply_ban_handler_uses_shared_service_and_deduplicates(db: Database) -> None:
    bot, _ = provider()
    gateway = TelegramGateway(bot)
    dispatcher = build_dispatcher(db, ModerationService(db, gateway), gateway, ShieldEngine(None))
    await dispatcher.feed_update(bot, command_update("/ban нарушение правил"))
    await dispatcher.feed_update(bot, command_update("/ban нарушение правил"))
    bot.ban_chat_member.assert_awaited_once()
    async with db.sessions() as session:
        cases = (await session.scalars(select(ModerationCase))).all()
        assert len(cases) == 1 and cases[0].status == "applied"
        assert (await session.get(ChatMember, (-1001, 10))).role == "admin"
    text = bot.session.call_args.args[1].text
    assert "выполнено" in text


async def test_forbidden_telegram_result_is_not_reported_as_success(db: Database) -> None:
    bot, _ = provider()
    bot.ban_chat_member.side_effect = TelegramForbiddenError(
        method=BanChatMember(chat_id=-1001, user_id=20),
        message="denied",
    )
    gateway = TelegramGateway(bot)
    dispatcher = build_dispatcher(db, ModerationService(db, gateway), gateway, ShieldEngine(None))
    await dispatcher.feed_update(bot, command_update("/ban нарушение правил"))
    async with db.sessions() as session:
        case = await session.scalar(select(ModerationCase))
        assert case.status == "failed" and case.error_code == "telegram_forbidden"
    assert "не выполнено" in bot.session.call_args.args[1].text


async def test_live_non_admin_cannot_onboard_or_moderate(db: Database) -> None:
    bot, members = provider()
    members[10] = SimpleNamespace(status="member")
    gateway = TelegramGateway(bot)
    dispatcher = build_dispatcher(db, ModerationService(db, gateway), gateway, ShieldEngine(None))
    await dispatcher.feed_update(bot, command_update("/ban нарушение правил"))
    bot.ban_chat_member.assert_not_awaited()
    async with db.sessions() as session:
        assert await session.get(Chat, -1001) is None
    assert "администраторам" in bot.session.call_args.args[1].text


async def test_three_warning_handlers_escalate_to_single_timed_mute(db: Database) -> None:
    bot, _ = provider()
    gateway = TelegramGateway(bot)
    dispatcher = build_dispatcher(db, ModerationService(db, gateway), gateway, ShieldEngine(None))
    for message_id in [101, 102, 103]:
        await dispatcher.feed_update(bot, command_update("/warn повторный флуд", message_id))
    bot.restrict_chat_member.assert_awaited_once()
    async with db.sessions() as session:
        mutes = (
            await session.scalars(select(ModerationCase).where(ModerationCase.kind == "mute"))
        ).all()
        assert len(mutes) == 1 and mutes[0].status == "applied" and mutes[0].expires_at


async def test_persisted_join_rule_executes_once_and_fresh_author_rights_are_enforced(
    db: Database,
) -> None:
    bot, members = provider()
    gateway = TelegramGateway(bot)
    incoming = command_update("/setup")
    await onboard_chat(db, gateway, incoming.message.chat, incoming.message.from_user)
    async with db.sessions() as session:
        session.add(
            AutomationRule(
                id="rule-welcome",
                chat_id=-1001,
                created_by=10,
                name="Welcome",
                trigger="member_join",
                action="welcome",
                conditions={},
            )
        )
        await session.commit()
    for _ in range(2):
        assert await execute_automation(db, gateway, -1001, "member_join", "join:1", 20)
    assert bot.session.call_count == 1
    members[10] = SimpleNamespace(status="member")
    await execute_automation(db, gateway, -1001, "member_join", "join:2", 20)
    assert bot.session.call_count == 1
    async with db.sessions() as session:
        executions = (
            await session.scalars(
                select(AutomationExecution).order_by(AutomationExecution.event_key)
            )
        ).all()
        assert [execution.status for execution in executions] == ["applied", "failed"]


async def test_shield_counts_one_violation_for_multiple_policies_and_repeated_edit(
    db: Database,
) -> None:
    bot, _ = provider()
    gateway = TelegramGateway(bot)
    setup = command_update("/setup").message
    await onboard_chat(db, gateway, setup.chat, setup.from_user)
    async with db.sessions() as session:
        for key in ["anti_link", "anti_scam", "edit_guard"]:
            module = await session.get(ShieldModule, (-1001, key))
            module.enabled = True
        await session.commit()
    dispatcher = build_dispatcher(db, ModerationService(db, gateway), gateway, ShieldEngine(None))
    payload = command_update("https://evil.example seed phrase").model_dump(
        mode="json",
        by_alias=True,
        exclude_none=True,
    )
    payload["message"]["from"] = {"id": 20, "is_bot": False, "first_name": "Member"}
    payload["message"]["entities"] = []
    incoming = Update.model_validate(payload)
    await dispatcher.feed_update(bot, incoming)
    edited = Update.model_validate(
        {
            "update_id": 101,
            "edited_message": {
                **incoming.message.model_dump(mode="json", by_alias=True, exclude_none=True),
                "edit_date": int(datetime.now(UTC).timestamp()),
            },
        }
    )
    await dispatcher.feed_update(bot, edited)
    async with db.sessions() as session:
        aggregate = await session.get(
            AnalyticsAggregate, (-1001, datetime.now(UTC).date().isoformat())
        )
        assert aggregate.violations == 1
        assert aggregate.messages == 1


async def test_help_message_sends_entities_and_a_working_navigation_menu(db: Database) -> None:
    bot, _ = provider()
    gateway = TelegramGateway(bot)
    dispatcher = build_dispatcher(db, ModerationService(db, gateway), gateway, ShieldEngine(None))
    await dispatcher.feed_update(bot, command_update("/start"))
    sent = bot.session.call_args.args[1]
    assert "ASTRA" in sent.text
    assert sent.entities and sent.parse_mode is None
    assert sent.link_preview_options.is_disabled
    assert sent.reply_markup.inline_keyboard[0][0].callback_data == "astra:help:moderation"
    bot.get_chat_member.assert_not_awaited()
    bot.ban_chat_member.assert_not_awaited()


def help_callback(
    data: str, text: str = "Предыдущая страница", *, inaccessible: bool = False
) -> Update:
    return Update.model_validate(
        {
            "update_id": 201,
            "callback_query": {
                "id": "help-callback",
                "from": {"id": 20, "first_name": "Member", "is_bot": False},
                "chat_instance": "test-group",
                "data": data,
                "message": {
                    "message_id": 200,
                    "date": 0 if inaccessible else 1730000000,
                    "chat": {"id": -1001, "type": "supergroup", "title": "Astra"},
                    "from": {"id": 999, "first_name": "Astra", "is_bot": True},
                    "text": text,
                },
            },
        }
    )


@pytest.mark.parametrize("page", ["home", "moderation", "setup"])
async def test_help_callback_acknowledges_and_edits_only_public_reference(
    db: Database, page: str
) -> None:
    bot, _ = provider()
    gateway = TelegramGateway(bot)
    dispatcher = build_dispatcher(db, ModerationService(db, gateway), gateway, ShieldEngine(None))
    await dispatcher.feed_update(bot, help_callback(f"astra:help:{page}"))
    calls = [call.args[1] for call in bot.session.call_args_list]
    assert len(calls) == 2
    assert isinstance(calls[0], AnswerCallbackQuery)
    assert isinstance(calls[1], EditMessageText)
    assert calls[1].entities and calls[1].parse_mode is None
    assert calls[1].link_preview_options.is_disabled
    bot.get_chat_member.assert_not_awaited()
    bot.ban_chat_member.assert_not_awaited()
    async with db.sessions() as session:
        assert await session.scalar(select(ModerationCase)) is None
        assert await session.get(Chat, -1001) is None


async def test_repeated_help_tap_is_acknowledged_without_redundant_edit(db: Database) -> None:
    bot, _ = provider()
    gateway = TelegramGateway(bot)
    dispatcher = build_dispatcher(db, ModerationService(db, gateway), gateway, ShieldEngine(None))
    await dispatcher.feed_update(
        bot, help_callback("astra:help:home", help_message().as_kwargs()["text"])
    )
    assert bot.session.call_count == 1
    assert isinstance(bot.session.call_args.args[1], AnswerCallbackQuery)


async def test_inaccessible_help_message_is_acknowledged_without_an_edit(db: Database) -> None:
    bot, _ = provider()
    gateway = TelegramGateway(bot)
    dispatcher = build_dispatcher(db, ModerationService(db, gateway), gateway, ShieldEngine(None))
    await dispatcher.feed_update(bot, help_callback("astra:help:home", inaccessible=True))
    assert bot.session.call_count == 1
    assert isinstance(bot.session.call_args.args[1], AnswerCallbackQuery)


async def test_unrecognized_callback_does_not_execute_any_action(db: Database) -> None:
    bot, _ = provider()
    gateway = TelegramGateway(bot)
    dispatcher = build_dispatcher(db, ModerationService(db, gateway), gateway, ShieldEngine(None))
    await dispatcher.feed_update(bot, help_callback("astra:ban:20"))
    bot.session.assert_not_called()
    bot.ban_chat_member.assert_not_awaited()


async def test_ambiguous_telegram_action_uses_review_message_without_success(db: Database) -> None:
    bot, _ = provider()
    bot.ban_chat_member.side_effect = TelegramNetworkError(
        method=BanChatMember(chat_id=-1001, user_id=20), message="connection dropped"
    )
    gateway = TelegramGateway(bot)
    dispatcher = build_dispatcher(db, ModerationService(db, gateway), gateway, ShieldEngine(None))
    await dispatcher.feed_update(bot, command_update("/ban <b>сомнительная</b> реклама"))
    reply = bot.session.call_args.args[1]
    assert "Результат требует проверки" in reply.text
    assert "Не повторяйте действие автоматически" in reply.text
    assert "Участник заблокирован" not in reply.text
    assert "<b>сомнительная</b> реклама" in reply.text
    assert reply.parse_mode is None and reply.entities
    async with db.sessions() as session:
        case = await session.scalar(select(ModerationCase))
        assert case.status == "unknown"


async def test_reply_failure_does_not_replay_committed_moderation(db: Database) -> None:
    bot, _ = provider()
    bot.session.side_effect = TelegramForbiddenError(
        method=SendMessage(chat_id=-1001, text="test"), message="cannot send messages"
    )
    gateway = TelegramGateway(bot)
    dispatcher = build_dispatcher(db, ModerationService(db, gateway), gateway, ShieldEngine(None))
    await dispatcher.feed_update(bot, command_update("/ban повторная реклама"))
    await dispatcher.feed_update(bot, command_update("/ban повторная реклама"))
    bot.ban_chat_member.assert_awaited_once()
    async with db.sessions() as session:
        cases = (await session.scalars(select(ModerationCase))).all()
        assert len(cases) == 1 and cases[0].status == "applied"
