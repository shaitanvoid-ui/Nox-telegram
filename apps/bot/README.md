# NOX Telegram Bot

Aiogram-обработчики находятся в `backend/nox/bot.py`; прикладная модерация общая
с HTTP API. Polling: `uv run python -m nox.bot`. Обработка durable-очереди и
истечение наказаний: `uv run python -m nox.worker`.

Настройка и ограничения: [docs/bot.md](../../docs/bot.md).
