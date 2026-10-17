"""Explicit synthetic local data; refuses production and never calls Telegram."""

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from nox.api_operations import SHIELD_NAMES
from nox.config import get_settings
from nox.db import Base, Database
from nox.models import (
    AnalyticsAggregate,
    AuditEvent,
    AutomationRule,
    Chat,
    ChatMember,
    ModerationCase,
    ShieldModule,
    User,
)

DEMO_CHAT_ID = -1001001


async def seed_demo(db: Database) -> None:
    async with db.sessions() as session:
        if await session.get(Chat, DEMO_CHAT_ID):
            return
        people = [
            (1001, "Александр", "alex_astra", "owner"),
            (1002, "Мария", "maria_studio", "admin"),
            (1003, "Даниил", "dan_dev", "moderator"),
            (1004, "Виктор", "victor_design", "member"),
            (1005, "Анна", "anna_community", "member"),
            (1006, "Максим", "max_product", "member"),
            (1007, "София", "sofia_ui", "member"),
            (1008, "Артём", "artem_build", "member"),
        ]
        session.add(
            Chat(
                id=DEMO_CHAT_ID,
                title="Astra Community",
                member_count=8247,
                welcome_message="Добро пожаловать! Здесь мы создаём будущее.",
                warn_limit=3,
            )
        )
        session.add_all([User(id=i, first_name=n, username=u) for i, n, u, _ in people])
        await session.flush()
        session.add_all(
            [ChatMember(chat_id=DEMO_CHAT_ID, user_id=i, role=role) for i, _, _, role in people]
        )
        for index, key in enumerate(SHIELD_NAMES):
            session.add(
                ShieldModule(
                    chat_id=DEMO_CHAT_ID,
                    key=key,
                    enabled=key not in {"anti_bot", "anti_link"},
                    sensitivity=65 if key == "anti_flood" else 50,
                    events=[42, 18, 3, 12, 0, 28, 5, 0, 9, 4][index],
                )
            )
        now = datetime.now(UTC)
        message_counts = [
            1274,
            1456,
            1182,
            1620,
            1431,
            1864,
            1540,
            1742,
            2064,
            1891,
            2270,
            1924,
            2480,
            2186,
        ]
        for index, messages in enumerate(message_counts):
            day = now - timedelta(days=13 - index)
            session.add(
                AnalyticsAggregate(
                    chat_id=DEMO_CHAT_ID,
                    day=day.strftime("%Y-%m-%d"),
                    messages=messages,
                    violations=9 + index % 8,
                    members=7980 + index * 20 + index // 2,
                )
            )
        for index, (kind, reason, target) in enumerate(
            [
                ("warn", "Ссылки без согласования", 1004),
                ("mute", "Повторяющиеся сообщения · Anti-Flood", 1006),
                ("warn", "Оффтоп в основном чате", 1008),
                ("ban", "Подтверждённая рекламная рассылка", 1005),
            ]
        ):
            session.add(
                ModerationCase(
                    id=str(uuid4()),
                    chat_id=DEMO_CHAT_ID,
                    target_user_id=target,
                    actor_id=1002,
                    kind=kind,
                    reason=reason,
                    status="applied",
                    idempotency_key=f"synthetic-case-{index}",
                    request_hash="synthetic",
                    created_at=now - timedelta(minutes=7 + index * 29),
                    expires_at=now + timedelta(minutes=47) if kind == "mute" else None,
                )
            )
        session.add(
            AutomationRule(
                id=str(uuid4()),
                chat_id=DEMO_CHAT_ID,
                created_by=1001,
                name="Тёплый приём",
                trigger="member_join",
                conditions={},
                action="welcome",
                enabled=True,
                priority=70,
                executions=128,
            )
        )
        session.add(
            AutomationRule(
                id=str(uuid4()),
                chat_id=DEMO_CHAT_ID,
                created_by=1001,
                name="Тихая защита от флуда",
                trigger="flood",
                conditions={"threshold": 6},
                action="delete",
                enabled=True,
                priority=90,
                executions=42,
            )
        )
        session.add(
            AuditEvent(
                id=str(uuid4()),
                chat_id=DEMO_CHAT_ID,
                actor_id=1001,
                action="demo.seeded",
                detail="Синтетический набор. Ни одно действие не отправлялось Telegram.",
            )
        )
        await session.commit()


async def main() -> None:
    settings = get_settings()
    if settings.mode != "demo":
        raise RuntimeError("Synthetic seeding is prohibited in production")
    db = Database(settings.database_url)
    try:
        # Convenience for demo; production always uses Alembic migrations.
        async with db.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        await seed_demo(db)
        print("Astra synthetic demo ready. No Telegram API connection.")
    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
