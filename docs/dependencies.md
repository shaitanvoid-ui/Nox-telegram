# Зависимости и совместимость

Проверено **2026-10-16**. Источники воспроизводимой установки — [`uv.lock`](../uv.lock) и [`apps/web/package-lock.json`](../apps/web/package-lock.json). Диапазоны в `pyproject.toml` описывают допустимое обновление, а фактические версии задаёт lockfile. Используйте `uv sync --frozen` и `npm ci --prefix apps/web`.

## Зафиксированный стек

| Компонент | Версия из lockfile |
| --- | --- |
| Python | Поддерживается `>=3.12,<3.14`; локальные проверки — 3.12.14 |
| FastAPI / Uvicorn | 0.135.4 / 0.41.0 |
| SQLAlchemy / asyncpg / Alembic | 2.0.54 / 0.31.0 / 1.18.5 |
| Pydantic / pydantic-settings | 2.13.5 / 2.16.0 |
| Aiogram / Redis Python client | 3.31.0 / 7.4.1 |
| Structlog | 25.5.0 |
| React / React DOM | 19.3.1 / 19.3.1 |
| TypeScript / Vite | 5.9.3 / 8.3.4 |
| Tailwind CSS | 4.3.3 |
| TanStack Query / React Router | 5.104.3 / 7.18.4 |
| Telegram Mini Apps React SDK | `@tma.js/sdk-react` 3.0.23 |
| Recharts / Lucide React | 3.10.1 / 1.58.0 |
| Vitest / Playwright | 5.0.5 / 1.64.1 |
| Pytest / Ruff / mypy | 9.1.1 / 0.15.22 / 1.20.2 |

Node.js **22.12+** необходим для текущего Vite/Vitest. В CI и frontend Docker build используется Node.js 24. Фактические `engines` установленного Vite: `^20.19.0 || >=22.12.0`, Vitest: `^22.12.0 || ^24.0.0 || >=26.0.0`; совместное минимальное требование проекта — Node.js 22.12. Не используйте старые инструкции для Node.js 18.

Образы PostgreSQL и Redis закреплены digest в Compose и CI. Python API base image также закреплён digest. Frontend Node и Nginx base images также закреплены digest. Proxy CA передаётся только через BuildKit secret; секреты и локальный .env в образы не копируются. Побитовая воспроизводимость всех промежуточных build-слоёв не заявляется.

## Официальные источники

Следующие официальные страницы доступны и проверены при подготовке версии; это источники контрактов, а не утверждение, что все библиотеки всегда последние:

- [Vite: начало работы и требования Node.js](https://vite.dev/guide/).
- [React: версии](https://react.dev/versions).
- [FastAPI: async/await](https://fastapi.tiangolo.com/async/).
- [SQLAlchemy 2: asyncio и AsyncSession](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html). Отдельная async session используется на единицу работы; одна сессия не разделяется между конкурентными tasks.
- [Aiogram: актуальная документация](https://docs.aiogram.dev/en/latest/).
- [Telegram: валидация данных Mini App](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). Пользователь подтверждается серверной подписью `initData`; `initDataUnsafe` не используется как удостоверение.
- [Telegram Mini Apps: init data](https://docs.telegram-mini-apps.com/platform/init-data).
- [Recharts: ResponsiveContainer](https://recharts.github.io/en-US/api/ResponsiveContainer/). Родитель графика должен иметь измеримый размер; компоненты и адаптивность проверяются в настоящем браузере.

Доступность API Telegram проверяется в клиентском wrapper перед вызовом. Работа SDK в браузере без Telegram не является проверкой настоящего клиента. Прежний `@telegram-apps/sdk-react` заменён на `@tma.js/sdk-react` и удалён из lockfile; не возвращайте старое семейство без отдельного аудита его транзитивных зависимостей.

## Проверка advisory

В локальной среде выполнены:

```bash
uv export --no-dev --no-emit-project --format requirements-txt --output-file /tmp/nox-runtime-requirements.txt
uv run pip-audit -r /tmp/nox-runtime-requirements.txt --no-deps --disable-pip
npm audit --prefix apps/web --json
```

Результат Python runtime: **No known vulnerabilities found**, код возврата 0. Результат npm: **0 vulnerabilities**, код возврата 0. Python dev-инструменты не входят в указанный runtime-аудит. Аудит advisory не проверяет бизнес-логику, права доступа или отсутствие ещё неизвестных уязвимостей.

Обновляйте зависимости отдельным изменением: прочитайте release notes, обновите lockfile, выполните frozen install, lint/typecheck, unit/integration tests, build и E2E. Автоматическое использование `latest`, `npm audit fix --force` и неявная смена major во время deployment не допускаются.
