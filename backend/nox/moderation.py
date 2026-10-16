import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import uuid4

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from nox.db import Database
from nox.models import AuditEvent, Chat, ChatMember, ModerationCase
from nox.security import AccessDenied, check_target
from nox.telegram import TelegramGatewayError


class TelegramGateway(Protocol):
    async def authorize(
        self,
        chat_id: int,
        actor_id: int,
        target_id: int,
        action: str,
    ) -> None: ...

    async def assert_admin(self, chat_id: int, actor_id: int) -> object: ...

    async def perform(
        self,
        action: str,
        chat_id: int,
        target_id: int,
        until_date: datetime | None = None,
    ) -> None: ...


class ConflictError(Exception):
    pass


class ModerationService:
    """Reserve durable intent before Telegram call; uncertain calls never retry automatically."""

    def __init__(self, db: Database, gateway: TelegramGateway) -> None:
        self.db = db
        self.gateway = gateway

    async def execute(
        self,
        chat_id: int,
        actor_id: int,
        target_id: int,
        kind: str,
        reason: str,
        duration_minutes: int | None,
        idempotency_key: str,
    ) -> ModerationCase:
        if kind not in {"warn", "unwarn", "ban", "unban", "mute", "unmute", "kick"}:
            raise ValueError("Unsupported moderation action")
        if duration_minutes is not None and (
            kind not in {"ban", "mute"} or not 1 <= duration_minutes <= 525600
        ):
            raise ValueError("Duration is only supported for ban/mute: 1..525600 minutes")
        if not reason.strip() or len(reason) > 1000 or not 8 <= len(idempotency_key) <= 128:
            raise ValueError("Invalid reason or idempotency key")
        fingerprint = hashlib.sha256(
            json.dumps(
                [actor_id, target_id, kind, reason, duration_minutes],
                ensure_ascii=False,
            ).encode()
        ).hexdigest()
        async with self.db.sessions() as session:
            await check_target(session, chat_id, actor_id, target_id)
            await session.scalar(
                select(ChatMember)
                .where(
                    ChatMember.chat_id == chat_id,
                    ChatMember.user_id == target_id,
                )
                .with_for_update()
            )
            existing = await session.scalar(
                select(ModerationCase).where(
                    ModerationCase.chat_id == chat_id,
                    ModerationCase.idempotency_key == idempotency_key,
                )
            )
            if existing:
                if existing.request_hash != fingerprint:
                    raise ConflictError("Ключ уже использован для другого действия")
                return existing
            if kind in {"ban", "mute"}:
                active = await session.scalar(
                    select(ModerationCase.id)
                    .where(
                        ModerationCase.chat_id == chat_id,
                        ModerationCase.target_user_id == target_id,
                        ModerationCase.kind == kind,
                        ModerationCase.status.in_(["pending", "applied", "unknown", "revoking"]),
                    )
                    .limit(1)
                )
                if active:
                    raise ConflictError("Сначала отмените существующее ограничение этого типа")
            if kind in {"unban", "unmute"}:
                blocking = await session.scalar(
                    select(ModerationCase.id)
                    .where(
                        ModerationCase.chat_id == chat_id,
                        ModerationCase.target_user_id == target_id,
                        ModerationCase.kind.in_([kind, {"unban": "ban", "unmute": "mute"}[kind]]),
                        ModerationCase.status.in_(["pending", "revoking"]),
                    )
                    .limit(1)
                )
                if blocking:
                    raise ConflictError("Сначала дождитесь завершения текущего действия")
            # Refresh Telegram rights before creating any mutation intent.
            await self.gateway.authorize(chat_id, actor_id, target_id, kind)
            case = ModerationCase(
                id=str(uuid4()),
                chat_id=chat_id,
                target_user_id=target_id,
                actor_id=actor_id,
                kind=kind,
                reason=reason.strip(),
                status="pending",
                request_hash=fingerprint,
                idempotency_key=idempotency_key,
                expires_at=(datetime.now(UTC) + timedelta(minutes=duration_minutes))
                if duration_minutes
                else None,
            )
            session.add(case)
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                duplicate = await session.scalar(
                    select(ModerationCase).where(
                        ModerationCase.chat_id == chat_id,
                        ModerationCase.idempotency_key == idempotency_key,
                    )
                )
                if duplicate is None:
                    raise
                if duplicate.request_hash != fingerprint:
                    raise ConflictError("Ключ уже использован для другого действия") from None
                return duplicate
        if kind in {"warn", "unwarn"}:
            await self._apply_warning(case)
        else:
            try:
                await self.gateway.perform(kind, chat_id, target_id, case.expires_at)
            except TelegramGatewayError as error:
                return await self._finish(
                    case.id,
                    "unknown" if error.ambiguous else "failed",
                    error.code,
                )
            except (TimeoutError, OSError):
                return await self._finish(case.id, "unknown", "transport_ambiguous")
            await self._finish(case.id, "applied")
        async with self.db.sessions() as session:
            result = await session.get(ModerationCase, case.id)
            assert result is not None
            return result

    async def _apply_warning(self, case: ModerationCase) -> None:
        async with self.db.sessions() as session:
            # Serialize warning totals per target; atomic DB transaction on PostgreSQL.
            await session.scalar(
                select(ChatMember)
                .where(
                    ChatMember.chat_id == case.chat_id,
                    ChatMember.user_id == case.target_user_id,
                )
                .with_for_update()
            )
            stored = await session.get(ModerationCase, case.id)
            assert stored is not None
            if case.kind == "unwarn":
                latest = await session.scalar(
                    select(ModerationCase)
                    .where(
                        ModerationCase.chat_id == case.chat_id,
                        ModerationCase.target_user_id == case.target_user_id,
                        ModerationCase.kind == "warn",
                        ModerationCase.status == "applied",
                    )
                    .order_by(ModerationCase.created_at.desc())
                    .limit(1)
                    .with_for_update()
                )
                if latest:
                    latest.status = "revoked"
            stored.status = "applied"
            session.add(
                AuditEvent(
                    id=str(uuid4()),
                    chat_id=case.chat_id,
                    actor_id=case.actor_id,
                    action=f"moderation.{case.kind}",
                    detail=f"case:{case.id} applied",
                )
            )
            await session.flush()
            count = (
                await session.scalar(
                    select(func.count())
                    .select_from(ModerationCase)
                    .where(
                        ModerationCase.chat_id == case.chat_id,
                        ModerationCase.target_user_id == case.target_user_id,
                        ModerationCase.kind == "warn",
                        ModerationCase.status == "applied",
                    )
                )
                or 0
            )
            chat = await session.get(Chat, case.chat_id)
            threshold = chat.warn_limit if chat else 3
            await session.commit()
        matched_rule = False
        if case.kind == "warn" and count > 0:
            from nox.automation_runtime import execute_automation

            matched_rule = await execute_automation(
                self.db,
                self.gateway,
                case.chat_id,
                "warnings",
                f"case:{case.id}",
                case.target_user_id,
                count=count,
            )
        if not matched_rule and case.kind == "warn" and count > 0 and count % threshold == 0:
            # Explicit deterministic child intent; failures remain visible in history.
            try:
                await self.execute(
                    case.chat_id,
                    case.actor_id,
                    case.target_user_id,
                    "mute",
                    f"Автоматическая эскалация: {count} предупреждений",
                    60,
                    f"warn-escalation:{case.chat_id}:{case.target_user_id}:{count // threshold}",
                )
            except (ConflictError, TelegramGatewayError, AccessDenied):
                pass  # An existing stronger restriction already protects the chat.

    async def _finish(
        self,
        case_id: str,
        status: str,
        error_code: str | None = None,
        audit_actor_id: int | None = None,
    ) -> ModerationCase:
        async with self.db.sessions() as session:
            case = await session.get(ModerationCase, case_id)
            assert case is not None
            if status == "applied" and case.kind in {"unban", "unmute"}:
                await session.scalar(
                    select(ChatMember)
                    .where(
                        ChatMember.chat_id == case.chat_id,
                        ChatMember.user_id == case.target_user_id,
                    )
                    .with_for_update()
                )
                await session.execute(
                    update(ModerationCase)
                    .where(
                        ModerationCase.chat_id == case.chat_id,
                        ModerationCase.target_user_id == case.target_user_id,
                        ModerationCase.kind == {"unban": "ban", "unmute": "mute"}[case.kind],
                        ModerationCase.status.in_(["applied", "unknown"]),
                    )
                    .values(status="revoked")
                )
            case.status = status
            case.error_code = error_code
            session.add(
                AuditEvent(
                    id=str(uuid4()),
                    chat_id=case.chat_id,
                    actor_id=audit_actor_id if audit_actor_id is not None else case.actor_id,
                    action=f"moderation.{case.kind}",
                    detail=f"case:{case.id} {status}",
                )
            )
            await session.commit()
            return case

    async def revoke(self, chat_id: int, actor_id: int, case_id: str) -> ModerationCase:
        async with self.db.sessions() as session:
            case = await session.get(ModerationCase, case_id)
            if case is None or case.chat_id != chat_id:
                raise ValueError("Наказание не найдено")
            await check_target(session, chat_id, actor_id, case.target_user_id)
            if case.kind not in {"ban", "mute", "warn"}:
                raise ConflictError("Это действие нельзя отменить")
            inverse = {"ban": "unban", "mute": "unmute", "warn": "unwarn"}[case.kind]
            await self.gateway.authorize(chat_id, actor_id, case.target_user_id, inverse)
        return await self._reverse(case, "revoked", actor_id)

    async def expire(self, case_id: str) -> ModerationCase:
        async with self.db.sessions() as session:
            case = await session.get(ModerationCase, case_id)
            if case is None:
                raise ValueError("Case not found")
            expires = case.expires_at
            if expires and expires.tzinfo is None:
                expires = expires.replace(tzinfo=UTC)
            if not expires or expires > datetime.now(UTC) or case.kind not in {"ban", "mute"}:
                raise ConflictError("Case is not due")
        # Telegram itself expires native until_date restrictions. A delayed worker must
        # never unmute/unban a newer restriction imposed by another administrator.
        async with self.db.sessions() as session:
            result = await session.execute(
                update(ModerationCase)
                .where(
                    ModerationCase.id == case.id,
                    ModerationCase.status == "applied",
                )
                .values(status="expired")
            )
            if result.rowcount != 1:  # type: ignore[attr-defined]
                raise ConflictError("Case is no longer active")
            session.add(
                AuditEvent(
                    id=str(uuid4()),
                    chat_id=case.chat_id,
                    actor_id=None,
                    action="moderation.expired",
                    detail=f"case:{case.id} expired",
                )
            )
            await session.commit()
        async with self.db.sessions() as session:
            stored = await session.get(ModerationCase, case.id)
            assert stored is not None
            return stored

    async def _reverse(
        self,
        case: ModerationCase,
        final_status: str,
        actor_id: int,
    ) -> ModerationCase:
        async with self.db.sessions() as session:
            await session.scalar(
                select(ChatMember)
                .where(
                    ChatMember.chat_id == case.chat_id,
                    ChatMember.user_id == case.target_user_id,
                )
                .with_for_update()
            )
            newer = await session.scalar(
                select(ModerationCase.id)
                .where(
                    ModerationCase.chat_id == case.chat_id,
                    ModerationCase.target_user_id == case.target_user_id,
                    ModerationCase.kind == case.kind,
                    ModerationCase.id != case.id,
                    ModerationCase.status.in_(["pending", "applied", "unknown", "revoking"]),
                )
                .limit(1)
            )
            if newer:
                raise ConflictError("Другое активное ограничение требует отдельной проверки")
            result = await session.execute(
                update(ModerationCase)
                .where(
                    ModerationCase.id == case.id,
                    ModerationCase.status == "applied",
                )
                .values(status="revoking", operation_started_at=datetime.now(UTC))
            )
            await session.commit()
            if result.rowcount != 1:  # type: ignore[attr-defined]
                raise ConflictError("Действие уже отменяется или не применено")
        inverse = {"ban": "unban", "mute": "unmute", "warn": "unwarn"}[case.kind]
        try:
            if inverse != "unwarn":
                await self.gateway.perform(inverse, case.chat_id, case.target_user_id)
        except TelegramGatewayError as error:
            return await self._finish(
                case.id,
                "unknown" if error.ambiguous else "applied",
                error.code,
                audit_actor_id=actor_id,
            )
        except (TimeoutError, OSError):
            return await self._finish(case.id, "unknown", "transport_ambiguous", actor_id)
        return await self._finish(case.id, final_status, audit_actor_id=actor_id)
