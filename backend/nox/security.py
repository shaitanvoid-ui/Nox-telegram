import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from nox.models import ChatMember, Session, User

Permission = Literal["view", "moderate", "configure", "appeal"]
ROLE_RANK = {"member": 0, "moderator": 1, "admin": 2, "owner": 3}


class AccessDenied(Exception):
    def __init__(self, message: str = "Недостаточно прав") -> None:
        self.message = message


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create_session(session: AsyncSession, user_id: int, ttl: int) -> str:
    token = secrets.token_urlsafe(48)
    session.add(
        Session(
            token_hash=token_digest(token),
            user_id=user_id,
            expires_at=datetime.now(UTC) + timedelta(seconds=ttl),
        )
    )
    await session.commit()
    return token


async def authenticate(session: AsyncSession, token: str) -> User | None:
    return cast(
        User | None,
        await session.scalar(
            select(User)
            .join(Session, Session.user_id == User.id)
            .where(
                Session.token_hash == token_digest(token),
                Session.expires_at > datetime.now(UTC),
            )
        ),
    )


async def require_permission(
    session: AsyncSession,
    chat_id: int,
    user_id: int,
    permission: Permission,
) -> ChatMember:
    member = await session.get(ChatMember, (chat_id, user_id))
    minimum = {"view": 1, "moderate": 1, "configure": 2, "appeal": 0}[permission]
    if member is None or ROLE_RANK.get(member.role, -1) < minimum:
        raise AccessDenied()
    return member


async def check_target(
    session: AsyncSession,
    chat_id: int,
    actor_id: int,
    target_id: int,
) -> None:
    actor = await require_permission(session, chat_id, actor_id, "moderate")
    target = await session.get(ChatMember, (chat_id, target_id))
    if actor_id == target_id:
        raise AccessDenied("Нельзя модерировать самого себя")
    if target is None:
        raise AccessDenied("Участник не найден в этом чате")
    if ROLE_RANK[target.role] >= ROLE_RANK[actor.role]:
        raise AccessDenied("Нельзя модерировать участника с равной или более высокой ролью")
