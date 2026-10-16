"""Adversarial service tests with real PostgreSQL transactions and row locks.

Each test gets a fresh schema. Set NOX_TEST_POSTGRES_URL to a disposable database
whose user may create schemas; no existing tables are truncated or modified.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from nox.db import Base, Database
from nox.models import AuditEvent, Chat, ChatMember, ModerationCase, User
from nox.moderation import ConflictError, ModerationService
from nox.security import AccessDenied
from nox.telegram import TelegramGatewayError
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

CHAT = -1007001
OWNER = 7001
TARGET = 7002


class RecordingGateway:
    def __init__(self, *, ambiguous: bool = False, forbidden: bool = False) -> None:
        self.actions: list[tuple[str, int, int]] = []
        self.ambiguous = ambiguous
        self.forbidden = forbidden

    async def authorize(self, chat_id: int, actor_id: int, target_id: int, action: str) -> None:
        if self.forbidden:
            raise TelegramGatewayError("actor_forbidden", "Actor lost Telegram rights")

    async def perform(
        self, action: str, chat_id: int, target_id: int, until_date: datetime | None = None
    ) -> None:
        self.actions.append((action, chat_id, target_id))
        await asyncio.sleep(0.01)
        if self.ambiguous:
            raise TelegramGatewayError("telegram_unknown", "No response", ambiguous=True)


@pytest_asyncio.fixture
async def postgres_db() -> AsyncIterator[Database]:
    url = os.environ.get("NOX_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("Set NOX_TEST_POSTGRES_URL to run real PostgreSQL concurrency tests")
    if not url.startswith("postgresql+asyncpg://"):
        pytest.fail("NOX_TEST_POSTGRES_URL must use PostgreSQL with asyncpg")
    schema = "qa_" + uuid4().hex
    admin_engine = create_async_engine(url)
    async with admin_engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    database = Database(url)
    await database.engine.dispose()
    database.engine = create_async_engine(
        url, connect_args={"server_settings": {"search_path": schema}}
    )
    database.sessions = async_sessionmaker(database.engine, expire_on_commit=False)
    try:
        async with database.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with database.sessions() as session:
            session.add_all(
                [
                    User(id=OWNER, first_name="Owner", username=None),
                    User(id=TARGET, first_name="Member", username=None),
                    Chat(id=CHAT, title="QA isolated chat", warn_limit=3),
                ]
            )
            await session.flush()
            session.add_all(
                [
                    ChatMember(chat_id=CHAT, user_id=OWNER, role="owner"),
                    ChatMember(chat_id=CHAT, user_id=TARGET, role="member"),
                ]
            )
            await session.commit()
        yield database
    finally:
        await database.close()
        async with admin_engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin_engine.dispose()


async def execute(service: ModerationService, key: str, kind: str = "ban") -> ModerationCase:
    return await service.execute(CHAT, OWNER, TARGET, kind, "QA contract", None, key)


async def test_concurrent_replay_performs_one_telegram_mutation(postgres_db: Database) -> None:
    gateway = RecordingGateway()
    service = ModerationService(postgres_db, gateway)
    cases = await asyncio.gather(*(execute(service, "same-request-key") for _ in range(12)))
    assert len({case.id for case in cases}) == 1
    assert all(case.status in {"pending", "applied"} for case in cases)
    assert gateway.actions == [("ban", CHAT, TARGET)]
    async with postgres_db.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(ModerationCase)) == 1
        assert (await session.get(ModerationCase, cases[0].id)).status == "applied"
        assert await session.scalar(select(func.count()).select_from(AuditEvent)) == 1


async def test_concurrent_distinct_bans_do_not_overwrite_active_sanction(
    postgres_db: Database,
) -> None:
    gateway = RecordingGateway()
    service = ModerationService(postgres_db, gateway)
    results = await asyncio.gather(
        *(execute(service, f"different-request-{number}") for number in range(8)),
        return_exceptions=True,
    )
    assert sum(isinstance(result, ModerationCase) for result in results) == 1
    assert sum(isinstance(result, ConflictError) for result in results) == 7
    assert gateway.actions == [("ban", CHAT, TARGET)]


async def test_concurrent_revoke_reverses_telegram_exactly_once(postgres_db: Database) -> None:
    gateway = RecordingGateway()
    service = ModerationService(postgres_db, gateway)
    case = await execute(service, "ban-then-revoke")
    results = await asyncio.gather(
        *(service.revoke(CHAT, OWNER, case.id) for _ in range(8)),
        return_exceptions=True,
    )
    assert sum(isinstance(result, ModerationCase) for result in results) == 1
    assert sum(isinstance(result, ConflictError) for result in results) == 7
    assert gateway.actions == [("ban", CHAT, TARGET), ("unban", CHAT, TARGET)]
    async with postgres_db.sessions() as session:
        assert (await session.get(ModerationCase, case.id)).status == "revoked"


@pytest.mark.parametrize(("kind", "inverse"), [("ban", "unban"), ("mute", "unmute")])
async def test_inverse_command_releases_original_active_case(
    postgres_db: Database,
    kind: str,
    inverse: str,
) -> None:
    gateway = RecordingGateway()
    service = ModerationService(postgres_db, gateway)
    original = await execute(service, "original-restriction", kind)
    reversal = await execute(service, "explicit-inverse-command", inverse)
    assert reversal.status == "applied"
    async with postgres_db.sessions() as session:
        assert (await session.get(ModerationCase, original.id)).status == "revoked"
    replacement = await execute(service, "new-restriction-after-inverse", kind)
    assert replacement.status == "applied"
    assert gateway.actions == [(kind, CHAT, TARGET), (inverse, CHAT, TARGET), (kind, CHAT, TARGET)]


async def test_ambiguous_telegram_failure_is_durable_and_never_retried(
    postgres_db: Database,
) -> None:
    gateway = RecordingGateway(ambiguous=True)
    service = ModerationService(postgres_db, gateway)
    case = await execute(service, "ambiguous-request")
    replay = await execute(service, "ambiguous-request")
    assert case.id == replay.id
    assert case.status == replay.status == "unknown"
    assert case.error_code == "telegram_unknown"
    assert gateway.actions == [("ban", CHAT, TARGET)]
    async with postgres_db.sessions() as session:
        audit = (await session.scalars(select(AuditEvent))).all()
        assert len(audit) == 1
        assert "unknown" in audit[0].detail


async def test_expired_legacy_case_does_not_unban_newer_active_case(
    postgres_db: Database,
) -> None:
    # Exercise recovery of old/externally migrated data, not just the new-case guard.
    gateway = RecordingGateway()
    old_id, new_id = str(uuid4()), str(uuid4())
    now = datetime.now(UTC)
    async with postgres_db.sessions() as session:
        for case_id, expiry, created in [
            (old_id, now - timedelta(minutes=1), now - timedelta(hours=2)),
            (new_id, None, now - timedelta(minutes=30)),
        ]:
            session.add(
                ModerationCase(
                    id=case_id,
                    chat_id=CHAT,
                    target_user_id=TARGET,
                    actor_id=OWNER,
                    kind="ban",
                    reason="Legacy overlap",
                    status="applied",
                    idempotency_key="legacy-" + case_id,
                    request_hash="a" * 64,
                    created_at=created,
                    expires_at=expiry,
                )
            )
        await session.commit()
    result = await ModerationService(postgres_db, gateway).expire(old_id)
    assert result.status == "expired"
    assert gateway.actions == []
    async with postgres_db.sessions() as session:
        assert (await session.get(ModerationCase, new_id)).status == "applied"


async def test_idempotency_key_reuse_cannot_change_target_or_action(postgres_db: Database) -> None:
    gateway = RecordingGateway()
    service = ModerationService(postgres_db, gateway)
    await execute(service, "immutable-request")
    with pytest.raises(ConflictError):
        await execute(service, "immutable-request", "mute")
    assert gateway.actions == [("ban", CHAT, TARGET)]


async def test_current_telegram_rights_checked_before_persisting_intent(
    postgres_db: Database,
) -> None:
    gateway = RecordingGateway(forbidden=True)
    with pytest.raises(TelegramGatewayError, match="lost Telegram rights"):
        await execute(ModerationService(postgres_db, gateway), "revoked-admin-rights")
    async with postgres_db.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(ModerationCase)) == 0
    assert gateway.actions == []


async def test_cross_chat_membership_never_authorizes_mutation(postgres_db: Database) -> None:
    other_chat = CHAT - 1
    async with postgres_db.sessions() as session:
        session.add(Chat(id=other_chat, title="Other isolated chat"))
        await session.flush()
        session.add(ChatMember(chat_id=other_chat, user_id=TARGET, role="member"))
        await session.commit()
    gateway = RecordingGateway()
    with pytest.raises(AccessDenied):
        await ModerationService(postgres_db, gateway).execute(
            other_chat, OWNER, TARGET, "ban", "Cross chat", None, "cross-chat-attempt"
        )
    assert gateway.actions == []
