"""Untrusted message parsing and shared Redis counter regression tests."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from uuid import uuid4

import pytest
import pytest_asyncio
from nox.shield import ShieldEngine, ShieldMessage, ShieldPolicy
from redis.asyncio import Redis


@pytest.mark.parametrize("text", ["https://[invalid", "https://[::", "https://[::gg]"])
async def test_malformed_url_never_crashes_moderation_pipeline(text: str) -> None:
    decisions = await ShieldEngine(None).evaluate(
        ShieldMessage(chat_id=-1, user_id=2, text=text),
        [ShieldPolicy("anti_link")],
    )
    assert any(decision.module == "anti_link" for decision in decisions)
    assert all(decision.action in {"review", "delete"} for decision in decisions)


@pytest_asyncio.fixture
async def shield_redis() -> AsyncIterator[tuple[Redis, int]]:
    url = os.environ.get("NOX_TEST_REDIS_URL")
    if not url:
        pytest.skip("Set NOX_TEST_REDIS_URL to run real Redis concurrency tests")
    client = Redis.from_url(url)
    await client.ping()
    # Negative Telegram-style id isolates this test from application counters.
    chat_id = -int(uuid4().hex[:12], 16)
    try:
        yield client, chat_id
    finally:
        keys = [key async for key in client.scan_iter(match=f"nox:shield:{chat_id}:*")]
        if keys:
            await client.delete(*keys)
        await client.aclose()


async def test_spam_and_flood_count_each_message_once(shield_redis: tuple[Redis, int]) -> None:
    client, chat_id = shield_redis
    engine = ShieldEngine(client)
    policies = [
        ShieldPolicy("anti_spam", sensitivity=50),
        ShieldPolicy("anti_flood", sensitivity=50),
    ]
    for index in range(8):
        decisions = await engine.evaluate(
            ShieldMessage(chat_id=chat_id, user_id=2, text=f"Message {index}"), policies
        )
        assert decisions == [], "Two enabled modules must not double-count one real message"
    decisions = await engine.evaluate(
        ShieldMessage(chat_id=chat_id, user_id=2, text="Ninth message"), policies
    )
    assert {decision.module for decision in decisions} == {"anti_spam", "anti_flood"}


async def test_concurrent_flood_counter_has_no_lost_updates(
    shield_redis: tuple[Redis, int],
) -> None:
    client, chat_id = shield_redis
    engine = ShieldEngine(client)
    results = await asyncio.gather(
        *(
            engine.evaluate(
                ShieldMessage(chat_id=chat_id, user_id=2, text=f"Concurrent {index}"),
                [ShieldPolicy("anti_flood", sensitivity=50)],
            )
            for index in range(24)
        )
    )
    assert sum(bool(decisions) for decisions in results) == 16
