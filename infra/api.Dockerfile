# syntax=docker/dockerfile:1.7
FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy
WORKDIR /app
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi; \
    pip install --no-cache-dir uv==0.12.23
COPY pyproject.toml uv.lock ./
COPY backend ./backend
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca; fi; \
    uv sync --frozen --no-dev --no-editable
COPY alembic.ini ./
COPY scripts/start-api.sh ./scripts/start-api.sh
RUN groupadd --gid 10001 nox && useradd --uid 10001 --gid nox --no-create-home nox \
    && chown -R nox:nox /app
ENV PATH="/app/.venv/bin:$PATH"
USER nox
EXPOSE 8000
CMD ["sh", "scripts/start-api.sh"]
