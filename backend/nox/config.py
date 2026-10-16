from functools import lru_cache
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="NOX_", extra="ignore")

    mode: Literal["demo", "production"] = "demo"
    database_url: str = "sqlite+aiosqlite:///./nox-demo.db"
    redis_url: str = "redis://localhost:6379/0"
    bot_token: str = ""
    webhook_secret: str = ""
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    session_ttl_seconds: int = 3600
    init_data_max_age_seconds: int = 300
    api_rate_limit: int = 120
    ai_provider: Literal["disabled"] = "disabled"
    telegram_timeout_seconds: float = 15.0

    @field_validator("session_ttl_seconds", "init_data_max_age_seconds", "api_rate_limit")
    @classmethod
    def positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("Must be positive")
        return value

    @model_validator(mode="after")
    def production_guard(self) -> "Settings":
        if self.mode == "production":
            if not self.bot_token or len(self.webhook_secret) < 32:
                raise ValueError("Production needs bot token and webhook secret of >=32 characters")
            if not self.database_url.startswith("postgresql+asyncpg://"):
                raise ValueError("Production requires PostgreSQL via asyncpg")
            if not self.cors_origins or any(
                not origin.startswith("https://") or origin == "https://*"
                for origin in self.cors_origins
            ):
                raise ValueError("Production requires explicit HTTPS CORS origins")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
