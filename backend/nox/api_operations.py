from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import func, select

from nox.api_chats import PageLimit, PageOffset, case_list
from nox.api_dependencies import Actor, DBSession
from nox.models import Appeal, AuditEvent, Chat, ModerationCase, ShieldModule, User
from nox.moderation import ModerationService
from nox.schemas import (
    AppealCreate,
    AppealResolve,
    CaseCreate,
    CaseOut,
    CasePage,
    SettingsOut,
    SettingsPatch,
    ShieldModuleOut,
    ShieldOut,
    ShieldPatch,
)
from nox.security import require_permission

router = APIRouter(prefix="/api/v1/chats", tags=["Moderation and protection"])
SHIELD_NAMES = {
    "anti_spam": ("Anti-Spam", "Частота сообщений и повторяющаяся реклама"),
    "anti_flood": ("Anti-Flood", "Слишком много сообщений за короткий интервал"),
    "anti_raid": ("Anti-Raid", "Обнаружение всплесков вступлений; ручная проверка"),
    "anti_scam": ("Anti-Scam", "Подозрительные схемы и мошеннические ссылки"),
    "anti_link": ("Anti-Link", "Фильтрация внешних ссылок"),
    "anti_duplicate": ("Anti-Duplicate", "Повторяющиеся сообщения"),
    "anti_mention": ("Anti-Mention", "Массовые упоминания участников"),
    "anti_bot": ("Anti-Bot", "Проверка сообщений ботов"),
    "join_guard": ("Join Guard", "Сигналы о новых ботах; ручная проверка"),
    "edit_guard": ("Edit Guard", "Повторная проверка изменённых сообщений"),
}


async def live_configure(request: Request, session: DBSession, actor: Actor, chat_id: int) -> None:
    await require_permission(session, chat_id, actor.id, "configure")
    await request.app.state.gateway.assert_admin(chat_id, actor.id)


async def one_case(session: DBSession, case: ModerationCase) -> CaseOut:
    target = await session.get(User, case.target_user_id)
    actor = await session.get(User, case.actor_id)
    assert target is not None and actor is not None
    return CaseOut(
        id=case.id,
        kind=case.kind,
        reason=case.reason,
        target_name=target.first_name,
        target_user_id=target.id,
        actor_name=actor.first_name,
        status=case.status,
        created_at=case.created_at,
        expires_at=case.expires_at,
        error_code=case.error_code,
    )


def ensure_confirmed(case: ModerationCase) -> None:
    if case.status in {"failed", "unknown"} or case.error_code:
        raise HTTPException(
            502,
            {
                "message": "Telegram не подтвердил действие",
                "case_id": case.id,
                "status": case.status,
                "code": case.error_code,
            },
        )
    if case.status in {"pending", "revoking"}:
        raise HTTPException(
            409, {"message": "Действие обрабатывается", "case_id": case.id, "status": case.status}
        )


@router.get("/{chat_id}/cases", response_model=CasePage)
async def cases(
    chat_id: int,
    session: DBSession,
    actor: Actor,
    limit: PageLimit = 20,
    offset: PageOffset = 0,
    search: str | None = None,
    kind: str | None = None,
) -> dict[str, Any]:
    await require_permission(session, chat_id, actor.id, "view")
    return await case_list(session, chat_id, limit, offset, search, kind)


@router.post("/{chat_id}/cases", response_model=CaseOut, status_code=201)
async def create_case(
    chat_id: int,
    data: CaseCreate,
    request: Request,
    session: DBSession,
    actor: Actor,
) -> CaseOut:
    service = ModerationService(request.app.state.db, request.app.state.gateway)
    case = await service.execute(
        chat_id,
        actor.id,
        data.target_user_id,
        data.kind,
        data.reason,
        data.duration_minutes,
        data.idempotency_key,
    )
    ensure_confirmed(case)
    return await one_case(session, case)


@router.post("/{chat_id}/cases/{case_id}/revoke", response_model=CaseOut)
async def revoke_case(
    chat_id: int,
    case_id: str,
    request: Request,
    session: DBSession,
    actor: Actor,
) -> CaseOut:
    service = ModerationService(request.app.state.db, request.app.state.gateway)
    case = await service.revoke(chat_id, actor.id, case_id)
    ensure_confirmed(case)
    return await one_case(session, case)


@router.get("/{chat_id}/shield", response_model=ShieldOut)
async def shield(chat_id: int, session: DBSession, actor: Actor) -> ShieldOut:
    await require_permission(session, chat_id, actor.id, "view")
    chat = await session.get(Chat, chat_id)
    assert chat is not None
    modules = (
        await session.scalars(
            select(ShieldModule)
            .where(
                ShieldModule.chat_id == chat_id,
            )
            .order_by(ShieldModule.key)
        )
    ).all()
    return ShieldOut(
        modules=[
            ShieldModuleOut(
                key=m.key,
                name=SHIELD_NAMES[m.key][0],
                description=SHIELD_NAMES[m.key][1],
                enabled=m.enabled,
                sensitivity=m.sensitivity,
                events=m.events,
            )
            for m in modules
        ],
        emergency_enabled=chat.emergency_enabled,
    )


@router.patch("/{chat_id}/shield", response_model=ShieldOut)
async def patch_shield(
    chat_id: int,
    data: ShieldPatch,
    request: Request,
    session: DBSession,
    actor: Actor,
) -> ShieldOut:
    await live_configure(request, session, actor, chat_id)
    keys = [m.key for m in data.modules]
    if len(keys) != len(set(keys)) or any(k not in SHIELD_NAMES for k in keys):
        raise HTTPException(422, "Неизвестный или повторяющийся модуль")
    for patch in data.modules:
        module = await session.get(ShieldModule, (chat_id, patch.key))
        if module is None:
            raise HTTPException(404, "Модуль не найден")
        for key, value in patch.model_dump(exclude_none=True, exclude={"key"}).items():
            setattr(module, key, value)
    session.add(
        AuditEvent(
            id=str(uuid4()),
            chat_id=chat_id,
            actor_id=actor.id,
            action="shield.updated",
            detail=", ".join(keys),
        )
    )
    await session.commit()
    return await shield(chat_id, session, actor)


@router.get("/{chat_id}/settings", response_model=SettingsOut)
async def settings(chat_id: int, session: DBSession, actor: Actor) -> Chat:
    await require_permission(session, chat_id, actor.id, "view")
    chat = await session.get(Chat, chat_id)
    assert chat is not None
    return chat


@router.patch("/{chat_id}/settings", response_model=SettingsOut)
async def patch_settings(
    chat_id: int,
    data: SettingsPatch,
    request: Request,
    session: DBSession,
    actor: Actor,
) -> Chat:
    await live_configure(request, session, actor, chat_id)
    if data.ai_enabled:
        raise HTTPException(422, "AI-провайдер не подключён. Доступен только ручной разбор")
    chat = await session.get(Chat, chat_id)
    assert chat is not None
    for key, value in data.model_dump(exclude_none=True).items():
        setattr(chat, key, value)
    session.add(
        AuditEvent(
            id=str(uuid4()),
            chat_id=chat_id,
            actor_id=actor.id,
            action="settings.updated",
            detail=", ".join(data.model_fields_set),
        )
    )
    await session.commit()
    return chat


@router.get("/{chat_id}/appeals")
async def appeals(
    chat_id: int,
    session: DBSession,
    actor: Actor,
    limit: PageLimit = 20,
    offset: PageOffset = 0,
) -> dict[str, Any]:
    await require_permission(session, chat_id, actor.id, "view")
    rows = (
        await session.execute(
            select(Appeal, User.first_name)
            .join(User)
            .where(
                Appeal.chat_id == chat_id,
            )
            .order_by(Appeal.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    total = await session.scalar(
        select(func.count())
        .select_from(Appeal)
        .where(
            Appeal.chat_id == chat_id,
        )
    )
    return {
        "items": [
            {
                "id": a.id,
                "case_id": a.case_id,
                "user_name": name,
                "reason": a.reason,
                "status": a.status,
                "created_at": a.created_at,
            }
            for a, name in rows
        ],
        "total": total or 0,
    }


@router.post("/{chat_id}/appeals", status_code=201)
async def create_appeal(
    chat_id: int,
    data: AppealCreate,
    session: DBSession,
    actor: Actor,
) -> dict[str, str]:
    await require_permission(session, chat_id, actor.id, "appeal")
    case = await session.get(ModerationCase, data.case_id)
    if case is None or case.chat_id != chat_id or case.target_user_id != actor.id:
        raise HTTPException(404, "Наказание не найдено")
    duplicate = await session.scalar(select(Appeal.id).where(Appeal.case_id == case.id))
    if duplicate:
        raise HTTPException(409, "Апелляция уже подана")
    appeal = Appeal(
        id=str(uuid4()),
        chat_id=chat_id,
        case_id=case.id,
        user_id=actor.id,
        reason=data.reason,
        status="pending",
    )
    session.add(appeal)
    await session.commit()
    return {"id": appeal.id, "status": appeal.status}


@router.post("/{chat_id}/appeals/{appeal_id}/resolve")
async def resolve_appeal(
    chat_id: int,
    appeal_id: str,
    data: AppealResolve,
    request: Request,
    session: DBSession,
    actor: Actor,
) -> dict[str, str]:
    await live_configure(request, session, actor, chat_id)
    appeal = await session.scalar(
        select(Appeal)
        .where(
            Appeal.id == appeal_id,
            Appeal.chat_id == chat_id,
        )
        .with_for_update()
    )
    if appeal is None:
        raise HTTPException(404, "Апелляция не найдена")
    if appeal.status != "pending":
        raise HTTPException(409, "Апелляция уже рассмотрена")
    if data.status == "accepted":
        service = ModerationService(request.app.state.db, request.app.state.gateway)
        result = await service.revoke(chat_id, actor.id, appeal.case_id)
        ensure_confirmed(result)
    appeal.status = data.status
    session.add(
        AuditEvent(
            id=str(uuid4()),
            chat_id=chat_id,
            actor_id=actor.id,
            action="appeal.resolved",
            detail=f"{appeal.id}: {data.status}",
        )
    )
    await session.commit()
    return {"id": appeal.id, "status": appeal.status}
