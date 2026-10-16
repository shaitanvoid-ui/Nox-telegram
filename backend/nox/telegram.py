"""Telegram boundary: live authorization, error classification and explicit demo adapter.

Do not retry an ambiguous network failure: Telegram may already have applied it.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any, Protocol

from aiogram import Bot
from aiogram.exceptions import (
    TelegramAPIError,
    TelegramBadRequest,
    TelegramForbiddenError,
    TelegramNetworkError,
    TelegramRetryAfter,
    TelegramServerError,
)
from aiogram.types import ChatPermissions


class TelegramGatewayError(Exception):
    """A safe, token-free error suitable for persisting alongside an action."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
        ambiguous: bool = False,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.ambiguous = ambiguous
        self.retry_after = retry_after


class Gateway(Protocol):
    async def authorize(self, chat_id: int, actor_id: int, target_id: int, action: str) -> None: ...

    async def perform(
        self,
        action: str,
        chat_id: int,
        target_id: int,
        until_date: datetime | None = None,
    ) -> None: ...


async def _telegram_call(awaitable: Any, *, mutation: bool = False) -> Any:
    """Never persist raw Telegram exception strings (they may contain request data)."""
    try:
        return await awaitable
    except TelegramRetryAfter as exc:
        raise TelegramGatewayError(
            "telegram_rate_limit",
            "Telegram ограничил частоту запросов. Действие не подтверждено.",
            retryable=True,
            retry_after=exc.retry_after,
        ) from None
    except TelegramForbiddenError:
        raise TelegramGatewayError(
            "telegram_forbidden", "У бота нет доступа или необходимых прав в Telegram."
        ) from None
    except TelegramBadRequest:
        raise TelegramGatewayError(
            "telegram_rejected", "Telegram отклонил действие. Проверьте права и участника."
        ) from None
    except (TelegramNetworkError, TelegramServerError, TimeoutError):
        raise TelegramGatewayError(
            "telegram_unknown" if mutation else "telegram_unavailable",
            "Ответ Telegram не получен; результат действия требует проверки."
            if mutation
            else "Telegram временно недоступен. Попробуйте позднее.",
            retryable=not mutation,
            ambiguous=mutation,
        ) from None
    except TelegramAPIError:
        raise TelegramGatewayError(
            "telegram_error", "Telegram не подтвердил выполнение действия."
        ) from None


def _status(member: Any) -> str:
    status = member.status
    return str(getattr(status, "value", status))


def _can_restrict(member: Any) -> bool:
    return _status(member) == "creator" or (
        _status(member) == "administrator" and bool(member.can_restrict_members)
    )


class TelegramGateway:
    def __init__(self, bot: Bot) -> None:
        self.bot = bot
        self._bot_id: int | None = None

    async def bot_id(self) -> int:
        if self._bot_id is None:
            self._bot_id = (await _telegram_call(self.bot.get_me())).id
        return self._bot_id

    async def assert_admin(self, chat_id: int, actor_id: int) -> Any:
        member = await _telegram_call(self.bot.get_chat_member(chat_id, actor_id))
        if _status(member) not in {"creator", "administrator"}:
            raise TelegramGatewayError(
                "actor_forbidden", "Команда доступна только администраторам Telegram-чата."
            )
        return member

    async def authorize(self, chat_id: int, actor_id: int, target_id: int, action: str) -> None:
        if chat_id >= 0:
            raise TelegramGatewayError("invalid_chat", "Модерация доступна только в группах.")
        if actor_id == target_id:
            raise TelegramGatewayError("self_target", "Нельзя применить наказание к себе.")
        bot_id = await self.bot_id()
        if target_id == bot_id:
            raise TelegramGatewayError("bot_target", "Нельзя применить наказание к NOX.")
        actor, target, bot_member = await asyncio.gather(
            _telegram_call(self.bot.get_chat_member(chat_id, actor_id)),
            _telegram_call(self.bot.get_chat_member(chat_id, target_id)),
            _telegram_call(self.bot.get_chat_member(chat_id, bot_id)),
        )
        if not _can_restrict(actor):
            raise TelegramGatewayError(
                "actor_forbidden", "У администратора нет права ограничивать участников."
            )
        if _status(target) in {"creator", "administrator"}:
            raise TelegramGatewayError(
                "protected_target", "Администраторы и владелец чата защищены от наказаний."
            )
        if not _can_restrict(bot_member):
            raise TelegramGatewayError(
                "bot_forbidden", "Выдайте NOX право блокировки участников в Telegram."
            )

    async def perform(
        self,
        action: str,
        chat_id: int,
        target_id: int,
        until_date: datetime | None = None,
    ) -> None:
        if until_date is not None:
            if until_date.tzinfo is None:
                raise ValueError("until_date must be timezone aware")
            seconds = (until_date - datetime.now(UTC)).total_seconds()
            # Bot API treats <30 seconds or >366 days as permanent.
            if seconds < 31 or seconds > 365 * 86400:
                raise TelegramGatewayError(
                    "invalid_duration", "Временное наказание: от 31 секунды до 365 дней."
                )
        if action == "ban":
            request = self.bot.ban_chat_member(chat_id, target_id, until_date=until_date)
        elif action == "unban":
            # only_if_banned avoids accidentally removing an existing member.
            request = self.bot.unban_chat_member(chat_id, target_id, only_if_banned=True)
        elif action == "kick":
            # The documented default unban operation removes a current member while
            # allowing them to rejoin, without a two-request ban/unban partial failure.
            request = self.bot.unban_chat_member(chat_id, target_id, only_if_banned=False)
        elif action == "mute":
            request = self.bot.restrict_chat_member(
                chat_id,
                target_id,
                permissions=ChatPermissions(
                    can_send_messages=False,
                    can_send_audios=False,
                    can_send_documents=False,
                    can_send_photos=False,
                    can_send_videos=False,
                    can_send_video_notes=False,
                    can_send_voice_notes=False,
                    can_send_polls=False,
                    can_send_other_messages=False,
                    can_add_web_page_previews=False,
                    can_change_info=False,
                    can_invite_users=False,
                    can_pin_messages=False,
                    can_manage_topics=False,
                ),
                until_date=until_date,
                use_independent_chat_permissions=True,
            )
        elif action == "unmute":
            chat = await _telegram_call(self.bot.get_chat(chat_id))
            if chat.permissions is None:
                raise TelegramGatewayError(
                    "missing_permissions", "Не удалось получить стандартные права чата."
                )
            request = self.bot.restrict_chat_member(
                chat_id,
                target_id,
                permissions=chat.permissions,
                use_independent_chat_permissions=True,
            )
        elif action in {"warn", "unwarn"}:
            return  # Warnings are durable application records, not Bot API methods.
        else:
            raise TelegramGatewayError("unsupported_action", "Неизвестное действие модерации.")
        result = await _telegram_call(request, mutation=True)
        if result is not True:
            raise TelegramGatewayError("telegram_not_confirmed", "Telegram не подтвердил действие.")

    async def delete_message(self, chat_id: int, message_id: int) -> None:
        member = await _telegram_call(self.bot.get_chat_member(chat_id, await self.bot_id()))
        if _status(member) != "creator" and not (
            _status(member) == "administrator"
            and bool(getattr(member, "can_delete_messages", False))
        ):
            raise TelegramGatewayError(
                "bot_forbidden", "Выдайте NOX право удаления сообщений в Telegram."
            )
        result = await _telegram_call(self.bot.delete_message(chat_id, message_id), mutation=True)
        if result is not True:
            raise TelegramGatewayError("telegram_not_confirmed", "Telegram не подтвердил удаление.")

    async def close(self) -> None:
        await self.bot.session.close()


class DemoTelegramGateway:
    """Only constructed by explicit demo configuration. Never contacts Telegram."""

    def __init__(self) -> None:
        self.actions: list[tuple[str, int, int]] = []

    async def assert_admin(self, chat_id: int, actor_id: int) -> object:
        return object()

    async def authorize(self, chat_id: int, actor_id: int, target_id: int, action: str) -> None:
        if actor_id == target_id:
            raise TelegramGatewayError("self_target", "Нельзя применить наказание к себе.")

    async def perform(
        self,
        action: str,
        chat_id: int,
        target_id: int,
        until_date: datetime | None = None,
    ) -> None:
        self.actions.append((action, chat_id, target_id))

    async def close(self) -> None:
        return None
