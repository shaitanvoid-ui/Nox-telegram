"""Aiogram handlers and durable update ingestion; run `python -m nox.bot` for polling."""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import UTC, datetime
from typing import Any
from uuid import NAMESPACE_URL, uuid4, uuid5

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.exceptions import TelegramAPIError
from aiogram.filters import Command
from aiogram.types import Chat as TelegramChat
from aiogram.types import ChatMemberUpdated, Message, Update
from aiogram.types import User as TelegramUser
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError

from nox.automation_runtime import execute_automation
from nox.config import Settings, get_settings
from nox.db import Database
from nox.models import (
    AnalyticsAggregate,
    AuditEvent,
    Chat,
    ChatMember,
    ProcessedUpdate,
    ShieldEvent,
    ShieldModule,
    User,
)
from nox.moderation import ConflictError, ModerationService
from nox.security import AccessDenied
from nox.shield import ShieldDecision, ShieldEngine, ShieldMessage, ShieldPolicy
from nox.telegram import TelegramGateway, TelegramGatewayError, _telegram_call

logger = logging.getLogger(__name__)
SUPPORTED_MODULES = (
    "anti_spam",
    "anti_flood",
    "anti_raid",
    "anti_scam",
    "anti_link",
    "anti_duplicate",
    "anti_mention",
    "anti_bot",
    "join_guard",
    "edit_guard",
)
COMMANDS = {"warn", "unwarn", "ban", "unban", "mute", "unmute", "kick"}
_DURATION = re.compile(r"^([1-9]\d{0,5})(m|h|d|м|ч|д)$", re.IGNORECASE)


def parse_command(text: str) -> tuple[str, str, int | None]:
    parts = text.strip().split(maxsplit=1)
    if not parts:
        raise ValueError("Укажите команду и причину.")
    command = parts[0].removeprefix("/").split("@", 1)[0].lower()
    if command not in COMMANDS:
        raise ValueError("Неизвестная команда.")
    argument = parts[1].strip() if len(parts) > 1 else ""
    duration: int | None = None
    first, _, rest = argument.partition(" ")
    match = _DURATION.fullmatch(first)
    duration_like = first.lstrip("+-")[:1].isdigit() and any(
        character.isalpha() for character in first
    )
    if command in {"ban", "mute"} and match is None and duration_like:
        raise ValueError("Некорректный срок. Используйте 30m, 2h или 7d; от 1 минуты до 365 дней.")
    if match and command in {"ban", "mute"}:
        amount, unit = match.groups()
        duration = (
            int(amount) * {"m": 1, "м": 1, "h": 60, "ч": 60, "d": 1440, "д": 1440}[unit.lower()]
        )
        argument = rest.strip()
        if not 1 <= duration <= 525600:
            raise ValueError("Срок наказания: от 1 минуты до 365 дней.")
    if command == "mute" and duration is None:
        raise ValueError("Укажите срок: /mute 30m причина (m — минуты, h — часы, d — дни).")
    if not 3 <= len(argument) <= 1000:
        raise ValueError("Укажите понятную причину длиной от 3 до 1000 символов.")
    return command, argument, duration


async def enqueue_update(db: Database, payload: dict[str, Any]) -> bool:
    """Commit before acknowledging webhook/polling offset. Duplicate IDs are harmless."""
    parsed = Update.model_validate(payload)
    async with db.sessions() as session:
        session.add(ProcessedUpdate(update_id=parsed.update_id, payload=payload))
        try:
            await session.commit()
            return True
        except IntegrityError:
            await session.rollback()
            # Only an existing receipt is a duplicate; other integrity errors surface.
            if await session.get(ProcessedUpdate, parsed.update_id) is not None:
                return False
            raise


async def _upsert_person(
    db: Database, person: TelegramUser, chat_id: int | None = None, role: str | None = None
) -> None:
    dialect_insert = pg_insert if db.engine.dialect.name == "postgresql" else sqlite_insert
    async with db.sessions() as session:
        statement = (
            dialect_insert(User)
            .values(
                id=person.id,
                first_name=person.first_name[:128],
                username=person.username,
            )
            .on_conflict_do_update(
                index_elements=[User.id],
                set_={"first_name": person.first_name[:128], "username": person.username},
            )
        )
        await session.execute(statement)
        if chat_id is not None:
            membership = dialect_insert(ChatMember).values(
                chat_id=chat_id,
                user_id=person.id,
                role=role or "member",
            )
            if role:
                membership = membership.on_conflict_do_update(
                    index_elements=[ChatMember.chat_id, ChatMember.user_id],
                    set_={"role": role},
                )
            else:
                membership = membership.on_conflict_do_nothing(
                    index_elements=[ChatMember.chat_id, ChatMember.user_id],
                )
            await session.execute(membership)
        await session.commit()


async def onboard_chat(
    db: Database, gateway: TelegramGateway, chat: TelegramChat, actor: TelegramUser
) -> None:
    if chat.type not in {"group", "supergroup"}:
        raise ValueError("Добавьте NOX в группу и выполните /setup в этой группе.")
    live_actor = await gateway.assert_admin(chat.id, actor.id)
    await gateway.assert_admin(chat.id, await gateway.bot_id())
    count = await _telegram_call(gateway.bot.get_chat_member_count(chat.id))
    insert = pg_insert if db.engine.dialect.name == "postgresql" else sqlite_insert
    async with db.sessions() as session:
        await session.execute(
            insert(Chat)
            .values(
                id=chat.id,
                title=(chat.title or "Telegram community")[:255],
                member_count=count,
            )
            .on_conflict_do_update(
                index_elements=[Chat.id],
                set_={"title": (chat.title or "Telegram community")[:255], "member_count": count},
            )
        )
        for key in SUPPORTED_MODULES:
            await session.execute(
                insert(ShieldModule)
                .values(
                    chat_id=chat.id,
                    key=key,
                    enabled=key in {"anti_flood", "anti_duplicate", "anti_scam"},
                )
                .on_conflict_do_nothing(index_elements=[ShieldModule.chat_id, ShieldModule.key])
            )
        await session.commit()
    status = str(getattr(live_actor.status, "value", live_actor.status))
    await _upsert_person(db, actor, chat.id, "owner" if status == "creator" else "admin")
    async with db.sessions() as session:
        session.add(
            AuditEvent(
                id=str(uuid4()),
                chat_id=chat.id,
                actor_id=actor.id,
                action="chat.onboarded",
                detail="Telegram administrator verified; settings preserved",
            )
        )
        await session.commit()


async def _safe_reply(message: Message, text: str) -> None:
    try:
        await message.answer(text)
    except TelegramAPIError:
        # Reply failure must not replay an already committed moderation action.
        logger.warning("bot_reply_unavailable", extra={"chat_id": message.chat.id})


async def _record_violation(db: Database, message: Message, modules: list[str]) -> None:
    """A durable per-message marker makes multi-policy/edit counters exact."""
    insert = pg_insert if db.engine.dialect.name == "postgresql" else sqlite_insert
    marker_id = str(uuid5(NAMESPACE_URL, f"nox:violation:{message.chat.id}:{message.message_id}"))
    async with db.sessions() as session:
        result = await session.execute(
            insert(AuditEvent)
            .values(
                id=marker_id,
                chat_id=message.chat.id,
                actor_id=None,
                action="shield.message_flagged",
                detail=f"message:{message.message_id}; modules:{','.join(modules)}"[:2000],
            )
            .on_conflict_do_nothing(index_elements=[AuditEvent.id])
        )
        if result.rowcount == 1:  # type: ignore[attr-defined]
            await session.execute(
                insert(AnalyticsAggregate)
                .values(
                    chat_id=message.chat.id,
                    day=datetime.now(UTC).date().isoformat(),
                    violations=1,
                )
                .on_conflict_do_update(
                    index_elements=[AnalyticsAggregate.chat_id, AnalyticsAggregate.day],
                    set_={"violations": AnalyticsAggregate.violations + 1},
                )
            )
        await session.commit()


def build_dispatcher(
    db: Database,
    moderation: ModerationService,
    gateway: TelegramGateway,
    shield: ShieldEngine,
) -> Dispatcher:
    router = Router(name="nox")

    @router.message(Command("start", "help"))
    async def help_command(message: Message) -> None:
        await _safe_reply(
            message,
            "NOX — управление сообществом.\n"
            "В группе: /setup (для администратора). Выдайте боту права администратора.\n"
            "Ответьте на сообщение участника:\n"
            "/warn причина · /unwarn причина\n"
            "/ban [7d] причина · /unban причина\n"
            "/mute 30m причина · /unmute причина · /kick причина\n"
            "Все действия проверяют реальные права Telegram и сохраняются в журнале.",
        )

    @router.message(Command("setup"))
    async def setup_command(message: Message) -> None:
        if message.from_user is None or message.sender_chat is not None:
            await _safe_reply(
                message, "Используйте личный профиль администратора, не анонимный режим."
            )
            return
        try:
            await onboard_chat(db, gateway, message.chat, message.from_user)
        except (ValueError, TelegramGatewayError) as error:
            await _safe_reply(message, str(error))
            return
        await _safe_reply(
            message, "Чат подключён к NOX. Откройте Mini App через меню бота. Настройки сохранены."
        )

    @router.my_chat_member()
    async def bot_membership(event: ChatMemberUpdated) -> None:
        status = str(getattr(event.new_chat_member.status, "value", event.new_chat_member.status))
        if status != "administrator":
            return
        try:
            await onboard_chat(db, gateway, event.chat, event.from_user)
        except (ValueError, TelegramGatewayError):
            logger.info("bot_onboarding_needs_setup", extra={"chat_id": event.chat.id})

    @router.message(Command(*sorted(COMMANDS)))
    async def moderate_command(message: Message) -> None:
        actor = message.from_user
        target = message.reply_to_message.from_user if message.reply_to_message else None
        if actor is None or message.sender_chat is not None:
            await _safe_reply(
                message, "Используйте личный профиль администратора, не анонимный режим."
            )
            return
        if target is None or (message.reply_to_message and message.reply_to_message.sender_chat):
            await _safe_reply(message, "Отправьте команду ответом на сообщение участника.")
            return
        try:
            action, reason, duration = parse_command(message.text or "")
            # Sync only an actor verified by live Telegram; client claims never grant roles.
            await onboard_chat(db, gateway, message.chat, actor)
            await _upsert_person(db, target, message.chat.id)
            case = await moderation.execute(
                chat_id=message.chat.id,
                actor_id=actor.id,
                target_id=target.id,
                kind=action,
                reason=reason,
                duration_minutes=duration,
                idempotency_key=f"telegram:{message.chat.id}:{message.message_id}",
            )
        except (
            ValueError,
            PermissionError,
            AccessDenied,
            ConflictError,
            TelegramGatewayError,
        ) as error:
            await _safe_reply(
                message, error.message if isinstance(error, AccessDenied) else str(error)
            )
            return
        if case.status == "applied":
            await _safe_reply(
                message, f"Действие /{action} выполнено. Дело {case.id[:8]}.\nПричина: {reason}"
            )
        elif case.status == "unknown":
            await _safe_reply(
                message,
                "Telegram не подтвердил результат. Не повторяйте действие автоматически. "
                f"Дело {case.id[:8]} требует проверки.",
            )
        elif case.status == "pending":
            await _safe_reply(message, f"Действие уже обрабатывается. Дело {case.id[:8]}.")
        else:
            await _safe_reply(
                message,
                f"Действие не выполнено ({case.error_code or case.status}). Дело {case.id[:8]}.",
            )

    async def inspect_message(message: Message) -> None:
        actor = message.from_user
        if (
            actor is None
            or message.sender_chat is not None
            or message.chat.type not in {"group", "supergroup"}
        ):
            return
        async with db.sessions() as session:
            chat = await session.get(Chat, message.chat.id)
            if chat is None:
                return
            modules = (
                await session.scalars(
                    select(ShieldModule).where(
                        ShieldModule.chat_id == message.chat.id,
                        ShieldModule.enabled.is_(True),
                    )
                )
            ).all()
        await _upsert_person(db, actor, message.chat.id)
        # Re-check current Telegram status rather than trusting a stale local role.
        try:
            live = await _telegram_call(gateway.bot.get_chat_member(message.chat.id, actor.id))
        except TelegramGatewayError:
            return  # Fail open for automatic deletion when rights cannot be established.
        status = str(getattr(live.status, "value", live.status))
        role = "admin" if status in {"creator", "administrator"} else "member"
        decisions = await shield.evaluate(
            ShieldMessage(
                chat_id=message.chat.id,
                user_id=actor.id,
                text=message.text or message.caption or "",
                role=role,
                is_bot=actor.is_bot,
                is_edit=message.edit_date is not None,
                mention_count=sum(
                    1
                    for entity in (message.entities or message.caption_entities or [])
                    if str(getattr(entity.type, "value", entity.type))
                    in {"mention", "text_mention"}
                ),
                message_id=message.message_id,
                urls=tuple(
                    entity.url
                    for entity in (message.entities or message.caption_entities or [])
                    if entity.url is not None
                ),
            ),
            [ShieldPolicy(module.key, module.enabled, module.sensitivity) for module in modules],
        )
        if not decisions:
            return
        await _record_violation(db, message, [decision.module for decision in decisions])
        deleted = False
        automated = False
        for decision in decisions:
            outcome = "review"
            if decision.module in {"anti_flood", "anti_spam"}:
                automated = (
                    await execute_automation(
                        db,
                        gateway,
                        message.chat.id,
                        "flood",
                        f"message:{message.chat.id}:{message.message_id}",
                        actor.id,
                        count=decision.count,
                        message_id=message.message_id,
                    )
                    or automated
                )
                if automated:
                    outcome = "automation:see_execution_log"
            if decision.action == "delete" and not deleted and not automated:
                try:
                    await gateway.delete_message(message.chat.id, message.message_id)
                    deleted = True
                    outcome = "deleted"
                except TelegramGatewayError as error:
                    outcome = error.code
            async with db.sessions() as session:
                session.add(
                    ShieldEvent(
                        id=str(uuid4()),
                        chat_id=message.chat.id,
                        user_id=actor.id,
                        module=decision.module,
                        detail=f"{decision.reason} [{outcome}]"[:500],
                    )
                )
                await session.execute(
                    update(ShieldModule)
                    .where(
                        ShieldModule.chat_id == message.chat.id,
                        ShieldModule.key == decision.module,
                    )
                    .values(events=ShieldModule.events + 1)
                )
                await session.commit()

    @router.message(F.new_chat_members)
    async def new_members(message: Message) -> None:
        async with db.sessions() as session:
            if await session.get(Chat, message.chat.id) is None:
                return
            modules = {
                module.key: module
                for module in (
                    await session.scalars(
                        select(ShieldModule).where(ShieldModule.chat_id == message.chat.id)
                    )
                ).all()
            }
        for person in message.new_chat_members or []:
            await _upsert_person(db, person, message.chat.id)
            await execute_automation(
                db,
                gateway,
                message.chat.id,
                "member_join",
                f"join:{message.chat.id}:{message.message_id}:{person.id}",
                person.id,
            )
            decisions = []
            raid = modules.get("anti_raid")
            if raid and raid.enabled:
                alert = await shield.joins(message.chat.id, sensitivity=raid.sensitivity)
                if alert:
                    decisions.append(alert)
            guard = modules.get("join_guard")
            if guard and guard.enabled and person.is_bot:
                decisions.append(
                    ShieldDecision("join_guard", "Вступил бот. Требуется проверка администратором.")
                )
            async with db.sessions() as session:
                for decision in decisions:
                    session.add(
                        ShieldEvent(
                            id=str(uuid4()),
                            chat_id=message.chat.id,
                            user_id=person.id,
                            module=decision.module,
                            detail=decision.reason,
                        )
                    )
                    await session.execute(
                        update(ShieldModule)
                        .where(
                            ShieldModule.chat_id == message.chat.id,
                            ShieldModule.key == decision.module,
                        )
                        .values(events=ShieldModule.events + 1)
                    )
                await session.commit()

    @router.message()
    async def ordinary_message(message: Message) -> None:
        await inspect_message(message)
        # Daily aggregates contain counters only, never message bodies.
        async with db.sessions() as session:
            if await session.get(Chat, message.chat.id) is None:
                return
            insert = pg_insert if db.engine.dialect.name == "postgresql" else sqlite_insert
            await session.execute(
                insert(AnalyticsAggregate)
                .values(
                    chat_id=message.chat.id,
                    day=datetime.now(UTC).date().isoformat(),
                    messages=1,
                )
                .on_conflict_do_update(
                    index_elements=[AnalyticsAggregate.chat_id, AnalyticsAggregate.day],
                    set_={"messages": AnalyticsAggregate.messages + 1},
                )
            )
            await session.commit()

    @router.edited_message()
    async def edited_message(message: Message) -> None:
        await inspect_message(message)

    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    return dispatcher


def make_bot(settings: Settings) -> Bot:
    if settings.mode != "production" or not settings.bot_token:
        raise RuntimeError(
            "Реальный Telegram включается только NOX_MODE=production с безопасной конфигурацией."
        )
    return Bot(
        settings.bot_token, session=AiohttpSession(timeout=settings.telegram_timeout_seconds)
    )


async def poll() -> None:
    settings = get_settings()
    bot = make_bot(settings)
    db = Database(settings.database_url)
    offset: int | None = None
    try:
        await bot.delete_webhook(drop_pending_updates=False)
        while True:
            try:
                updates = await bot.get_updates(
                    offset=offset,
                    timeout=25,
                    allowed_updates=["message", "edited_message", "my_chat_member"],
                )
                for incoming in updates:
                    await enqueue_update(db, incoming.model_dump(mode="json", exclude_none=True))
                    offset = incoming.update_id + 1
            except TelegramAPIError:
                logger.warning("telegram_polling_unavailable")
                await asyncio.sleep(3)
    finally:
        await bot.session.close()
        await db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    try:
        asyncio.run(poll())
    except KeyboardInterrupt:
        pass
