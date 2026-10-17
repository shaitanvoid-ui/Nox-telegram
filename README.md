# Astra

**Next Generation Telegram Moderation & Community Management Platform**

Astra — платформа управления Telegram-сообществами: общий backend модерации, Aiogram-бот и адаптивный Mini App с собственной тёмной дизайн-системой. Первая версия строится как модульный монолит, чтобы проверять реальные сценарии без лишних микросервисов.

Это начальная версия продукта, а не завершение всех возможностей master prompt. Без настоящего токена доступна явно обозначенная локальная демонстрация с работающими API и БД. Telegram при этом не подключён. Production-готовность и фактические запуски проверок описываются отдельно в [docs/qa.md](docs/qa.md).

Название продукта и бота — **Astra**. Техническое имя репозитория `nox-telegram`, Python-пакет `nox`, пути и префикс переменных окружения `NOX_` сохранены для совместимости с существующими конфигурациями.

## Что входит в основу

| Область | Возможности и границы |
| --- | --- |
| Mini App | Dashboard, Moderation, Shield, Intelligence, Studio, Analytics, Settings; адаптивная навигация и состояния API |
| Модерация | Warn/unwarn, ban/unban, mute/unmute, kick, причины, история, отмена, временные ограничения и эскалация предупреждений |
| Безопасность | Проверка подписанных Telegram `initData`, срок действия, replay guard, серверные сессии с хешем токена, chat-scoped RBAC |
| Постоянные данные | SQLAlchemy, Alembic, PostgreSQL; SQLite для лёгкого demo и тестов |
| Telegram | Aiogram handlers, `/setup`, команды ответом на сообщение, webhook/polling ingestion и устойчивая очередь updates |
| Shield | Детерминированные фильтры частоты, повторов, ссылок, упоминаний и сигналы для ручной проверки; возможности каждого модуля сверяйте с `docs/bot.md` |
| API | Списки чатов и участников, дела, апелляции, настройки, защита, аудит и аналитика; актуальные маршруты в OpenAPI |
| Studio | Хранение правил, preview, история выполнения и исполнитель: вступление → приветствие, флуд → удаление/мут, предупреждения → мут |
| Инфраструктура | Docker Compose, PostgreSQL, Redis, отдельный worker, Nginx, production-пример Caddy и GitHub Actions |

AI-provider по умолчанию отключён. Экран Intelligence не означает подключённую модель. Полная защита от рейдов, автоматическое восстановление Emergency Mode, планировщик и дополнительные действия Studio, а также Universe требуют дальнейшего развития. Наличие настроек, API или визуального редактора само по себе не подтверждает исполнение всех сценариев.

## Дизайн Mini App

Фронтенд пересобран по новым визуальным референсам: чёрные и графитовые поверхности, хромированная скульптурная графика, белые округлые кнопки, типографика Manrope и Inter. Новые оболочка, навигация и рабочие разделы используют существующее API. Количество включённых модулей Shield остаётся фактом конфигурации, а не оценкой безопасности. Графики сообщений и нарушений имеют отдельные шкалы и текстовую альтернативу. [Дизайн-бриф](docs/design/reference-redesign.md), [desktop](docs/screenshots/dashboard-desktop.png), [mobile](docs/screenshots/dashboard-mobile.png).

## Быстрый запуск

Нужны Docker и Docker Compose v2:

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
```

- Mini App в браузере: **http://localhost:8080**.
- API: **http://localhost:8000**.
- Swagger UI: **http://localhost:8000/docs**.

В demo-режиме API применяет миграции и создаёт синтетический чат с участниками и историей. Демо-вход выдаёт настоящую серверную сессию; формы обращаются к FastAPI и сохраняют изменения в БД. Telegram adapter работает как явно выделенный mock и не наказывает настоящих пользователей. Не публикуйте этот режим в интернет.

```bash
docker compose logs --tail=100 api worker web
docker compose down
```

`down` сохраняет именованные volumes. `down -v` удаляет постоянные данные: его нельзя использовать как обычный способ обновления.

## Разработка на хосте

Требования: Python 3.12/3.13, uv, Node.js 22.12+ и npm; рекомендуется Node.js 24, как в CI. Зависимости фиксируются `uv.lock` и `apps/web/package-lock.json`.

```bash
cp .env.example .env
uv sync --frozen
npm ci --prefix apps/web
docker compose up -d postgres redis
export NOX_MODE=demo
export NOX_DATABASE_URL='postgresql+asyncpg://nox:nox-local@127.0.0.1:5432/nox'
export NOX_REDIS_URL='redis://127.0.0.1:6379/0'
uv run alembic upgrade head
uv run python -m nox.seed
uv run uvicorn nox.main:app --host 127.0.0.1 --port 8000 --reload
```

В другом терминале:

```bash
npm run dev --prefix apps/web -- --host 127.0.0.1
```

Откройте `http://localhost:5173`. URL в `.env.example` использует имена сервисов Docker; `export` выше заменяет их на localhost для запуска Python на хосте. `nox-local` — только локальный пароль. Для облегчённого demo доступен `NOX_DATABASE_URL=sqlite+aiosqlite:///./nox-demo.db`.

Worker запускается с тем же окружением командой `uv run python -m nox.worker`. Подробности разработки, миграций, диагностики и SQLite: [docs/development.md](docs/development.md).

## Подключение Telegram

1. Создайте отдельного тестового бота через официальный **@BotFather** и сохраните токен в секрет-хранилище или локальном `.env`. Не отправляйте его в issue, PR, исходный код или screenshots.
2. Подготовьте HTTPS-домен Mini App и установите `NOX_MODE=production`, PostgreSQL, Redis, точные HTTPS CORS origin и случайный `NOX_WEBHOOK_SECRET` минимум 32 символа. Demo-вход в production недоступен.
3. Настройте Mini App/menu button в BotFather на свой HTTPS URL. При открытии внутри Telegram клиент передаёт подписанные `initData` на сервер; пользователь и роли не принимаются на доверие из интерфейса.
4. Настройте webhook с secret token. Для разработки с настоящим ботом можно выбрать polling, но не запускать его одновременно с webhook.
5. Добавьте бота в собственную тестовую супергруппу, предоставьте необходимые административные права и выполните `/setup` от личного профиля администратора. Проверьте `/warn причина` и `/mute 30m причина` ответом на сообщение тестового участника.

Пошаговая настройка, поддерживаемые команды и ограничения Telegram: [docs/bot.md](docs/bot.md). Реальный Bot API и клиенты Android/iOS требуют отдельной проверки после появления токена и домена.

## Проверки качества

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

Для полного запуска интеграционных проверок задайте `NOX_TEST_POSTGRES_URL` на отдельную тестовую PostgreSQL-базу и `NOX_TEST_REDIS_URL` на отдельную Redis DB. Без них соответствующие проверки конкуренции и replay guard явно пропускаются. Подготовка: [docs/development.md](docs/development.md#проверки).

Playwright и браузерные проверки:

```bash
cd apps/web
npx playwright install chromium
npm run test:e2e
```

GitHub Actions описывает backend, frontend, E2E и Docker jobs без production-секретов. Workflow считается проверенным на GitHub только после реального remote push и завершённого запуска. Команды и зафиксированные результаты, пропуски, screenshots и измерения производительности: **[docs/qa.md](docs/qa.md)**.

## Технологии и устройство

Frontend: React, строгий TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, Telegram Mini Apps SDK, Lucide и Recharts. Backend: Python, FastAPI, Pydantic, async SQLAlchemy, asyncpg, Alembic, Aiogram 3 и Redis. Инфраструктура: Docker Compose, Nginx, Caddy, GitHub Actions; проверки — Pytest, Ruff, mypy, Vitest, Testing Library и Playwright.

```text
apps/web/           React Mini App и браузерные тесты
backend/nox/        API, сервисы, безопасность, Telegram, Shield и worker
tests/              Unit, bot и интеграционные проверки
backend/migrations/ Миграции PostgreSQL/SQLite
infra/              Dockerfiles, Nginx и production HTTPS
scripts/            Запуск, backup и воспроизводимые измерения
docs/               Запуск, API, бот, эксплуатация и результаты проверки
.github/            CI, issue templates и pull request template
```

Общая бизнес-логика модерации используется API и Telegram-командами. В production PostgreSQL хранит постоянные данные; Redis обслуживает краткоживущие ограничения. Rust не добавлен без измеренного CPU-узкого места. Подробнее: [ARCHITECTURE.md](ARCHITECTURE.md).

## Эксплуатация и документация

- [Локальная разработка и миграции](docs/development.md).
- [API и OpenAPI](docs/api.md).
- [Telegram-бот](docs/bot.md).
- [Production, HTTPS, backup, восстановление и обновление](docs/deployment.md).
- [Безопасность и сообщение об уязвимости](SECURITY.md).
- [Вклад в разработку](CONTRIBUTING.md).
- [История изменений](CHANGELOG.md).
- [Дальнейшее развитие](docs/roadmap.md).

Для production используйте отдельные секреты и БД, применяйте миграции управляемо и проверяйте восстановление backup. Пример `infra/compose.production.yml` требует Compose 2.24.4+ и публикует только Caddy; автоматическая публикация на production не включена.

Приватный репозиторий владельца: [shaitanvoid-ui/Nox-telegram](https://github.com/shaitanvoid-ui/Nox-telegram). Исходники отправляются логическими коммитами; проверенные результаты последнего выпуска и CI указаны в [docs/qa.md](docs/qa.md).

Лицензия пока не выбрана владельцем, поэтому `LICENSE` отсутствует. До выбора лицензии права сохраняются за правообладателем; лицензии сторонних зависимостей действуют отдельно.
