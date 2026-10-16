"""Telegram initData contract and tamper-resistance tests."""

import hashlib
import hmac
import json
from urllib.parse import parse_qsl, urlencode

import pytest
from nox.auth import TelegramIdentity, init_data_fingerprint, verify_init_data

TOKEN = "123456789:test-token-not-a-real-secret"
NOW = 1_800_000_000


def signed(
    *,
    user: object = None,
    auth_date: str = str(NOW),
    raw_user: str | None = None,
    extra: dict[str, str] | None = None,
) -> str:
    if user is None:
        user = {"id": 123, "first_name": "Алиса 🦊", "username": "alice_nox"}
    fields = {
        "auth_date": auth_date,
        "user": json.dumps(user, ensure_ascii=False) if raw_user is None else raw_user,
        "query_id": "test-query",
        **(extra or {}),
    }
    data_check = "\n".join(f"{key}={value}" for key, value in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, data_check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


def test_valid_unicode_identity() -> None:
    assert verify_init_data(signed(), TOKEN, now=NOW) == TelegramIdentity(
        id=123, first_name="Алиса 🦊", username="alice_nox"
    )


def test_optional_username_and_large_telegram_id() -> None:
    identity = verify_init_data(
        signed(user={"id": 4_503_599_627_370_495, "first_name": "User"}), TOKEN, now=NOW
    )
    assert identity.username is None


def test_signature_covers_every_field_and_uses_correct_bot() -> None:
    with pytest.raises(ValueError, match="signature"):
        verify_init_data(signed().replace("test-query", "other-query"), TOKEN, now=NOW)
    with pytest.raises(ValueError, match="signature"):
        verify_init_data(signed(), "another-token", now=NOW)


@pytest.mark.parametrize("auth_date", [str(NOW - 301), str(NOW + 31)])
def test_expired_and_future_data(auth_date: str) -> None:
    with pytest.raises(ValueError, match="Expired or future"):
        verify_init_data(signed(auth_date=auth_date), TOKEN, now=NOW)


@pytest.mark.parametrize("auth_date", [str(NOW - 300), str(NOW + 30)])
def test_freshness_boundaries(auth_date: str) -> None:
    assert verify_init_data(signed(auth_date=auth_date), TOKEN, now=NOW).id == 123


@pytest.mark.parametrize("key", ["hash", "user", "auth_date", "query_id"])
def test_duplicate_parameters_are_rejected(key: str) -> None:
    data = signed()
    values = dict(parse_qsl(data))
    with pytest.raises(ValueError, match="Duplicate"):
        verify_init_data(data + "&" + urlencode({key: values[key]}), TOKEN, now=NOW)


@pytest.mark.parametrize("auth_date", ["", "tomorrow", "-1", "1.8e9", "1800000000.0"])
def test_invalid_authentication_dates(auth_date: str) -> None:
    with pytest.raises(ValueError, match="date"):
        verify_init_data(signed(auth_date=auth_date), TOKEN, now=NOW)


@pytest.mark.parametrize("identifier", [True, False, "123", 123.0, 0, -1, 1 << 63])
def test_user_id_must_be_positive_integer(identifier: object) -> None:
    with pytest.raises(ValueError, match="identifier"):
        verify_init_data(signed(user={"id": identifier, "first_name": "User"}), TOKEN, now=NOW)


@pytest.mark.parametrize("name", ["", "   ", 123, None, "x" * 257, "User\x00", "User\n"])
def test_invalid_display_names(name: object) -> None:
    with pytest.raises(ValueError, match="first name"):
        verify_init_data(signed(user={"id": 123, "first_name": name}), TOKEN, now=NOW)


@pytest.mark.parametrize("username", [False, 123, "a b", "a/b", "x" * 33])
def test_invalid_usernames(username: object) -> None:
    with pytest.raises(ValueError, match="username"):
        verify_init_data(
            signed(user={"id": 123, "first_name": "User", "username": username}),
            TOKEN,
            now=NOW,
        )


@pytest.mark.parametrize(
    "raw_user",
    ["not-json", "[]", "123", "null", '{"id":1,"id":2,"first_name":"User"}', '{"id":NaN}'],
)
def test_malformed_user_objects(raw_user: str) -> None:
    with pytest.raises(ValueError, match="user"):
        verify_init_data(signed(raw_user=raw_user), TOKEN, now=NOW)


@pytest.mark.parametrize("data", ["", "hash=abc", "hash=%XX", "hash=%FF", "x", "x=1&&x=2"])
def test_malformed_query_string(data: str) -> None:
    with pytest.raises(ValueError):
        verify_init_data(data, TOKEN, now=NOW)


def test_signature_field_is_authenticated_too() -> None:
    data = signed(extra={"signature": "third-party-signature"})
    assert verify_init_data(data, TOKEN, now=NOW).id == 123
    with pytest.raises(ValueError, match="signature"):
        verify_init_data(data.replace("third-party-signature", "changed"), TOKEN, now=NOW)


def test_replay_key_is_stable_across_url_reordering_and_encoding() -> None:
    data = signed()
    reordered = urlencode(list(reversed(parse_qsl(data))))
    assert verify_init_data(reordered, TOKEN, now=NOW).id == 123
    assert init_data_fingerprint(data) == init_data_fingerprint(reordered)
    assert init_data_fingerprint(data) == init_data_fingerprint(data.replace("%7B", "%7b"))


def test_display_name_is_untrusted_text_not_html() -> None:
    identity = verify_init_data(
        signed(user={"id": 123, "first_name": "<b>Admin</b>"}), TOKEN, now=NOW
    )
    assert identity.first_name == "<b>Admin</b>"


def test_oversized_input_and_missing_configuration() -> None:
    with pytest.raises(ValueError):
        verify_init_data("x=" + "x" * 40_000, TOKEN, now=NOW)
    with pytest.raises(ValueError, match="not configured"):
        verify_init_data(signed(), "", now=NOW)
