from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import func, select

from nox.api_chats import PageLimit, PageOffset
from nox.api_dependencies import Actor, DBSession
from nox.api_operations import live_configure
from nox.models import AuditEvent, AutomationExecution, AutomationRule, ShieldEvent
from nox.schemas import RuleCreate, RuleOut, RulePatch, RulePreview
from nox.security import require_permission

router = APIRouter(prefix="/api/v1/chats", tags=["Automation and Intelligence"])


@router.get("/{chat_id}/automation")
async def rules(
    chat_id: int,
    session: DBSession,
    actor: Actor,
    limit: PageLimit = 20,
    offset: PageOffset = 0,
) -> dict[str, Any]:
    await require_permission(session, chat_id, actor.id, "view")
    items = (
        await session.scalars(
            select(AutomationRule)
            .where(
                AutomationRule.chat_id == chat_id,
            )
            .order_by(AutomationRule.priority.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    total = await session.scalar(
        select(func.count())
        .select_from(AutomationRule)
        .where(
            AutomationRule.chat_id == chat_id,
        )
    )
    return {"items": [RuleOut.model_validate(r) for r in items], "total": total or 0}


@router.post("/{chat_id}/automation", response_model=RuleOut, status_code=201)
async def create_rule(
    chat_id: int,
    data: RuleCreate,
    request: Request,
    session: DBSession,
    actor: Actor,
) -> AutomationRule:
    await live_configure(request, session, actor, chat_id)
    rule = AutomationRule(
        id=str(uuid4()), chat_id=chat_id, created_by=actor.id, **data.model_dump(exclude_none=True)
    )
    session.add(rule)
    session.add(
        AuditEvent(
            id=str(uuid4()),
            chat_id=chat_id,
            actor_id=actor.id,
            action="automation.created",
            detail=rule.id,
        )
    )
    await session.commit()
    return rule


@router.patch("/{chat_id}/automation/{rule_id}", response_model=RuleOut)
async def patch_rule(
    chat_id: int,
    rule_id: str,
    data: RulePatch,
    request: Request,
    session: DBSession,
    actor: Actor,
) -> AutomationRule:
    await live_configure(request, session, actor, chat_id)
    rule = await session.get(AutomationRule, rule_id)
    if rule is None or rule.chat_id != chat_id:
        raise HTTPException(404, "Правило не найдено")
    for key, value in data.model_dump(exclude_none=True).items():
        setattr(rule, key, value)
    # Re-approval by currently authorized actor, rather than trusting stale client creator.
    rule.created_by = actor.id
    session.add(
        AuditEvent(
            id=str(uuid4()),
            chat_id=chat_id,
            actor_id=actor.id,
            action="automation.updated",
            detail=rule.id,
        )
    )
    await session.commit()
    return rule


@router.post("/{chat_id}/automation/preview")
async def preview(
    chat_id: int, data: RulePreview, session: DBSession, actor: Actor
) -> dict[str, Any]:
    await require_permission(session, chat_id, actor.id, "view")
    validated = RuleCreate(
        name="preview", trigger=data.trigger, conditions=data.conditions, action=data.action
    )
    from nox.automation_runtime import matches_conditions

    conditions = validated.conditions.model_dump(exclude_none=True)
    threshold = conditions.get("threshold", 3 if data.trigger == "warnings" else 1)
    matched = matches_conditions(validated.trigger, conditions, data.sample_count)
    return {
        "matched": matched,
        "action": data.action,
        "side_effects": False,
        "explanation": f"Тестовый счётчик {data.sample_count}; порог {threshold}. "
        + ("Правило сработает." if matched else "Условие не выполнено."),
    }


@router.get("/{chat_id}/intelligence")
async def intelligence(chat_id: int, session: DBSession, actor: Actor) -> dict[str, Any]:
    await require_permission(session, chat_id, actor.id, "view")
    signals = (
        await session.scalars(
            select(ShieldEvent)
            .where(
                ShieldEvent.chat_id == chat_id,
                ShieldEvent.module.in_(["anti_scam", "anti_raid", "join_guard"]),
            )
            .order_by(ShieldEvent.created_at.desc())
            .limit(30)
        )
    ).all()
    return {
        "enabled": False,
        "provider": "disabled",
        "policy": "review_only",
        "items": [
            {
                "id": event.id,
                "module": event.module,
                "user_id": event.user_id,
                "detail": event.detail,
                "created_at": event.created_at,
                "source": "heuristic",
                "requires_review": True,
            }
            for event in signals
        ],
        "notice": "AI-провайдер не подключён. Обычные фильтры Shield продолжают работу. "
        "Эвристические сигналы не доказывают нарушение.",
    }


@router.get("/{chat_id}/automation/executions")
async def executions(
    chat_id: int,
    session: DBSession,
    actor: Actor,
    limit: PageLimit = 20,
    offset: PageOffset = 0,
) -> dict[str, Any]:
    await require_permission(session, chat_id, actor.id, "view")
    query = (
        select(AutomationExecution, AutomationRule.name)
        .join(AutomationRule)
        .where(
            AutomationRule.chat_id == chat_id,
        )
    )
    total = await session.scalar(select(func.count()).select_from(query.subquery()))
    rows = (
        await session.execute(
            query.order_by(AutomationExecution.created_at.desc()).limit(limit).offset(offset)
        )
    ).all()
    return {
        "items": [
            {
                "id": execution.id,
                "rule_name": name,
                "rule_id": execution.rule_id,
                "status": execution.status,
                "created_at": execution.created_at,
            }
            for execution, name in rows
        ],
        "total": total or 0,
    }
