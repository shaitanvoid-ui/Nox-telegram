import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from nox.bot import enqueue_update, parse_command
from nox.db import Base, Database
from nox.models import ProcessedUpdate
from nox.worker import claim_update, process_next, recover_stale
from sqlalchemy import func, select


@pytest.fixture
async def queue_db(tmp_path: Path) -> AsyncIterator[Database]:
    db = Database(f"sqlite+aiosqlite:///{tmp_path / 'queue.db'}")
    async with db.engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield db
    await db.close()


async def test_durable_duplicate_update_receipt(queue_db: Database) -> None:
    results = await asyncio.gather(
        *[enqueue_update(queue_db, {"update_id": 42}) for _ in range(10)]
    )
    assert sum(results) == 1
    async with queue_db.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(ProcessedUpdate)) == 1


async def test_only_one_worker_claims_update(queue_db: Database) -> None:
    await enqueue_update(queue_db, {"update_id": 42})
    results = await asyncio.gather(*[claim_update(queue_db) for _ in range(8)])
    assert sum(item is not None for item in results) == 1
    assert await claim_update(queue_db) is None


async def test_partial_dispatch_failure_is_unknown_not_replayed(queue_db: Database) -> None:
    await enqueue_update(queue_db, {"update_id": 42})
    dispatcher = AsyncMock()
    dispatcher.feed_update.side_effect = RuntimeError("sensitive raw failure")
    assert await process_next(queue_db, dispatcher, AsyncMock()) is True
    assert await process_next(queue_db, dispatcher, AsyncMock()) is False
    async with queue_db.sessions() as session:
        receipt = await session.get(ProcessedUpdate, 42)
        assert receipt is not None
        assert receipt.status == "unknown"
        assert receipt.error == "RuntimeError"
        assert receipt.payload == {}
    assert dispatcher.feed_update.call_count == 1


async def test_crash_recovery_does_not_repeat_ambiguous_effect(queue_db: Database) -> None:
    async with queue_db.sessions() as session:
        session.add(
            ProcessedUpdate(
                update_id=42,
                payload={"update_id": 42},
                status="processing",
                claimed_at=datetime.now(UTC) - timedelta(minutes=10),
            )
        )
        await session.commit()
    await recover_stale(queue_db)
    assert await claim_update(queue_db) is None
    async with queue_db.sessions() as session:
        receipt = await session.get(ProcessedUpdate, 42)
        assert receipt is not None
        assert receipt.status == "unknown" and receipt.payload == {}


@pytest.mark.parametrize(
    "text,expected",
    [
        ("/mute 30m флуд", ("mute", "флуд", 30)),
        ("/ban@nox_bot 2d мошенничество", ("ban", "мошенничество", 2880)),
        ("/warn нарушение правил", ("warn", "нарушение правил", None)),
        ("/mute 1ч флуд", ("mute", "флуд", 60)),
    ],
)
def test_moderation_command_parser(text: str, expected: tuple[str, str, int | None]) -> None:
    assert parse_command(text) == expected


@pytest.mark.parametrize(
    "text", ["", "/mute причина", "/warn x", "/ban 999999d spam", "/unknown text"]
)
def test_invalid_command_parser(text: str) -> None:
    with pytest.raises(ValueError):
        parse_command(text)
