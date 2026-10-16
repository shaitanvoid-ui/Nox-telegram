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
    "text",
    [
        "",
        "/mute причина",
        "/warn x",
        "/ban 999999d spam",
        "/unknown text",
        "/ban 0m spam",
        "/ban 1s spam",
        "/ban -1d spam",
        "/ban 2w spam",
        "/ban 1e6d spam",
        "/ban 0m, spam",
    ],
)
def test_invalid_command_parser(text: str) -> None:
    with pytest.raises(ValueError):
        parse_command(text)


async def test_stale_recovery_uses_operation_time_and_finalizes_automation(
    queue_db: Database,
) -> None:
    from nox.models import (
        AutomationExecution,
        AutomationRule,
        Chat,
        ModerationCase,
        User,
    )

    now = datetime.now(UTC)
    old = now - timedelta(days=1)
    async with queue_db.sessions() as session:
        session.add(Chat(id=-1001, title="test"))
        session.add_all(
            [
                User(id=10, first_name="Admin", username=None),
                User(id=20, first_name="Member", username=None),
            ]
        )
        await session.flush()
        session.add(
            AutomationRule(
                id="rule",
                chat_id=-1001,
                created_by=10,
                name="rule",
                trigger="member_join",
                action="welcome",
                conditions={},
            )
        )
        session.add_all(
            [
                ModerationCase(
                    id="fresh-revoke",
                    chat_id=-1001,
                    actor_id=10,
                    target_user_id=20,
                    kind="mute",
                    reason="test",
                    status="revoking",
                    idempotency_key="fresh-revoke",
                    request_hash="hash",
                    created_at=old,
                    operation_started_at=now,
                ),
                ModerationCase(
                    id="stale-intent",
                    chat_id=-1001,
                    actor_id=10,
                    target_user_id=20,
                    kind="mute",
                    reason="test",
                    status="pending",
                    idempotency_key="stale-intent",
                    request_hash="hash",
                    created_at=old,
                    operation_started_at=old,
                ),
            ]
        )
        await session.flush()
        session.add(
            AutomationExecution(
                id="execution",
                rule_id="rule",
                event_key="event",
                status="pending",
                created_at=old,
            )
        )
        await session.commit()
    await recover_stale(queue_db)
    async with queue_db.sessions() as session:
        assert (await session.get(ModerationCase, "fresh-revoke")).status == "revoking"
        assert (await session.get(ModerationCase, "stale-intent")).status == "unknown"
        assert (await session.get(AutomationExecution, "execution")).status == "unknown"
