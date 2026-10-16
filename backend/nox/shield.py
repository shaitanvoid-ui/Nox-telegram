"""Fast deterministic Shield rules with privacy-preserving Redis window counters.

Heuristics create review events. Only flood/duplicate and explicitly forbidden
links are eligible for message removal; uncertain scam signals never ban users.
"""

from __future__ import annotations

import hashlib
import logging
import re
import unicodedata
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Protocol, cast
from urllib.parse import urlsplit

from redis.exceptions import RedisError

logger = logging.getLogger(__name__)

_COUNTER_LUA = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
"""
_URL = re.compile(r"(?:https?://|www\.|t\.me/|telegram\.me/)[^\s<>]+", re.IGNORECASE)
_MENTION = re.compile(r"(?<!\w)@[a-zA-Z0-9_]{5,32}\b")
_SCAM = re.compile(
    r"(?:seed\s*phrase|сид[ -]?фраз|private\s*key|приватн\w*\s+ключ|"
    r"удво[ию]\w*\s+(?:крипт|биткоин|депозит)|гарантированн\w*\s+доход)",
    re.IGNORECASE,
)


class RedisCounter(Protocol):
    async def eval(self, script: str, numkeys: int, *keys_and_args: object) -> object: ...


@dataclass(frozen=True)
class ShieldPolicy:
    key: str
    enabled: bool = True
    sensitivity: int = 50
    allowed_domains: tuple[str, ...] = ()
    exempt_roles: tuple[str, ...] = ("owner", "admin", "moderator")

    def __post_init__(self) -> None:
        if not 1 <= self.sensitivity <= 100:
            raise ValueError("Shield sensitivity must be between 1 and 100")


@dataclass(frozen=True)
class ShieldMessage:
    chat_id: int
    user_id: int
    text: str
    role: str = "member"
    is_bot: bool = False
    is_edit: bool = False
    mention_count: int = 0
    # Identifiers are used for event deduplication, never content persistence.
    message_id: int = 0
    urls: tuple[str, ...] = ()


@dataclass(frozen=True)
class ShieldDecision:
    module: str
    reason: str
    action: str = "review"
    confidence: float = 1.0
    count: int = 1


class ShieldEngine:
    def __init__(self, redis: RedisCounter | None) -> None:
        self.redis = redis

    async def _count(self, key: str, seconds: int) -> int | None:
        if self.redis is None:
            return None
        try:
            value = await cast(Awaitable[object], self.redis.eval(_COUNTER_LUA, 1, key, seconds))
            return int(value) if isinstance(value, (str, bytes, int)) else None
        except (RedisError, OSError, TimeoutError, ValueError, TypeError):
            # Redis failure does not turn one message into a flood or disable
            # stateless filters. Do not persist/log raw message content.
            logger.warning("shield_counter_unavailable")
            return None

    async def evaluate(
        self, message: ShieldMessage, policies: list[ShieldPolicy]
    ) -> list[ShieldDecision]:
        text = unicodedata.normalize("NFKC", message.text)
        decisions: list[ShieldDecision] = []
        counts: dict[str, int | None] = {}
        for policy in policies:
            if not policy.enabled or message.role in policy.exempt_roles:
                continue
            prefix = f"nox:shield:{message.chat_id}:{message.user_id}"
            key = policy.key.replace("-", "_")
            # Support explicit UI names without changing persisted identifiers.
            key = {
                "flood": "anti_flood",
                "duplicate": "anti_duplicate",
                "links": "anti_link",
                "mentions": "anti_mention",
                "scam": "anti_scam",
                "bots": "anti_bot",
            }.get(key, key)
            if key in {"anti_flood", "anti_spam"}:
                limit = max(3, 13 - policy.sensitivity // 10)
                flood_key = f"{prefix}:flood"
                if flood_key not in counts:
                    counts[flood_key] = await self._count(flood_key, 10)
                count = counts[flood_key]
                if count is not None and count > limit:
                    decisions.append(
                        ShieldDecision(
                            policy.key,
                            f"Более {limit} сообщений за 10 секунд.",
                            "delete",
                            count=count,
                        )
                    )
            elif key == "anti_duplicate" and len(text.strip()) >= 12:
                normalized = " ".join(text.casefold().split())
                digest = hashlib.sha256(normalized.encode()).hexdigest()[:24]
                count = await self._count(f"{prefix}:duplicate:{digest}", 60)
                limit = 2 if policy.sensitivity >= 70 else 3
                if count is not None and count > limit:
                    decisions.append(
                        ShieldDecision(
                            policy.key, f"Повтор сообщения более {limit} раз за минуту.", "delete"
                        )
                    )
            elif key == "anti_link":
                links = _URL.findall(text) + list(message.urls)
                allowed = {domain.casefold().rstrip(".") for domain in policy.allowed_domains}
                for url in links:
                    try:
                        parsed = urlsplit(url if "://" in url else "https://" + url)
                        host = (parsed.hostname or "").casefold().rstrip(".")
                    except ValueError:
                        host = ""  # Malformed URLs are outside any allowlist.
                    if host not in allowed:
                        decisions.append(
                            ShieldDecision(
                                policy.key, "Ссылка вне разрешённого списка доменов.", "delete"
                            )
                        )
                        break
            elif key == "anti_mention":
                limit = max(3, 12 - policy.sensitivity // 10)
                count = max(message.mention_count, len(_MENTION.findall(text)))
                if count > limit:
                    decisions.append(
                        ShieldDecision(
                            policy.key, f"В сообщении более {limit} упоминаний.", "delete"
                        )
                    )
            elif key == "anti_scam" and _SCAM.search(text):
                decisions.append(
                    ShieldDecision(
                        policy.key,
                        "Эвристика: запрос секретной фразы или обещание дохода. Нужна проверка.",
                        confidence=0.72,
                    )
                )
            elif key == "anti_bot" and message.is_bot:
                decisions.append(
                    ShieldDecision(
                        policy.key, "Сообщение от бота; требуется проверка правил сообщества."
                    )
                )
            elif key == "edit_guard" and message.is_edit and (_URL.search(text) or message.urls):
                decisions.append(
                    ShieldDecision(policy.key, "Ссылка в изменённом сообщении; требуется проверка.")
                )
        return decisions

    async def joins(self, chat_id: int, *, sensitivity: int = 50) -> ShieldDecision | None:
        """A join spike is a review alert, never evidence against all new users."""
        count = await self._count(f"nox:shield:{chat_id}:joins", 30)
        limit = max(8, 30 - sensitivity // 5)
        if count is not None and count > limit:
            return ShieldDecision(
                "anti_raid",
                f"Более {limit} вступлений за 30 секунд. Проверьте всплеск.",
                confidence=0.65,
            )
        return None
