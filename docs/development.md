# Локальная разработка

Команды выполняются из корня репозитория. Нужны Python 3.12 или 3.13, [uv](https://docs.astral.sh/uv/), Node.js 22.12+ и npm. Рекомендуется Node.js 24, используемый в CI. Для PostgreSQL и Redis удобнее Docker с Compose v2. Используйте версии из `uv.lock` и `apps/web/package-lock.json`; не обновляйте зависимости неявно во время проверки изменения.

## Вариант 1: весь продукт в Docker

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
```

Откройте `http://localhost:8080`. API доступен на `http://localhost:8000`; Swagger UI — на `/docs`. В demo-режиме стартовый скрипт API применяет миграции и создаёт синтетические данные. Worker запускается отдельно. PostgreSQL и Redis используют постоянные Docker volumes; обычный `docker compose down` их сохраняет. Не используйте `down -v` для базы, данные которой нужно сохранить.

Порты привязаны к loopback хоста. Если работа ведётся на удалённой машине, используйте локальное перенаправление портов. Не открывайте demo-стенд публично.

## Вариант 2: backend и frontend на хосте

```bash
cp .env.example .env
uv sync --frozen
npm ci --prefix apps/web
docker compose up -d postgres redis
```

В `.env.example` имена `postgres` и `redis` относятся к сети Docker. Для Python-процесса на хосте переопределите адреса в текущем терминале:

```bash
export NOX_MODE=demo
export NOX_DATABASE_URL='postgresql+asyncpg://nox:nox-local@127.0.0.1:5432/nox'
export NOX_REDIS_URL='redis://127.0.0.1:6379/0'
uv run alembic upgrade head
uv run python -m nox.seed
uv run uvicorn nox.main:app --host 127.0.0.1 --port 8000 --reload
```

Пароль выше предназначен только для локального окружения из `.env.example`. Если вы изменили его, обновите URL соответственно. Переменные окружения имеют приоритет над `.env`.

Во втором терминале:

```bash
npm run dev --prefix apps/web -- --host 127.0.0.1
```

Vite слушает порт 5173 и проксирует API на 8000. Клиент не требует отдельного фальшивого backend: demo-вход создаёт серверную сессию, а изменения записываются в настоящую БД выбранного окружения.

Для минимального demo без PostgreSQL можно заменить URL:

```bash
export NOX_DATABASE_URL='sqlite+aiosqlite:///./nox-demo.db'
uv run alembic upgrade head
uv run python -m nox.seed
```

SQLite-файл локальный и не должен попадать в Git. Он не подходит для production и не заменяет интеграционные проверки PostgreSQL. Redis нужен для production-аутентификации и общих краткоживущих ограничений.

## Фоновая обработка и бот

Запускайте worker с теми же переменными окружения, что и API:

```bash
uv run python -m nox.worker
```

Инструкции настоящего Telegram и список команд: [bot.md](bot.md). Не запускайте polling и production-webhook одновременно для одного токена. Отсутствие токена не мешает demo-разработке, но не означает подключённого Telegram.

## Проверки

```bash
uv run ruff format --check backend tests scripts
uv run ruff check backend tests scripts
uv run mypy backend/nox
uv run pytest tests -q
npm run lint --prefix apps/web
npm run typecheck --prefix apps/web
npm test --prefix apps/web
npm run build --prefix apps/web
```

`pytest tests` включает `tests/backend`, `tests/bot` и `tests/integration`. Для полного запуска интеграционных проверок нужны реальные PostgreSQL и Redis. Один раз создайте отдельную локальную тестовую базу (команда ожидает, что `nox_test` ещё не существует):

```bash
docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" nox_test'
export NOX_TEST_POSTGRES_URL='postgresql+asyncpg://nox:nox-local@127.0.0.1:5432/nox_test'
export NOX_TEST_REDIS_URL='redis://127.0.0.1:6379/15'
uv run pytest tests -q
```

Используйте только тестовую инфраструктуру. PostgreSQL-фикстуры создают отдельные временные схемы и требуют права на `CREATE SCHEMA`; Redis DB 15 следует выделить под эти тесты. Без `NOX_TEST_POSTGRES_URL` пропускаются проверки реальной PostgreSQL-конкуренции. Без `NOX_TEST_REDIS_URL` пропускаются проверки общего replay guard и Redis-счётчиков. Такие `skipped` нельзя выдавать за успешную проверку внешнего сервиса. Если переменные указаны, недоступность сервиса должна приводить к ошибке, а не к незаметной замене mock.

Браузерные проверки используют Playwright:

```bash
cd apps/web
npx playwright install chromium
npm run test:e2e
```

Если системные библиотеки браузера отсутствуют, установите их средствами своей ОС или командой `npx playwright install --with-deps chromium` в подходящем окружении. Конфигурация Playwright определяет запуск сервера; для сценариев с API должен быть доступен demo-backend. Фактически выполненные сценарии, ширины и screenshots перечислены в [qa.md](qa.md).

Запуск теста не равен его успешному завершению. Сохраняйте сообщения о пропусках, внешних ограничениях и неисполненных проверках в описании PR.

## Миграции

Alembic настроен через корневой `alembic.ini`, исходники миграций находятся в `backend/migrations`.

```bash
uv run alembic current
uv run alembic upgrade head
uv run alembic revision --autogenerate -m 'describe schema change'
```

Автосгенерированную миграцию нужно прочитать. Для переименований и переноса данных часто нужен явный SQL/код. Примените её к копии существующей базы, сравните данные и проверьте совместимость кода. Не используйте `downgrade` для production без оценки потери данных и резервной копии.

## Зависимости и диагностика

Обновление Python: измените диапазон в `pyproject.toml`, выполните `uv lock`, затем `uv sync --frozen` и проверки. Обновление frontend: измените `package.json` через npm и сохраните `package-lock.json`. Отдельно проверьте официальную документацию изменённых API и совместимость Node/Python.

```bash
uv run pip-audit
npm audit --prefix apps/web
docker compose logs --tail=100 api worker web
curl --fail http://localhost:8000/health
curl --fail http://localhost:8000/ready
```

Не прикладывайте сырые production-логи к публичному issue: в них могут оказаться идентификаторы участников или параметры внешнего API. Отсутствие известных advisory в одном аудите не является обещанием отсутствия уязвимостей.
