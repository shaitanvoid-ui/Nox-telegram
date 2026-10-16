from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aiogram.exceptions import TelegramNetworkError, TelegramRetryAfter
from aiogram.methods import BanChatMember
from aiogram.types import ChatPermissions
from nox.telegram import TelegramGateway, TelegramGatewayError


def fake_bot() -> SimpleNamespace:
    members = {
        10: SimpleNamespace(status="administrator", can_restrict_members=True),
        20: SimpleNamespace(status="member"),
        999: SimpleNamespace(
            status="administrator",
            can_restrict_members=True,
            can_delete_messages=True,
        ),
    }
    return SimpleNamespace(
        get_me=AsyncMock(return_value=SimpleNamespace(id=999)),
        get_chat_member=AsyncMock(side_effect=lambda chat_id, user_id: members[user_id]),
        ban_chat_member=AsyncMock(return_value=True),
        unban_chat_member=AsyncMock(return_value=True),
        restrict_chat_member=AsyncMock(return_value=True),
        delete_message=AsyncMock(return_value=True),
        get_chat=AsyncMock(
            return_value=SimpleNamespace(
                permissions=ChatPermissions(can_send_messages=True, can_invite_users=False),
            )
        ),
        members=members,
    )


async def test_real_rights_checked_for_actor_target_and_bot() -> None:
    bot = fake_bot()
    await TelegramGateway(bot).authorize(-100, 10, 20, "ban")
    assert {call.args[1] for call in bot.get_chat_member.call_args_list} == {10, 20, 999}


@pytest.mark.parametrize(
    "user_id,status,rights,code",
    [
        (10, "member", False, "actor_forbidden"),
        (10, "administrator", False, "actor_forbidden"),
        (20, "administrator", True, "protected_target"),
        (20, "creator", True, "protected_target"),
        (999, "administrator", False, "bot_forbidden"),
    ],
)
async def test_authorization_denies_stale_or_insufficient_rights(
    user_id: int,
    status: str,
    rights: bool,
    code: str,
) -> None:
    bot = fake_bot()
    bot.members[user_id] = SimpleNamespace(status=status, can_restrict_members=rights)
    with pytest.raises(TelegramGatewayError) as caught:
        await TelegramGateway(bot).authorize(-100, 10, 20, "mute")
    assert caught.value.code == code
    bot.restrict_chat_member.assert_not_called()


async def test_owner_does_not_require_optional_can_restrict_field() -> None:
    bot = fake_bot()
    bot.members[10] = SimpleNamespace(status="creator")
    await TelegramGateway(bot).authorize(-100, 10, 20, "ban")


async def test_timeout_is_ambiguous_and_cannot_be_automatically_retried() -> None:
    bot = fake_bot()
    bot.ban_chat_member.side_effect = TelegramNetworkError(
        method=BanChatMember(chat_id=-100, user_id=20),
        message="secret transport detail",
    )
    with pytest.raises(TelegramGatewayError) as caught:
        await TelegramGateway(bot).perform("ban", -100, 20)
    assert caught.value.ambiguous and not caught.value.retryable
    assert "secret" not in str(caught.value)
    assert bot.ban_chat_member.call_count == 1


async def test_retry_after_is_known_rejection_not_success() -> None:
    bot = fake_bot()
    bot.ban_chat_member.side_effect = TelegramRetryAfter(
        method=BanChatMember(chat_id=-100, user_id=20),
        message="rate limit",
        retry_after=19,
    )
    with pytest.raises(TelegramGatewayError) as caught:
        await TelegramGateway(bot).perform("ban", -100, 20)
    assert caught.value.retryable and not caught.value.ambiguous
    assert caught.value.retry_after == 19
    assert bot.ban_chat_member.call_count == 1


async def test_false_telegram_response_is_not_a_success() -> None:
    bot = fake_bot()
    bot.ban_chat_member.return_value = False
    with pytest.raises(TelegramGatewayError, match="не подтвердил"):
        await TelegramGateway(bot).perform("ban", -100, 20)
    bot.delete_message.return_value = False
    with pytest.raises(TelegramGatewayError, match="не подтвердил"):
        await TelegramGateway(bot).delete_message(-100, 5)


async def test_unban_never_kicks_existing_member_but_kick_does() -> None:
    bot = fake_bot()
    gateway = TelegramGateway(bot)
    await gateway.perform("unban", -100, 20)
    bot.unban_chat_member.assert_awaited_with(-100, 20, only_if_banned=True)
    await gateway.perform("kick", -100, 20)
    bot.unban_chat_member.assert_awaited_with(-100, 20, only_if_banned=False)


async def test_unmute_restores_current_chat_default_permissions() -> None:
    bot = fake_bot()
    await TelegramGateway(bot).perform("unmute", -100, 20)
    permissions = bot.restrict_chat_member.call_args.kwargs["permissions"]
    assert permissions.can_send_messages is True
    assert permissions.can_invite_users is False


async def test_short_temporary_ban_cannot_accidentally_become_permanent() -> None:
    bot = fake_bot()
    with pytest.raises(TelegramGatewayError) as caught:
        await TelegramGateway(bot).perform(
            "ban", -100, 20, datetime.now(UTC) + timedelta(seconds=5)
        )
    assert caught.value.code == "invalid_duration"
    bot.ban_chat_member.assert_not_called()
