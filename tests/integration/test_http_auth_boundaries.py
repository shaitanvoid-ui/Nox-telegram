"""HTTP authentication contract tests, including replay protection with real Redis."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import parse_qsl, urlencode
from uuid import uuid4

import httpx
import pytest
from nox.config import Settings
from nox.db import Base, Database
from nox.main import create_app
from nox.models import Session, User
from nox.security import create_session
from redis.exceptions import RedisError
from sqlalchemy import func, select

TOKEN = "123456789:development-test-token-no-real-credentials"


def telegram_data() -> str:
    fields = {
        "auth_date": str(int(time.time())),
        "query_id": str(uuid4()),
        "user": json.dumps({"id": 7123, "first_name": "Authenticated User"}),
    }
    check = "\n".join(f"{key}={value}" for key, value in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


@asynccontextmanager
async def authenticated_client(
    directory: Path, *, rate_limit: int = 100
) -> AsyncIterator[tuple[httpx.AsyncClient, Database, str]]:
    app = create_app(
        Settings(
            _env_file=None,
            mode="demo",
            database_url=f"sqlite+aiosqlite:///{directory}/api.db",
            redis_url=os.environ.get("NOX_TEST_REDIS_URL", "redis://127.0.0.1:6379/15"),
            bot_token=TOKEN,
            api_rate_limit=rate_limit,
        )
    )
    db: Database = app.state.db
    async with app.router.lifespan_context(app):
        async with db.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with db.sessions() as session:
            session.add(User(id=1001, first_name="Demo User", username=None))
            await session.flush()
            token = await create_session(session, 1001, 3600)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://nox.test"
        ) as client:
            client.headers["Authorization"] = f"Bearer {token}"
            yield client, db, token


@pytest.mark.parametrize("scheme", ["bearer", "bEaReR"])
async def test_logout_invalidates_session_for_case_insensitive_scheme(
    tmp_path: Path, scheme: str
) -> None:
    async with authenticated_client(tmp_path) as (client, db, token):
        response = await client.post(
            "/api/v1/auth/logout", headers={"Authorization": f"{scheme} {token}"}
        )
        assert response.status_code == 204
        assert (await client.get("/api/v1/chats")).status_code == 401
        async with db.sessions() as session:
            assert await session.scalar(select(func.count()).select_from(Session)) == 0


async def test_bearer_scheme_case_cannot_bypass_rate_limit(tmp_path: Path) -> None:
    async with authenticated_client(tmp_path, rate_limit=2) as (client, _, token):
        responses = [
            await client.get("/api/v1/chats", headers={"Authorization": f"{scheme} {token}"})
            for scheme in ["Bearer", "bearer", "BEARER"]
        ]
        assert [response.status_code for response in responses] == [200, 200, 429]
        assert "Retry-After" in responses[-1].headers


async def test_validation_error_does_not_echo_rejected_authentication_material(
    tmp_path: Path,
) -> None:
    sensitive = "rejected-sensitive-init-data-" + uuid4().hex
    async with authenticated_client(tmp_path) as (client, _, _):
        response = await client.post(
            "/api/v1/auth/telegram", json={"init_data": sensitive, "unexpected": sensitive}
        )
        assert response.status_code == 422
        assert sensitive not in response.text
        assert response.json()["error"]["code"] == "validation"


async def test_parallel_init_data_replay_mints_exactly_one_session(tmp_path: Path) -> None:
    if not os.environ.get("NOX_TEST_REDIS_URL"):
        pytest.skip("Set NOX_TEST_REDIS_URL for shared atomic replay protection")
    data = telegram_data()
    reordered = urlencode(list(reversed(parse_qsl(data))))
    async with authenticated_client(tmp_path) as (client, db, _):
        responses = await asyncio.gather(
            *(
                client.post("/api/v1/auth/telegram", json={"init_data": value})
                for value in [data, reordered] * 6
            )
        )
        assert sorted(response.status_code for response in responses) == [200] + [409] * 11
        async with db.sessions() as session:
            assert (
                await session.scalar(
                    select(func.count()).select_from(Session).where(Session.user_id == 7123)
                )
                == 1
            )


class UnavailableReplayStore:
    async def set(self, *args: object, **kwargs: object) -> bool:
        raise RedisError("Replay store is unavailable")


async def test_authentication_fails_closed_when_replay_store_is_unavailable(
    tmp_path: Path,
) -> None:
    async with authenticated_client(tmp_path) as (client, db, _):
        client._transport.app.state.redis = UnavailableReplayStore()
        response = await client.post("/api/v1/auth/telegram", json={"init_data": telegram_data()})
        assert response.status_code == 503
        async with db.sessions() as session:
            assert await session.get(User, 7123) is None
