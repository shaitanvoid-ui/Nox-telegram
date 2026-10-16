"""Launch a disposable real NOX API for browser tests; never contact Telegram."""

import asyncio
import os
import tempfile
from pathlib import Path

import uvicorn


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="nox-browser-tests-") as directory:
        os.environ.update(
            NOX_MODE="demo",
            NOX_BOT_TOKEN="",
            NOX_WEBHOOK_SECRET="",
            NOX_DATABASE_URL=f"sqlite+aiosqlite:///{Path(directory) / 'browser.db'}",
            NOX_API_RATE_LIMIT="2000",
        )
        from nox.seed import main as seed

        asyncio.run(seed())
        uvicorn.run("nox.main:app", host="127.0.0.1", port=8010, log_level="warning")


if __name__ == "__main__":
    main()
