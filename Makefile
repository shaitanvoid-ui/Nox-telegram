.PHONY: install infra dev-api dev-web seed test check build up
install:
	uv sync --frozen
	npm ci --prefix apps/web
infra:
	docker compose up -d postgres redis
seed:
	uv run alembic upgrade head
	uv run python -m nox.seed
dev-api:
	uv run uvicorn nox.main:app --host 0.0.0.0 --port 8000 --reload
dev-web:
	npm run dev --prefix apps/web
check:
	uv run ruff format --check backend tests scripts
	uv run ruff check backend tests scripts
	uv run mypy backend/nox
	npm run format:check --prefix apps/web
	npm run lint --prefix apps/web
	npm run typecheck --prefix apps/web
test:
	uv run pytest tests -q
	npm test --prefix apps/web
build:
	npm run build --prefix apps/web
up:
	docker compose up -d --build
