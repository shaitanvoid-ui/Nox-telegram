from typing import cast

from fastapi import APIRouter, HTTPException, Request
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import delete

from nox.api_dependencies import Actor, DBSession
from nox.auth import init_data_fingerprint, verify_init_data
from nox.config import Settings
from nox.models import Session, User
from nox.schemas import SessionOut, TelegramAuth, UserOut
from nox.security import create_session, token_digest

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


@router.post("/demo", response_model=SessionOut)
async def demo_login(request: Request, session: DBSession) -> SessionOut:
    settings = cast(Settings, request.app.state.settings)
    if settings.mode != "demo":
        raise HTTPException(404, "Не найдено")
    user = await session.get(User, 1001)
    if user is None:
        raise HTTPException(503, "Сначала выполните python -m nox.seed")
    token = await create_session(session, user.id, settings.session_ttl_seconds)
    return SessionOut(
        access_token=token, user=UserOut(id=user.id, first_name=user.first_name), mode="demo"
    )


@router.post("/telegram", response_model=SessionOut)
async def telegram_login(data: TelegramAuth, request: Request, session: DBSession) -> SessionOut:
    settings = cast(Settings, request.app.state.settings)
    if not settings.bot_token:
        raise HTTPException(503, "Telegram ещё не настроен")
    try:
        identity = verify_init_data(
            data.init_data,
            settings.bot_token,
            settings.init_data_max_age_seconds,
        )
    except ValueError as error:
        raise HTTPException(401, "Подпись Telegram недействительна или устарела") from error
    redis = cast(Redis, request.app.state.redis)
    try:
        accepted = await redis.set(
            "auth:replay:" + init_data_fingerprint(data.init_data),
            "1",
            nx=True,
            ex=settings.init_data_max_age_seconds + 31,
        )
    except RedisError as error:
        raise HTTPException(503, "Защита авторизации временно недоступна") from error
    if not accepted:
        raise HTTPException(409, "Данные Telegram уже использованы. Откройте Mini App заново")
    user = await session.get(User, identity.id)
    if user is None:
        user = User(id=identity.id, first_name=identity.first_name, username=identity.username)
        session.add(user)
    else:
        user.first_name = identity.first_name
        user.username = identity.username
    await session.flush()
    token = await create_session(session, identity.id, settings.session_ttl_seconds)
    return SessionOut(
        access_token=token, user=UserOut(id=user.id, first_name=user.first_name), mode=settings.mode
    )


@router.post("/logout", status_code=204)
async def logout(request: Request, session: DBSession, actor: Actor) -> None:
    token = request.headers.get("authorization", "").split(" ", 1)[-1]
    await session.execute(delete(Session).where(Session.token_hash == token_digest(token)))
    await session.commit()
