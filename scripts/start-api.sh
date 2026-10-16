#!/bin/sh
set -eu
if [ "${NOX_MODE:-demo}" = "demo" ]; then
    alembic upgrade head
    python -m nox.seed
fi
exec uvicorn nox.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='127.0.0.1'
