"""The production ingress validates safely and acknowledges durable receipts only."""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from nox import bot, main
from nox.config import Settings
from nox.db import Base, Database
from nox.models import ProcessedUpdate
from nox.telegram import DemoTelegramGateway
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

SECRET = "Webhook-secret_" + "a" * 32
WEBHOOK = "/api/v1/telegram/webhook"


def production_settings(**overrides: Any) -> Settings:
    return Settings(
        _env_file=None,
        mode="production",
        bot_token="123456789:never-a-real-bot-credential",
        webhook_secret=overrides.pop("webhook_secret", SECRET),
        database_url="postgresql+asyncpg://unused:unused@127.0.0.1/unused",
        cors_origins=["https://nox.example"],
        **overrides,
    )


@pytest.fixture
async def webhook_client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[tuple[httpx.AsyncClient, Database]]:
    # Exercise production ingress against a disposable real SQL database; no Telegram calls.
    db = Database(f"sqlite+aiosqlite:///{tmp_path / 'webhook.db'}")
    monkeypatch.setattr(main, "Database", lambda url: db)
    app = main.create_app(production_settings(), gateway=DemoTelegramGateway())
    async with app.router.lifespan_context(app):
        async with db.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://nox.test",
            headers={"X-Telegram-Bot-Api-Secret-Token": SECRET},
        ) as client:
            yield client, db


@pytest.mark.parametrize("secret", ["", "x" * 31, "x" * 257, "x" * 31 + "+", "ю" * 32])
def test_production_rejects_unsupported_webhook_secrets_without_echoing_values(secret: str) -> None:
    with pytest.raises(ValidationError) as caught:
        production_settings(webhook_secret=secret)
    if secret:
        assert secret not in str(caught.value)


@pytest.mark.parametrize("secret", ["_" * 32, "-" * 256, SECRET])
def test_production_accepts_telegram_compatible_webhook_secret(secret: str) -> None:
    assert production_settings(webhook_secret=secret).webhook_secret == secret


async def test_non_ascii_webhook_secret_is_denied_without_server_error(
    webhook_client: tuple[httpx.AsyncClient, Database],
) -> None:
    client, db = webhook_client
    response = await client.post(
        WEBHOOK,
        json={"update_id": 123},
        headers=[
            (b"x-telegram-bot-api-secret-token", b"\xff\xfe"),
        ],
    )
    assert response.status_code == 403
    async with db.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(ProcessedUpdate)) == 0


@pytest.mark.parametrize(
    "body",
    [
        b'{"update_id":"private-invalid-update"}',
        b'{"update_id":123,"message":{"text":"private-invalid-update"}}',
        b'{"private-invalid-update":',
        b"\xffprivate-invalid-update",
        b'["private-invalid-update"]',
    ],
)
async def test_malformed_webhook_update_is_generic_422_and_never_queued(
    webhook_client: tuple[httpx.AsyncClient, Database],
    body: bytes,
) -> None:
    client, db = webhook_client
    response = await client.post(WEBHOOK, content=body)
    assert response.status_code == 422
    assert "private-invalid-update" not in response.text
    assert response.json()["error"]["message"] == "Некорректный Telegram update"
    async with db.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(ProcessedUpdate)) == 0


async def test_webhook_acknowledges_only_after_durable_commit_and_deduplicates(
    webhook_client: tuple[httpx.AsyncClient, Database],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, db = webhook_client
    started, release = asyncio.Event(), asyncio.Event()
    original_enqueue = bot.enqueue_update

    async def delayed_enqueue(database: Database, payload: dict[str, Any]) -> bool:
        started.set()
        await release.wait()
        return await original_enqueue(database, payload)

    monkeypatch.setattr(bot, "enqueue_update", delayed_enqueue)
    pending = asyncio.create_task(client.post(WEBHOOK, json={"update_id": 111}))
    await asyncio.wait_for(started.wait(), timeout=5)
    try:
        assert not pending.done()
    finally:
        release.set()
    response = await pending
    assert response.status_code == 200 and response.json() == {"ok": True}
    async with db.sessions() as session:
        assert await session.get(ProcessedUpdate, 111) is not None
    duplicate = await client.post(WEBHOOK, json={"update_id": 111})
    assert duplicate.status_code == 200
    async with db.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(ProcessedUpdate)) == 1


async def test_failed_receipt_write_never_returns_success(
    webhook_client: tuple[httpx.AsyncClient, Database],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, db = webhook_client

    async def unavailable(database: Database, payload: dict[str, Any]) -> bool:
        raise OperationalError("private-update-data", {}, OSError("database unavailable"))

    monkeypatch.setattr(bot, "enqueue_update", unavailable)
    response = await client.post(WEBHOOK, json={"update_id": 222})
    assert response.status_code == 503
    assert "private-update-data" not in response.text
    async with db.sessions() as session:
        assert await session.get(ProcessedUpdate, 222) is None
