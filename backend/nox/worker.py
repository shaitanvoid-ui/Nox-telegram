"""Durable database update queue and punishment expiration worker.

A claimed update is never replayed after a crash: an external Telegram effect
may already have happened. Such receipts become `unknown` for manual review.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from aiogram import Bot, Dispatcher
from aiogram.types import Update
from redis.asyncio import Redis
from sqlalchemy import delete, or_, select, update

from nox.bot import build_dispatcher, make_bot
from nox.config import get_settings
from nox.db import Database
from nox.models import (
    AuditEvent,
    AutomationExecution,
    Chat,
    ModerationCase,
    ProcessedUpdate,
    ShieldEvent,
)
from nox.moderation import ConflictError, ModerationService
from nox.shield import RedisCounter, ShieldEngine
from nox.telegram import DemoTelegramGateway, TelegramGateway

logger = logging.getLogger(__name__)


async def claim_update(db: Database) -> tuple[int, dict[str, Any]] | None:
    now = datetime.now(UTC)
    async with db.sessions() as session:
        incoming = await session.scalar(
            select(ProcessedUpdate)
            .where(
                ProcessedUpdate.status == "pending",
                or_(
                    ProcessedUpdate.next_attempt_at.is_(None),
                    ProcessedUpdate.next_attempt_at <= now,
                ),
            )
            .order_by(ProcessedUpdate.update_id)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if incoming is None:
            return None
        result = await session.execute(
            update(ProcessedUpdate)
            .where(
                ProcessedUpdate.update_id == incoming.update_id,
                ProcessedUpdate.status == "pending",
            )
            .values(status="processing", attempts=ProcessedUpdate.attempts + 1, claimed_at=now)
        )
        await session.commit()
        if result.rowcount != 1:  # type: ignore[attr-defined]
            return None
        return incoming.update_id, incoming.payload


async def process_next(db: Database, dispatcher: Dispatcher, bot: Bot) -> bool:
    item = await claim_update(db)
    if item is None:
        return False
    update_id, payload = item
    status, error = "done", None
    try:
        await dispatcher.feed_update(bot, Update.model_validate(payload))
    except asyncio.CancelledError:
        # Receipt stays processing; recovery marks unknown, never replays it.
        raise
    except Exception as exc:
        # A partially dispatched update may have emitted a Telegram effect. We
        # intentionally do not retry blindly, including on unknown DB errors.
        status, error = "unknown", type(exc).__name__[:200]
        logger.error(
            "update_processing_unknown", extra={"update_id": update_id, "error_type": error}
        )
    async with db.sessions() as session:
        await session.execute(
            update(ProcessedUpdate)
            .where(
                ProcessedUpdate.update_id == update_id,
                ProcessedUpdate.status == "processing",
            )
            .values(status=status, error=error, payload={})
        )
        await session.commit()
    return True


async def recover_stale(db: Database, *, minutes: int = 5) -> None:
    cutoff = datetime.now(UTC) - timedelta(minutes=minutes)
    async with db.sessions() as session:
        await session.execute(
            update(ProcessedUpdate)
            .where(
                ProcessedUpdate.status == "processing",
                ProcessedUpdate.claimed_at < cutoff,
            )
            .values(status="unknown", error="worker_interrupted", payload={})
        )
        # A crash between intent and finalization can leave a case pending.
        await session.execute(
            update(ModerationCase)
            .where(
                ModerationCase.status.in_(["pending", "revoking"]),
                ModerationCase.operation_started_at < cutoff,
            )
            .values(status="unknown", error_code="worker_interrupted")
        )
        await session.execute(
            update(AutomationExecution)
            .where(
                AutomationExecution.status == "pending",
                AutomationExecution.created_at < cutoff,
            )
            .values(status="unknown")
        )
        # Completed receipts retain the update ID for replay defense, not content.
        await session.execute(
            update(ProcessedUpdate)
            .where(
                ProcessedUpdate.status.in_(["done", "failed", "unknown"]),
            )
            .values(payload={})
        )
        # Failed pending payloads cannot accumulate personal data indefinitely.
        await session.execute(
            update(ProcessedUpdate)
            .where(
                ProcessedUpdate.status == "pending",
                ProcessedUpdate.created_at < datetime.now(UTC) - timedelta(days=2),
            )
            .values(status="failed", error="queue_expired", payload={})
        )
        await session.commit()


async def enforce_retention(db: Database) -> None:
    """Honor per-chat log retention; case history remains durable for appeals."""
    async with db.sessions() as session:
        chats = (await session.execute(select(Chat.id, Chat.privacy_retention_days))).all()
        for chat_id, days in chats:
            cutoff = datetime.now(UTC) - timedelta(days=max(1, days))
            await session.execute(
                delete(ShieldEvent).where(
                    ShieldEvent.chat_id == chat_id,
                    ShieldEvent.created_at < cutoff,
                )
            )
            await session.execute(
                delete(AuditEvent).where(
                    AuditEvent.chat_id == chat_id,
                    AuditEvent.created_at < cutoff,
                )
            )
        await session.commit()


async def expire_due(db: Database, moderation: ModerationService) -> int:
    async with db.sessions() as session:
        ids = (
            await session.scalars(
                select(ModerationCase.id)
                .where(
                    ModerationCase.status == "applied",
                    ModerationCase.kind.in_(["ban", "mute"]),
                    ModerationCase.expires_at <= datetime.now(UTC),
                )
                .order_by(ModerationCase.expires_at)
                .limit(100)
            )
        ).all()
    processed = 0
    for case_id in ids:
        try:
            await moderation.expire(case_id)
            processed += 1
        except ConflictError:
            continue
    return processed


async def run() -> None:
    settings = get_settings()
    db = Database(settings.database_url)
    bot = make_bot(settings) if settings.mode == "production" else None
    gateway = TelegramGateway(bot) if bot is not None else DemoTelegramGateway()
    redis: Redis = Redis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2)
    moderation = ModerationService(db, gateway)
    dispatcher = (
        build_dispatcher(db, moderation, gateway, ShieldEngine(cast(RedisCounter, redis)))
        if isinstance(gateway, TelegramGateway)
        else None
    )
    ticks = 0
    try:
        while True:
            try:
                if ticks % 30 == 0:
                    await recover_stale(db)
                    await expire_due(db, moderation)
                if ticks % 3600 == 0:
                    await enforce_retention(db)
                processed = await process_next(db, dispatcher, bot) if dispatcher and bot else False
                ticks += 1
                if not processed:
                    await asyncio.sleep(1)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error("worker_unavailable", extra={"error_type": type(exc).__name__})
                await asyncio.sleep(3)
    finally:
        await redis.aclose()
        await gateway.close()
        await db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
