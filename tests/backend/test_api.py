from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from nox.config import Settings
from nox.db import Base
from nox.main import create_app
from nox.models import AnalyticsAggregate, Session
from nox.security import token_digest
from nox.seed import DEMO_CHAT_ID, seed_demo
from nox.telegram import DemoTelegramGateway, TelegramGatewayError
from sqlalchemy import select, update


@pytest.fixture
async def client(tmp_path: Path) -> AsyncIterator[AsyncClient]:
    settings = Settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}", mode="demo")
    app = create_app(settings)
    async with app.state.db.engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    await seed_demo(app.state.db)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        http._nox_app = app  # type: ignore[attr-defined]
        yield http
    await app.state.db.close()
    await app.state.redis.aclose()


async def login(client: AsyncClient) -> str:
    response = await client.post("/api/v1/auth/demo", json={})
    assert response.status_code == 200
    token: str = response.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"
    return token


async def test_demo_login_issues_only_hashed_server_session(client: AsyncClient) -> None:
    token = await login(client)
    app = client._nox_app  # type: ignore[attr-defined]
    async with app.state.db.sessions() as session:
        stored = await session.scalar(select(Session))
        assert stored.token_hash == token_digest(token)
        assert token not in stored.token_hash
    assert (await client.get("/api/v1/chats")).json()[0]["id"] == DEMO_CHAT_ID


async def test_all_implemented_dashboard_routes_use_seeded_database(client: AsyncClient) -> None:
    await login(client)
    for path in (
        "dashboard",
        "members",
        "cases",
        "shield",
        "automation",
        "analytics",
        "settings",
        "audit",
        "appeals",
        "intelligence",
    ):
        response = await client.get(f"/api/v1/chats/{DEMO_CHAT_ID}/{path}")
        assert response.status_code == 200, (path, response.text)
    dashboard = (await client.get(f"/api/v1/chats/{DEMO_CHAT_ID}/dashboard")).json()
    assert dashboard["mode"] == "demo"
    assert dashboard["stats"]["members"] == 8247
    assert len(dashboard["activity"]) == 14


async def test_auth_and_cross_chat_access_fail_closed(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/chats")).status_code == 401
    await login(client)
    assert (await client.get("/api/v1/chats/-1009999/dashboard")).status_code == 403
    assert (
        await client.patch("/api/v1/chats/-1009999/settings", json={"warn_limit": 4})
    ).status_code == 403


async def test_expired_server_session_is_rejected(client: AsyncClient) -> None:
    token = await login(client)
    app = client._nox_app  # type: ignore[attr-defined]
    async with app.state.db.sessions() as session:
        stored = await session.get(Session, token_digest(token))
        stored.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()
    assert (await client.get("/api/v1/chats")).status_code == 401


async def test_settings_shield_rules_persist_and_preview_has_no_side_effect(
    client: AsyncClient,
) -> None:
    await login(client)
    base = f"/api/v1/chats/{DEMO_CHAT_ID}"
    patch = await client.patch(f"{base}/settings", json={"warn_limit": 5})
    assert patch.status_code == 200
    assert (await client.get(f"{base}/settings")).json()["warn_limit"] == 5
    assert (await client.patch(f"{base}/settings", json={"ai_enabled": True})).status_code == 422
    response = await client.patch(
        f"{base}/shield",
        json={
            "modules": [
                {"key": "anti_link", "enabled": True, "sensitivity": 75},
            ]
        },
    )
    assert response.status_code == 200
    link = next(m for m in response.json()["modules"] if m["key"] == "anti_link")
    assert link["enabled"] is True and link["sensitivity"] == 75
    before = (await client.get(f"{base}/automation")).json()["total"]
    preview = await client.post(
        f"{base}/automation/preview",
        json={
            "trigger": "flood",
            "conditions": {"threshold": 4},
            "action": "delete",
        },
    )
    assert preview.status_code == 200
    assert preview.json()["side_effects"] is False
    assert (await client.get(f"{base}/automation")).json()["total"] == before
    created = await client.post(
        f"{base}/automation",
        json={
            "name": "Flood guard",
            "trigger": "flood",
            "conditions": {"threshold": 4},
            "action": "delete",
            "enabled": True,
        },
    )
    assert created.status_code == 201
    disabled = await client.patch(
        f"{base}/automation/{created.json()['id']}", json={"enabled": False}
    )
    assert disabled.status_code == 200 and disabled.json()["enabled"] is False


async def test_moderation_replay_conflict_revoke_and_no_false_success(client: AsyncClient) -> None:
    await login(client)
    base = f"/api/v1/chats/{DEMO_CHAT_ID}/cases"
    body = {
        "target_user_id": 1007,
        "kind": "ban",
        "reason": "Тест",
        "idempotency_key": "api-idempotency-test",
    }
    first = await client.post(base, json=body)
    assert first.status_code == 201 and first.json()["status"] == "applied"
    replay = await client.post(base, json=body)
    assert replay.status_code == 201 and replay.json()["id"] == first.json()["id"]
    mismatch = await client.post(base, json={**body, "reason": "Different"})
    assert mismatch.status_code == 409
    revoked = await client.post(f"{base}/{first.json()['id']}/revoke")
    assert revoked.status_code == 200 and revoked.json()["status"] == "revoked"
    app = client._nox_app  # type: ignore[attr-defined]
    assert app.state.gateway.actions == [("ban", DEMO_CHAT_ID, 1007), ("unban", DEMO_CHAT_ID, 1007)]

    class UncertainGateway(DemoTelegramGateway):
        async def perform(
            self, action: str, chat_id: int, target_id: int, until_date: datetime | None = None
        ) -> None:
            raise TelegramGatewayError("timeout", "Unknown result", ambiguous=True)

    app.state.gateway = UncertainGateway()
    unknown = await client.post(base, json={**body, "idempotency_key": "ambiguous-test-key"})
    assert unknown.status_code == 502
    assert unknown.json()["error"]["message"]["status"] == "unknown"


async def test_protected_target_and_invalid_data_do_not_create_cases(client: AsyncClient) -> None:
    await login(client)
    base = f"/api/v1/chats/{DEMO_CHAT_ID}/cases"
    body = {
        "target_user_id": 1001,
        "kind": "ban",
        "reason": "Test",
        "idempotency_key": "protected-test-key",
    }
    assert (await client.post(base, json=body)).status_code == 403
    assert (
        await client.post(base, json={**body, "target_user_id": 1007, "role": "owner"})
    ).status_code == 422
    assert (
        await client.post(base, json={**body, "kind": "warn", "duration_minutes": 60})
    ).status_code == 422


async def test_growth_omits_unavailable_membership_snapshots(client: AsyncClient) -> None:
    await login(client)
    app = client._nox_app  # type: ignore[attr-defined]
    async with app.state.db.sessions() as session:
        await session.execute(
            update(AnalyticsAggregate)
            .where(
                AnalyticsAggregate.chat_id == DEMO_CHAT_ID,
            )
            .values(members=0)
        )
        await session.commit()
    response = await client.get(f"/api/v1/chats/{DEMO_CHAT_ID}/analytics")
    assert response.status_code == 200
    assert response.json()["growth"] == []
    assert response.json()["coverage"]["member_snapshots_complete"] is False
    assert response.json()["notice"]
    assert response.json()["summary"]["messages"] > 0
