import hashlib
import hmac
import json
import time
from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from typing import Any, cast

import structlog
from aiogram import Bot
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, generate_latest
from pydantic import ValidationError
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from nox import api_auth, api_chats, api_operations, api_studio
from nox.config import Settings, get_settings
from nox.db import Database
from nox.moderation import ConflictError
from nox.moderation import TelegramGateway as GatewayProtocol
from nox.security import AccessDenied
from nox.telegram import DemoTelegramGateway, TelegramGateway, TelegramGatewayError

log = structlog.get_logger()
REQUESTS = Counter("nox_http_requests_total", "HTTP requests by status", ["status"])


def create_app(settings: Settings | None = None, gateway: GatewayProtocol | None = None) -> FastAPI:
    settings = settings or get_settings()
    db = Database(settings.database_url)
    redis = Redis.from_url(
        settings.redis_url, decode_responses=True, socket_connect_timeout=2, socket_timeout=2
    )
    selected_gateway = gateway or (
        DemoTelegramGateway()
        if settings.mode == "demo"
        else TelegramGateway(Bot(settings.bot_token))
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        structlog.configure(
            processors=[
                structlog.processors.TimeStamper(fmt="iso"),
                structlog.processors.JSONRenderer(),
            ]
        )
        try:
            yield
        finally:
            await db.close()
            await redis.aclose()
            close = getattr(selected_gateway, "close", None)
            if close:
                await close()

    app = FastAPI(title="Astra API", version="0.1.0", lifespan=lifespan)
    app.state.db, app.state.redis = db, redis
    app.state.settings, app.state.gateway = settings, selected_gateway
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Authorization", "Content-Type"],
    )
    demo_rates: dict[str, tuple[int, int]] = {}

    @app.middleware("http")
    async def guard(request: Request, call_next: Any) -> Response:
        # Auth endpoints are limited by remote IP; authenticated endpoints by token digest.
        # Proxy-supplied headers are ignored unless the deployment explicitly trusts its proxy.
        if (
            request.url.path.startswith("/api/v1/")
            and request.url.path != "/api/v1/telegram/webhook"
        ):
            client = request.client.host if request.client else "unknown"
            credential = request.headers.get("authorization", "").split(" ", 1)
            token = (
                credential[1] if len(credential) == 2 and credential[0].lower() == "bearer" else ""
            )
            minute = int(time.time()) // 60
            identities = [("ip:" + client, settings.api_rate_limit * 3)]
            if token and "/auth/" not in request.url.path:
                identities.append(("token:" + token, settings.api_rate_limit))
            else:
                identities = [("ip:" + client, settings.api_rate_limit)]
            for identity, budget in identities:
                key = hashlib.sha256(identity.encode()).hexdigest()
                if settings.mode == "demo":
                    if len(demo_rates) > 10000:
                        demo_rates.clear()
                    bucket, count = demo_rates.get(key, (minute, 0))
                    count = count + 1 if bucket == minute else 1
                    demo_rates[key] = (minute, count)
                else:
                    try:
                        count = int(
                            await cast(
                                Awaitable[int],
                                redis.eval(
                                    "local n=redis.call('INCR',KEYS[1]); "
                                    "if n==1 then redis.call('EXPIRE',KEYS[1],61) end; return n",
                                    1,
                                    f"rate:{key}:{minute}",
                                ),
                            )
                        )
                    except RedisError:
                        return JSONResponse(
                            {
                                "error": {
                                    "code": "unavailable",
                                    "message": "Защита API временно недоступна",
                                }
                            },
                            503,
                        )
                if count > budget:
                    return JSONResponse(
                        {"error": {"code": "rate_limit", "message": "Слишком часто"}},
                        429,
                        headers={"Retry-After": "60"},
                    )
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        REQUESTS.labels(str(response.status_code)).inc()
        return cast(Response, response)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            {"error": {"code": str(exc.status_code), "message": exc.detail}},
            exc.status_code,
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Do not echo initData, bearer tokens, or rejected raw user input into responses/logs.
        fields = [".".join(str(p) for p in e["loc"]) for e in exc.errors()]
        return JSONResponse(
            {"error": {"code": "validation", "message": "Проверьте поля", "fields": fields}}, 422
        )

    @app.exception_handler(AccessDenied)
    async def denied(request: Request, exc: AccessDenied) -> JSONResponse:
        return JSONResponse({"error": {"code": "forbidden", "message": exc.message}}, 403)

    @app.exception_handler(ConflictError)
    async def conflict(request: Request, exc: ConflictError) -> JSONResponse:
        return JSONResponse({"error": {"code": "conflict", "message": str(exc)}}, 409)

    @app.exception_handler(TelegramGatewayError)
    async def telegram_error(request: Request, exc: TelegramGatewayError) -> JSONResponse:
        return JSONResponse(
            {"error": {"code": exc.code, "message": str(exc)}},
            403 if exc.code.endswith("forbidden") else 502,
        )

    @app.exception_handler(IntegrityError)
    async def integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
        return JSONResponse(
            {"error": {"code": "conflict", "message": "Конфликт параллельных изменений"}}, 409
        )

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        log.error("database_unavailable", exception_type=type(exc).__name__)
        return JSONResponse(
            {"error": {"code": "unavailable", "message": "База данных временно недоступна"}}, 503
        )

    @app.exception_handler(ValueError)
    async def value_error(request: Request, exc: ValueError) -> JSONResponse:
        return JSONResponse({"error": {"code": "invalid", "message": str(exc)}}, 422)

    @app.get("/health", tags=["Operations"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "mode": settings.mode}

    @app.get("/ready", tags=["Operations"])
    async def ready() -> JSONResponse:
        try:
            async with db.sessions() as session:
                await session.execute(text("SELECT 1"))
            if settings.mode == "production":
                await cast(Awaitable[bool], redis.ping())
        except Exception:
            return JSONResponse({"status": "not_ready"}, 503)
        return JSONResponse({"status": "ready", "mode": settings.mode})

    @app.get("/metrics", include_in_schema=False)
    async def metrics() -> Response:
        # Contains aggregate metrics only. Caddy restricts public access in production.
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    @app.post("/api/v1/telegram/webhook", include_in_schema=False)
    async def webhook(request: Request) -> dict[str, bool]:
        if settings.mode != "production" or not settings.webhook_secret:
            raise HTTPException(404, "Не найдено")
        secret = request.headers.get("x-telegram-bot-api-secret-token", "")
        if not hmac.compare_digest(secret.encode("utf-8"), settings.webhook_secret.encode("ascii")):
            raise HTTPException(403, "Неверный webhook secret")
        try:
            content_length = int(request.headers.get("content-length", "0"))
        except ValueError:
            raise HTTPException(422, "Некорректный Telegram update") from None
        if content_length > 1048576:
            raise HTTPException(413, "Слишком большой update")
        from nox.bot import enqueue_update

        body = await request.body()
        if len(body) > 1048576:
            raise HTTPException(413, "Слишком большой update")
        try:
            payload = json.loads(body)
            await enqueue_update(db, payload)
        except (ValidationError, json.JSONDecodeError, UnicodeDecodeError):
            raise HTTPException(422, "Некорректный Telegram update") from None
        return {"ok": True}

    for router in (api_auth.router, api_chats.router, api_operations.router, api_studio.router):
        app.include_router(router)
    return app


app = create_app()
