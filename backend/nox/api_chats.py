from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request
from sqlalchemy import desc, func, select
from sqlalchemy.orm import aliased

from nox.api_dependencies import Actor, DBSession
from nox.models import (
    AnalyticsAggregate,
    AuditEvent,
    Chat,
    ChatMember,
    ModerationCase,
    ShieldModule,
    User,
)
from nox.schemas import CaseOut, ChatOut
from nox.security import require_permission
from nox.telegram import TelegramGatewayError

router = APIRouter(prefix="/api/v1/chats", tags=["Community"])
PageLimit = Annotated[int, Query(ge=1, le=100)]
PageOffset = Annotated[int, Query(ge=0, le=100000)]


async def case_list(
    session: DBSession,
    chat_id: int,
    limit: int = 20,
    offset: int = 0,
    search: str | None = None,
    kind: str | None = None,
) -> dict[str, Any]:
    target = aliased(User)
    actor = aliased(User)
    criteria = [ModerationCase.chat_id == chat_id]
    if search:
        criteria.append(ModerationCase.reason.ilike(f"%{search}%"))
    if kind:
        criteria.append(ModerationCase.kind == kind)
    rows = (
        await session.execute(
            select(ModerationCase, target.first_name, actor.first_name)
            .join(target, target.id == ModerationCase.target_user_id)
            .join(actor, actor.id == ModerationCase.actor_id)
            .where(*criteria)
            .order_by(desc(ModerationCase.created_at))
            .limit(limit)
            .offset(offset)
        )
    ).all()
    items = [
        CaseOut(
            id=c.id,
            kind=c.kind,
            reason=c.reason,
            target_name=t,
            target_user_id=c.target_user_id,
            actor_name=a,
            status=c.status,
            created_at=c.created_at,
            expires_at=c.expires_at,
            error_code=c.error_code,
        )
        for c, t, a in rows
    ]
    total = await session.scalar(select(func.count()).select_from(ModerationCase).where(*criteria))
    return {"items": items, "total": total or 0}


async def activity_data(session: DBSession, chat_id: int) -> list[dict[str, Any]]:
    rows = (
        await session.scalars(
            select(AnalyticsAggregate)
            .where(
                AnalyticsAggregate.chat_id == chat_id,
            )
            .order_by(desc(AnalyticsAggregate.day))
            .limit(14)
        )
    ).all()
    return [
        {
            "label": r.day[5:],
            "messages": r.messages,
            "violations": r.violations,
            "members": r.members,
        }
        for r in reversed(rows)
    ]


@router.get("", response_model=list[ChatOut])
async def chats(request: Request, session: DBSession, actor: Actor) -> list[ChatOut]:
    rows = (
        await session.execute(
            select(Chat, ChatMember.role)
            .join(ChatMember)
            .where(
                ChatMember.user_id == actor.id,
                ChatMember.role.in_(["owner", "admin", "moderator"]),
            )
            .order_by(Chat.title)
            .limit(100)
        )
    ).all()
    result = []
    for chat, role in rows:
        if request.app.state.settings.mode == "production":
            try:
                await request.app.state.gateway.assert_admin(chat.id, actor.id)
            except TelegramGatewayError as error:
                if error.code == "actor_forbidden":
                    continue
                raise
        result.append(
            ChatOut(id=chat.id, title=chat.title, member_count=chat.member_count, role=role)
        )
    return result


@router.get("/{chat_id}/dashboard")
async def dashboard(
    chat_id: int, request: Request, session: DBSession, actor: Actor
) -> dict[str, Any]:
    await require_permission(session, chat_id, actor.id, "view")
    chat = await session.get(Chat, chat_id)
    assert chat is not None
    activity = await activity_data(session, chat_id)
    modules = (
        await session.scalars(
            select(ShieldModule).where(
                ShieldModule.chat_id == chat_id,
            )
        )
    ).all()
    enabled = sum(m.enabled for m in modules)
    cases = await case_list(session, chat_id, limit=6)
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    actions = (
        await session.scalar(
            select(func.count())
            .select_from(ModerationCase)
            .where(
                ModerationCase.chat_id == chat_id,
                ModerationCase.created_at >= today,
                ModerationCase.status == "applied",
            )
        )
        or 0
    )
    aggregate = await session.get(AnalyticsAggregate, (chat_id, today.strftime("%Y-%m-%d")))
    return {
        "stats": {
            "members": chat.member_count,
            "messages_today": aggregate.messages if aggregate else 0,
            "actions_today": actions,
            "protection_score": round(enabled / len(modules) * 100) if modules else 0,
        },
        "activity": activity,
        "recent_cases": cases["items"],
        "protection": {"enabled": enabled, "total": len(modules)},
        "mode": request.app.state.settings.mode,
    }


@router.get("/{chat_id}/members")
async def members(
    chat_id: int,
    session: DBSession,
    actor: Actor,
    limit: PageLimit = 20,
    offset: PageOffset = 0,
    search: Annotated[str | None, Query(max_length=100)] = None,
) -> dict[str, Any]:
    await require_permission(session, chat_id, actor.id, "view")
    query = select(User, ChatMember).join(ChatMember).where(ChatMember.chat_id == chat_id)
    if search:
        query = query.where(User.first_name.ilike(f"%{search}%"))
    total = await session.scalar(select(func.count()).select_from(query.subquery()))
    rows = (
        await session.execute(query.order_by(User.first_name).limit(limit).offset(offset))
    ).all()
    return {
        "items": [
            {
                "id": u.id,
                "first_name": u.first_name,
                "username": u.username,
                "role": m.role,
                "joined_at": m.joined_at,
            }
            for u, m in rows
        ],
        "total": total,
    }


@router.get("/{chat_id}/analytics")
async def analytics(chat_id: int, session: DBSession, actor: Actor) -> dict[str, Any]:
    await require_permission(session, chat_id, actor.id, "view")
    activity = await activity_data(session, chat_id)
    counts = (
        await session.execute(
            select(ModerationCase.kind, func.count())
            .where(
                ModerationCase.chat_id == chat_id,
                ModerationCase.status == "applied",
            )
            .group_by(ModerationCase.kind)
        )
    ).all()
    return {
        "activity": activity,
        "growth": [
            {"label": p["label"], "members": p["members"]} for p in activity if p["members"] > 0
        ],
        "coverage": {
            "member_snapshots_complete": bool(activity) and all(p["members"] > 0 for p in activity)
        },
        "notice": (
            "Для некоторых дней нет снимка числа участников. Эти дни исключены из графика роста."
            if any(p["members"] <= 0 for p in activity)
            else None
        ),
        "moderation": [{"label": kind, "value": count} for kind, count in counts],
        "summary": {
            "messages": sum(p["messages"] for p in activity),
            "violations": sum(p["violations"] for p in activity),
            "retention": None,
        },
    }


@router.get("/{chat_id}/audit")
async def audit(
    chat_id: int,
    session: DBSession,
    actor: Actor,
    limit: PageLimit = 20,
    offset: PageOffset = 0,
) -> dict[str, Any]:
    await require_permission(session, chat_id, actor.id, "view")
    rows = (
        await session.execute(
            select(AuditEvent, User.first_name)
            .outerjoin(
                User,
                User.id == AuditEvent.actor_id,
            )
            .where(AuditEvent.chat_id == chat_id)
            .order_by(desc(AuditEvent.created_at))
            .limit(limit)
            .offset(offset)
        )
    ).all()
    total = await session.scalar(
        select(func.count())
        .select_from(AuditEvent)
        .where(
            AuditEvent.chat_id == chat_id,
        )
    )
    return {
        "items": [
            {
                "id": e.id,
                "action": e.action,
                "actor_name": name or "NOX",
                "detail": e.detail,
                "created_at": e.created_at,
            }
            for e, name in rows
        ],
        "total": total or 0,
    }
