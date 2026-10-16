"""Database-backed trigger → condition → action runtime; no evaluation of code."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from nox.db import Database
from nox.models import AutomationExecution, AutomationRule, Chat
from nox.moderation import ConflictError, ModerationService
from nox.moderation import TelegramGateway as GatewayProtocol
from nox.security import AccessDenied, require_permission
from nox.telegram import TelegramGateway, TelegramGatewayError, _telegram_call


def matches_conditions(trigger: str, conditions: dict[str, Any], count: int) -> bool:
    """The shared predicate used by execution and the API's rule preview."""
    threshold = conditions.get("threshold", 3 if trigger == "warnings" else 1)
    if not isinstance(threshold, int) or isinstance(threshold, bool) or threshold < 1:
        return False
    if count < threshold:
        return False
    return trigger != "warnings" or count % threshold == 0


async def execute_automation(
    db: Database,
    gateway: GatewayProtocol,
    chat_id: int,
    trigger: str,
    event_key: str,
    target_id: int,
    count: int = 1,
    message_id: int | None = None,
) -> bool:
    """Claim before effect; no recursive event emission or automatic unknown replay.

    Return whether any rule matched, allowing the warning engine to retain its
    built-in escalation when administrators did not configure a matching rule.
    """
    async with db.sessions() as session:
        rules = (
            await session.scalars(
                select(AutomationRule)
                .where(
                    AutomationRule.chat_id == chat_id,
                    AutomationRule.enabled.is_(True),
                    AutomationRule.trigger == trigger,
                )
                .order_by(AutomationRule.priority.desc(), AutomationRule.id)
                .limit(20)
            )
        ).all()
    matched = False
    for rule in rules:
        conditions = rule.conditions or {}
        if not matches_conditions(trigger, conditions, count):
            continue
        if (trigger, rule.action) not in {
            ("member_join", "welcome"),
            ("flood", "delete"),
            ("flood", "mute"),
            ("warnings", "mute"),
        }:
            continue
        matched = True
        execution_id = str(uuid4())
        async with db.sessions() as session:
            session.add(
                AutomationExecution(
                    id=execution_id,
                    rule_id=rule.id,
                    event_key=event_key[:128],
                    status="pending",
                )
            )
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                existing = await session.scalar(
                    select(AutomationExecution).where(
                        AutomationExecution.rule_id == rule.id,
                        AutomationExecution.event_key == event_key[:128],
                    )
                )
                if existing is None:
                    raise
                continue
        status = "failed"
        try:
            actor_id = rule.created_by
            if actor_id is None:
                raise AccessDenied("Правило не имеет подтверждённого автора")
            async with db.sessions() as session:
                await require_permission(session, chat_id, actor_id, "configure")
                chat = await session.get(Chat, chat_id)
                welcome = chat.welcome_message if chat else "Добро пожаловать!"
            await gateway.assert_admin(chat_id, actor_id)
            if rule.action == "mute":
                duration = conditions.get("duration_minutes", 60)
                if not isinstance(duration, int) or not 1 <= duration <= 1440:
                    raise ValueError("Invalid automation duration")
                case = await ModerationService(db, gateway).execute(
                    chat_id=chat_id,
                    actor_id=actor_id,
                    target_id=target_id,
                    kind="mute",
                    reason=f"Автоматизация: {rule.name}",
                    duration_minutes=duration,
                    idempotency_key=f"automation:{execution_id}",
                )
                status = case.status
            elif isinstance(gateway, TelegramGateway):
                if rule.action == "welcome":
                    await _telegram_call(
                        gateway.bot.send_message(chat_id, welcome[:4096]), mutation=True
                    )
                    status = "applied"
                elif rule.action == "delete" and message_id is not None:
                    await gateway.delete_message(chat_id, message_id)
                    status = "applied"
            else:
                # Demo adapter does not pretend to have delivered a real message.
                status = "demo"
        except TelegramGatewayError as error:
            status = "unknown" if error.ambiguous else "failed"
        except (AccessDenied, ValueError, ConflictError):
            status = "failed"
        except (OSError, TimeoutError):
            status = "unknown"
        async with db.sessions() as session:
            await session.execute(
                update(AutomationExecution)
                .where(
                    AutomationExecution.id == execution_id,
                    AutomationExecution.status == "pending",
                )
                .values(status=status)
            )
            if status == "applied":
                await session.execute(
                    update(AutomationRule)
                    .where(
                        AutomationRule.id == rule.id,
                    )
                    .values(executions=AutomationRule.executions + 1)
                )
            await session.commit()
    return matched
