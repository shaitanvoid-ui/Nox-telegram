from unittest.mock import AsyncMock

from nox.shield import ShieldEngine, ShieldMessage, ShieldPolicy
from redis.exceptions import ConnectionError


async def test_hidden_text_link_is_checked_like_visible_url() -> None:
    decisions = await ShieldEngine(None).evaluate(
        ShieldMessage(-1001, 20, "click here", urls=("https://evil.example",)),
        [ShieldPolicy("anti_link")],
    )
    assert len(decisions) == 1 and decisions[0].action == "delete"


async def test_link_allowlist_checks_exact_hostname() -> None:
    policy = [ShieldPolicy("anti_link", allowed_domains=("example.org",))]
    engine = ShieldEngine(None)
    assert await engine.evaluate(ShieldMessage(-1001, 20, "https://example.org/a"), policy) == []
    assert await engine.evaluate(ShieldMessage(-1001, 20, "https://example.org.evil/a"), policy)


async def test_redis_failure_does_not_falsely_detect_flood_and_stateless_rules_continue() -> None:
    redis = AsyncMock()
    redis.eval.side_effect = ConnectionError("unavailable")
    decisions = await ShieldEngine(redis).evaluate(
        ShieldMessage(-1001, 20, "https://evil.example"),
        [ShieldPolicy("anti_flood"), ShieldPolicy("anti_link")],
    )
    assert [decision.module for decision in decisions] == ["anti_link"]


async def test_scam_is_a_heuristic_for_review_never_a_ban() -> None:
    decisions = await ShieldEngine(None).evaluate(
        ShieldMessage(-1001, 20, "send me your seed phrase"),
        [ShieldPolicy("anti_scam")],
    )
    assert len(decisions) == 1
    assert decisions[0].action == "review" and decisions[0].confidence < 1


async def test_administrator_exemption_precedes_automatic_deletion() -> None:
    assert (
        await ShieldEngine(None).evaluate(
            ShieldMessage(-1001, 20, "https://evil.example", role="admin"),
            [ShieldPolicy("anti_link")],
        )
        == []
    )


async def test_raid_spike_produces_review_without_mass_punishment() -> None:
    redis = AsyncMock()
    redis.eval.return_value = 21
    decision = await ShieldEngine(redis).joins(-1001)
    assert decision is not None
    assert decision.action == "review" and decision.confidence < 1
