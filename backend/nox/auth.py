"""Server-side Telegram Mini App authentication.

An authenticated identity still contains user-controlled display text. Escape it
when rendering HTML and derive chat permissions separately on the server.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl

_MAX_INIT_DATA_BYTES = 32_768
_MAX_TELEGRAM_ID = (1 << 63) - 1
_PARAMETER_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
_HASH = re.compile(r"[0-9a-fA-F]{64}\Z")
_USERNAME = re.compile(r"[A-Za-z0-9_]{1,32}\Z")
_INVALID_PERCENT_ESCAPE = re.compile(r"%(?![0-9a-fA-F]{2})")


@dataclass(frozen=True, slots=True)
class TelegramIdentity:
    id: int
    first_name: str
    username: str | None


def _parameters(init_data: str) -> dict[str, str]:
    if not isinstance(init_data, str) or not init_data:
        raise ValueError("Missing Telegram initData")
    try:
        size = len(init_data.encode("utf-8"))
    except UnicodeError as exc:
        raise ValueError("Invalid Telegram initData encoding") from exc
    if size > _MAX_INIT_DATA_BYTES or _INVALID_PERCENT_ESCAPE.search(init_data):
        raise ValueError("Invalid Telegram initData")
    try:
        pairs = parse_qsl(
            init_data,
            keep_blank_values=True,
            strict_parsing=True,
            encoding="utf-8",
            errors="strict",
            max_num_fields=32,
        )
    except (ValueError, UnicodeError) as exc:
        raise ValueError("Malformed Telegram initData") from exc
    parameters: dict[str, str] = {}
    for key, value in pairs:
        if key in parameters:
            raise ValueError("Duplicate Telegram initData parameter")
        if not _PARAMETER_NAME.fullmatch(key) or "\n" in value or "\r" in value:
            raise ValueError("Invalid Telegram initData parameter")
        parameters[key] = value
    if not _HASH.fullmatch(parameters.get("hash", "")):
        raise ValueError("Invalid Telegram initData hash")
    return parameters


def _unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate Telegram user property")
        result[key] = value
    return result


def _reject_json_constant(value: str) -> None:
    raise ValueError("Invalid Telegram user JSON constant")


def _identity(raw_user: str) -> TelegramIdentity:
    try:
        user = json.loads(
            raw_user,
            object_pairs_hook=_unique_json_object,
            parse_constant=_reject_json_constant,
        )
    except (ValueError, TypeError, RecursionError) as exc:
        raise ValueError("Invalid Telegram user") from exc
    if not isinstance(user, dict):
        raise ValueError("Invalid Telegram user")
    user_id = user.get("id")
    if type(user_id) is not int or not 0 < user_id <= _MAX_TELEGRAM_ID:
        raise ValueError("Invalid Telegram user identifier")
    first_name = user.get("first_name")
    if (
        not isinstance(first_name, str)
        or not first_name.strip()
        or len(first_name) > 256
        or any(ord(character) < 32 or 127 <= ord(character) < 160 for character in first_name)
        or any(0xD800 <= ord(character) <= 0xDFFF for character in first_name)
    ):
        raise ValueError("Invalid Telegram first name")
    username = user.get("username")
    if username is not None and (
        not isinstance(username, str) or not _USERNAME.fullmatch(username)
    ):
        raise ValueError("Invalid Telegram username")
    return TelegramIdentity(user_id, first_name, username)


def verify_init_data(
    init_data: str,
    bot_token: str,
    max_age_seconds: int = 300,
    now: int | None = None,
) -> TelegramIdentity:
    """Verify Telegram's HMAC, freshness and typed identity; raise ValueError.

    The caller must consume ``init_data_fingerprint`` atomically in a shared
    replay store before issuing a session. Authorization is a separate step.
    """
    if not isinstance(bot_token, str) or not bot_token:
        raise ValueError("Telegram authentication is not configured")
    if type(max_age_seconds) is not int or max_age_seconds <= 0:
        raise ValueError("Invalid authentication lifetime")
    if now is not None and (type(now) is not int or now < 0):
        raise ValueError("Invalid authentication clock")
    parameters = _parameters(init_data)
    data_check_string = "\n".join(
        f"{key}={value}" for key, value in sorted(parameters.items()) if key != "hash"
    )
    secret = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    expected = hmac.new(secret, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, parameters["hash"].lower()):
        raise ValueError("Invalid Telegram initData signature")
    raw_auth_date = parameters.get("auth_date", "")
    if not re.fullmatch(r"[0-9]{1,12}", raw_auth_date):
        raise ValueError("Invalid Telegram authentication date")
    auth_date = int(raw_auth_date)
    current_time = int(time.time()) if now is None else now
    if auth_date > current_time + 30 or current_time - auth_date > max_age_seconds:
        raise ValueError("Expired or future Telegram authentication data")
    return _identity(parameters.get("user", ""))


def init_data_fingerprint(init_data: str) -> str:
    """Stable replay key, including across URL reordering and encoding changes.

    This does not authenticate anything. Call only after ``verify_init_data``
    and atomically consume the key for at least ``max_age_seconds + 30``.
    """
    parameters = _parameters(init_data)
    return hashlib.sha256(bytes.fromhex(parameters["hash"])).hexdigest()
