from collections.abc import AsyncIterator
from typing import Annotated, cast

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from nox.db import Database
from nox.models import User
from nox.security import authenticate

bearer = HTTPBearer(auto_error=False)


async def db_session(request: Request) -> AsyncIterator[AsyncSession]:
    db = cast(Database, request.app.state.db)
    async with db.sessions() as session:
        yield session


DBSession = Annotated[AsyncSession, Depends(db_session)]


async def current_user(
    session: DBSession,
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    user = await authenticate(session, credentials.credentials) if credentials else None
    if user is None:
        raise HTTPException(401, "Сессия отсутствует или истекла")
    chat_id = request.path_params.get("chat_id")
    if chat_id is not None and request.app.state.settings.mode == "production":
        from nox.models import ChatMember

        member = await session.get(ChatMember, (int(chat_id), user.id))
        if member and member.role in {"owner", "admin", "moderator"}:
            await request.app.state.gateway.assert_admin(int(chat_id), user.id)
    return user


Actor = Annotated[User, Depends(current_user)]
