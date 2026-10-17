<p align="center">
  <img src="docs/assets/astra-cover.svg" alt="Astra — пространство вашего сообщества" width="100%">
</p>

<p align="center">
  <strong>Модерация. Защита. Автоматизация.</strong><br>
  Telegram-бот и Mini App с единым backend управления сообществом.
</p>

<p align="center">
  <a href="https://github.com/shaitanvoid-ui/Nox-telegram/actions/workflows/ci.yml"><img src="https://github.com/shaitanvoid-ui/Nox-telegram/actions/workflows/ci.yml/badge.svg" alt="GitHub Actions — проверки проекта"></a>
  <a href="apps/web/package.json"><img src="https://img.shields.io/badge/React-19-17151f?style=flat&labelColor=25212f&color=8571d6" alt="React 19"></a>
  <a href="pyproject.toml"><img src="https://img.shields.io/badge/Python-3.12-17151f?style=flat&labelColor=25212f&color=8571d6" alt="Python 3.12"></a>
  <a href="docs/deployment.md"><img src="https://img.shields.io/badge/Docker-Compose-17151f?style=flat&labelColor=25212f&color=8571d6" alt="Docker Compose"></a>
</p>

<p align="center">
  <a href="#быстрый-запуск">Запустить</a> ·
  <a href="#возможности">Возможности</a> ·
  <a href="#подключение-telegram">Подключить бота</a> ·
  <a href="docs/qa.md">Результаты проверок</a> ·
  <a href="#документация">Документация</a>
</p>

---

**Astra** объединяет действия модераторов, защитные фильтры, историю событий и сценарии автоматизации в одном пространстве. React Mini App и Aiogram-бот используют общие сервисы: изменение из интерфейса и команда в Telegram проходят одинаковые проверки прав и записываются в аудит.

> **Статус: работающая основа продукта, локальный demo.** API и база данных настоящие; начальные участники, чат и события — синтетические. Telegram в demo заменён mock-адаптером. Реальный бот, Telegram Android/iOS и production требуют отдельного подключения и приёмки. Точные результаты и границы готовности — в [отчёте QA](docs/qa.md).

## Интерфейс

Чёрные и графитовые поверхности, скульптурная графика, мягкие световые акценты и крупная кириллическая типографика. Заголовки — **Onest**, интерфейс — **Inter**, технические подписи — **JetBrains Mono**. Шрифты и графика загружаются локально.

<p align="center">
  <img src="docs/screenshots/welcome-desktop.png" alt="Astra: входной экран в браузере" width="100%">
</p>

<table>
  <tr>
    <th width="50%">Вход в Mini App</th>
    <th width="50%">Панель сообщества</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/welcome-mobile.png" alt="Мобильный вход Astra" width="300"></td>
    <td align="center"><img src="docs/screenshots/dashboard-mobile.png" alt="Мобильный Dashboard Astra: модули защиты, активность и быстрые действия" width="300"></td>
  </tr>
</table>

<details>
<summary><strong>Открыть Dashboard на desktop</strong></summary>

![Рабочая панель Astra на desktop](docs/screenshots/dashboard-desktop.png)

</details>

Скриншоты показывают локальную демонстрацию с настоящими API и SQL-базой. Интерфейс учитывает safe areas, нижнюю навигацию и reduced motion. Сообщения и нарушения имеют отдельные шкалы, график — текстовую альтернативу. Количество включённых модулей Shield показывает конфигурацию, а не оценку безопасности сообщества. [Дизайн-бриф →](docs/design/reference-redesign.md)

## Возможности

| | Что реализовано |
| --- | --- |
| **Модерация** | Warn/unwarn, ban/unban, mute/unmute и kick; причины, история, отмена, временные ограничения и эскалация предупреждений. |
| **Shield** | Фильтры частоты, повторов, ссылок и упоминаний; настраиваемые модули и журнал. Остальные сигналы направляются на ручную проверку — [границы модулей](docs/bot.md). |
| **Studio** | Правила, preview без побочных эффектов и история выполнения. Вступление → приветствие, флуд → удаление/мут, предупреждения → мут. |
| **Управление** | Выбор чата, участники, роли, дела, апелляции, настройки, аудит и аналитика через REST API. |
| **Telegram** | Rich-сообщения Aiogram 3, рабочая inline-справка, onboarding `/setup`, команды ответом на сообщение, webhook/polling и постоянная очередь updates. |
| **Безопасность** | Проверка подписи и срока `initData`, защита обмена от replay, хешированные серверные сессии, chat-scoped RBAC и проверка прав Telegram. |
| **Надёжность** | Дедупликация updates, транзакции, блокировки конкурентных операций, миграции и журнал неоднозначных результатов Telegram. |

**Следующие этапы:** AI-provider и контекстная модерация, полноценный Anti-Raid и Emergency Mode с восстановлением настроек, планировщик Studio, Universe и экономика. Intelligence сейчас показывает эвристические сигналы для ручного разбора; подключённой AI-модели нет. Поддерживаемые настройки не означают исполнение всех будущих сценариев. [План развития →](docs/roadmap.md)

## Быстрый запуск

Нужны **Docker** и **Docker Compose v2**. Токен бота для локального demo не требуется.

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
```

| Адрес | Что открыть |
| --- | --- |
| **http://localhost:8080** | Mini App → «Открыть демо-пространство» |
| http://localhost:8000/docs | Интерактивная документация API |
| http://localhost:8000/ready | Готовность API и подключений |

При первом запуске API применяет миграции и создаёт демонстрационный чат. Демо-вход выдаёт настоящую серверную сессию; формы обращаются к FastAPI и сохраняют изменения в PostgreSQL. Mock-адаптер не выполняет наказания в настоящем Telegram. **Не используйте demo-режим для реальных чатов или постоянного публичного сервиса.**

```bash
docker compose logs --tail=100 api worker web
docker compose down
```

Обычный `down` сохраняет именованные volumes. **`down -v` удаляет постоянные данные** и не подходит для обычного обновления.

## Подключение Telegram

1. Создайте отдельного тестового бота через официальный **@BotFather**. Передайте токен через секрет-хранилище или локальный `.env`: `NOX_BOT_TOKEN`. Не помещайте его в исходники, issue, PR или screenshots.
2. Подготовьте HTTPS-домен. Установите `NOX_MODE=production`, отдельные PostgreSQL и Redis, точные HTTPS CORS origin и случайный `NOX_WEBHOOK_SECRET` минимум 32 символа. Demo-вход в production отключён.
3. Укажите HTTPS URL Mini App/menu button в BotFather. Сервер проверяет подписанные Telegram `initData`; идентификаторы и роли из интерфейса не считаются доказательством полномочий.
4. Настройте webhook с secret token. Для локальной разработки с настоящим ботом доступен polling; одновременно с webhook его не запускают.
5. Добавьте бота в свою тестовую супергруппу с необходимыми правами. Выполните `/setup` от личного профиля администратора, затем проверьте `/warn причина` и `/mute 30m причина` ответом на сообщение тестового участника.

**[Пошаговая настройка бота →](docs/bot.md)** · [Примеры сообщений Astra →](docs/bot-messages.md) · [Production, HTTPS и секреты →](docs/deployment.md)

## Архитектура и стек

Модульный монолит: один набор бизнес-правил, два пользовательских входа — API и Telegram. PostgreSQL хранит постоянные данные; Redis обслуживает краткоживущие ограничения и счётчики. Отдельный worker обрабатывает очередь и фоновые задачи.

| Слой | Технологии |
| --- | --- |
| Mini App | React, строгий TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, Telegram Mini Apps SDK, Lucide, Recharts |
| Backend | Python, FastAPI, Pydantic, async SQLAlchemy, asyncpg, Alembic, Aiogram 3, Redis |
| Инфраструктура | Docker Compose, Nginx, production-пример Caddy, GitHub Actions |
| Проверки | Pytest, Ruff, mypy, Vitest, Testing Library, Playwright |

```text
apps/web/           Mini App, компоненты и браузерные тесты
backend/nox/        API, сервисы, безопасность, Telegram, Shield, worker
backend/migrations/ Миграции PostgreSQL и SQLite
tests/              Unit, API, bot и интеграционные проверки
infra/              Контейнеры, Nginx и production HTTPS
scripts/            Запуск, backup и воспроизводимые измерения
docs/               API, бот, эксплуатация и результаты проверок
.github/            CI, issue templates и pull request template
```

Зависимости зафиксированы в `uv.lock` и `apps/web/package-lock.json`. Rust не добавлен без измеренного CPU-узкого места. [Архитектурные решения →](ARCHITECTURE.md)

## Разработка на хосте

Требования: **Python 3.12/3.13, uv, Node.js 22.12+ и npm**. Рекомендуется Node.js 24, как в CI.

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

Откройте **http://localhost:5173**. URL в `.env.example` использует имена сервисов Docker; `export` выше заменяет их на localhost для Python на хосте. `nox-local` — только локальный пароль.

Worker с тем же окружением: `uv run python -m nox.worker`. Для облегчённого demo доступна SQLite: `NOX_DATABASE_URL=sqlite+aiosqlite:///./nox-demo.db`. Создание миграций, диагностика и другие варианты запуска — в [руководстве разработчика](docs/development.md).

## Проверки качества

```bash
uv run ruff format --check backend tests scripts
uv run ruff check backend tests scripts
uv run mypy backend/nox
uv run pytest tests -q
npm run format:check --prefix apps/web
npm run lint --prefix apps/web
npm run typecheck --prefix apps/web
npm test --prefix apps/web
npm run build --prefix apps/web
```

Для полного интеграционного прогона задайте `NOX_TEST_POSTGRES_URL` на отдельную тестовую PostgreSQL-базу и `NOX_TEST_REDIS_URL` на отдельную Redis DB. Без них проверки конкуренции и replay guard явно пропускаются. [Подготовка тестовых сервисов →](docs/development.md#проверки)

```bash
cd apps/web
npx playwright install chromium
npm run test:e2e
```

[GitHub Actions](https://github.com/shaitanvoid-ui/Nox-telegram/actions/workflows/ci.yml) проверяет backend, frontend, E2E и сборку/запуск контейнеров без production-секретов. Даты прогонов, результаты, пропуски, screenshots и реальные измерения производительности собраны в **[отчёте QA](docs/qa.md)**. Автоматической публикации в production нет.

## Документация

| Начать | Развивать | Эксплуатировать |
| --- | --- | --- |
| [Telegram-бот](docs/bot.md) | [Архитектура](ARCHITECTURE.md) | [Развёртывание и обновление](docs/deployment.md) |
| [API и OpenAPI](docs/api.md) | [Локальная разработка и миграции](docs/development.md) | [Безопасность](SECURITY.md) |
| [Результаты проверок](docs/qa.md) | [Вклад в разработку](CONTRIBUTING.md) | [Backup и восстановление](docs/deployment.md#резервное-копирование) |
| [План развития](docs/roadmap.md) | [Зависимости](docs/dependencies.md) | [История изменений](CHANGELOG.md) |

Для production нужны отдельные секреты и БД, управляемые миграции и проверенное восстановление backup. Пример `infra/compose.production.yml` требует **Compose 2.24.4+** и публикует только Caddy. Перед реальным использованием отдельно проверяются Telegram-клиенты, реальные полномочия и поведение Bot API.

---

<sub>Продукт называется <strong>Astra</strong>. Имя репозитория <code>Nox-telegram</code>, Python-пакет <code>nox</code> и префикс <code>NOX_</code> сохранены для совместимости. Репозиторий приватный. Лицензия владельцем ещё не выбрана; отсутствие <code>LICENSE</code> не разрешает свободное распространение. Лицензии сторонних зависимостей действуют отдельно.</sub>
