# Phase 1 — Каркас монорепо и инфраструктура

## Статус

✅ Готово | Начата: 2026-07-04 | Завершена: 2026-07-04 | Ветка: `phase-1` | PR: —

## Цель

Собрать общий каркас монорепо: npm workspaces (`apps/bot`, `apps/admin`, `packages/db`),
полная Prisma-схема из prd п.6 (общий контракт бота и панели), сид (дефолтные настройки +
первый админ из `ADMIN_ID`), `config.ts` с zod-валидацией env и pino в боте, единый tooling
(TS strict, ESLint, Prettier). После фазы схема БД меняется только миграциями.

## Контекст

Первая фаза, предшественников нет. Опирается на модель данных prd п.6, список env prd п.8,
правила проекта CLAUDE.md (BigInt для telegram_id, настройки из таблицы `Setting`, секреты
через `config.ts`).

**Решения, принятые на этапе проверки документации (влияют на след. фазы):**

- **#1 — `period_days` как источник истины.** Срок подписки конфигурируется настройкой
  `period_days` (дефолт 30). Продление в Фазе 3 считать `+ period_days` дней, а НЕ хардкодом
  `+30d`. Формулировки CLAUDE.md п.9 и prd п.3.2 читать как «30 = дефолт настройки».
- **#2 — seed только 5 документированных ключей.** Тексты сообщений остаются в коде;
  из scope настроек Фазы 8 пункт «текст сообщений» убираем. Модель `Setting` (key/value)
  расширения не требует.
- **#3 — валидация env.** `config.ts` (zod) — только в `apps/bot`. Единый `.env` в корне
  проекта, шарится ботом, панелью и Prisma через `DATABASE_URL`. Zod-валидация env для
  `apps/admin` — явно в DoD Фазы 7.

**Локальный запуск (важно для этой фазы):** приложения (`apps/bot`, позже `apps/admin`) —
всегда локальные node-процессы. БД при этом **не поднимается ни локально, ни в Docker** —
используется реальная, уже созданная MySQL-база на хостинге; `DATABASE_URL` указывает на неё
напрямую. `docker-compose.yml` не используется и удалён из репозитория.

## Таски

### Task 1.1 — Каркас монорепо и инструментарий

- **Статус:** ✅ Готово
- **Workspace:** root (+ stub `apps/admin`)
- **Цель:** npm workspaces на 3 пакета, единый tooling (TS strict, ESLint, Prettier), шаблон env.
- **Файлы:** `package.json` (workspaces `apps/*`, `packages/*`), `tsconfig.base.json`
  (strict, ESM/NodeNext), `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`,
  `.env.example` (все переменные prd п.8), `apps/admin/package.json` (минимальный stub)
- **Out of scope:** реальный код бота/панели, Next.js-каркас (Фаза 7)
- **DoD:**
  - [x] `npm install` из корня ставит все workspace без ошибок
  - [x] `.env.example` содержит `BOT_TOKEN, GROUP_ID, ROBO_LOGIN, ROBO_PASS1, ROBO_PASS2, DATABASE_URL, ADMIN_ID, ADMIN_PANEL_URL, INTERNAL_API_TOKEN, AUTH_SECRET`
  - [x] `npx eslint` и `npx prettier --check` проходят по репозиторию

### Task 1.2 — Подключение к реальной БД на хостинге (без Docker/локальной MySQL)

- **Статус:** ✅ Готово
- **Workspace:** root
- **Цель:** рабочая БД для разработки — реальная MySQL-база на хостинге, без локальной установки
  и без Docker.
- **Файлы:** `.env.example`/README (формат `DATABASE_URL` для удалённого хоста), `docker-compose.yml`
  удалён
- **Out of scope:** прод-конфиг Nginx/PM2 (Фаза 10); создание самой БД/пользователя на хостинге
  (сделано пользователем вручную)
- **DoD:**
  - [ ] `DATABASE_URL` из `.env` подключается к реальной БД на хостинге (`mysql`-клиент, `SELECT 1`)
  - [ ] `docker-compose.yml` отсутствует в репозитории
  - [ ] README описывает только подключение к реальной БД, без локальной MySQL/Docker

### Task 1.3 — packages/db: Prisma-схема + клиент + миграция

- **Статус:** ✅ Готово
- **Workspace:** db
- **Цель:** полная схема из prd п.6 (все модели + enum), экспорт `PrismaClient`, первая миграция.
- **Файлы:** `packages/db/prisma/schema.prisma` (User, Payment, Admin, Setting; enum
  `UserStatus`, `PaymentStatus`; `User.id`/`Payment.userId`/`Admin.telegramId` — `BigInt`;
  `Payment.amount Decimal(10,2)`), `packages/db/src/index.ts` (реэкспорт клиента и типов),
  `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/prisma/migrations/*`
- **Out of scope:** seed (Task 1.4), запросы/агрегации
- **DoD:**
  - [x] первая миграция (`20250704102800_init`) создаёт все 4 таблицы в реальной MySQL на хостинге
        (`migrate deploy`; `migrate dev` на Beget недоступен — нет shadow DB)
  - [x] `packages/db` экспортирует типизированный `prisma`, импортируется из `apps/bot`
  - [x] enum'ы `UserStatus (NEW|ACTIVE|MUTED|LEFT)` и `PaymentStatus (PENDING|PAID|FAILED)` в схеме

### Task 1.4 — Seed: настройки + первый админ

- **Статус:** ✅ Готово
- **Workspace:** db
- **Цель:** идемпотентный seed: 5 дефолтных `Setting` + первый `Admin` из `ADMIN_ID`.
- **Файлы:** `packages/db/prisma/seed.ts`, `package.json` (блок `prisma.seed`)
- **Out of scope:** пароль/email первого админа (скрипт — Фаза 7), ключи текстов сообщений (решение #2)
- **DoD:**
  - [x] seed создаёт `price=990, period_days=30, remind_days=3, muted_remind_days=10, cron_time=09:00`
  - [x] seed создаёт `Admin` с `telegramId = ADMIN_ID` (upsert, без email/passwordHash)
  - [x] повторный запуск seed не дублирует и не падает (upsert)

### Task 1.5 — apps/bot: config.ts (zod) + pino + пустой запуск

- **Статус:** ✅ Готово
- **Workspace:** bot
- **Цель:** zod-валидация env (падение на старте при невалидном), pino-логгер, пустой `index.ts`.
- **Файлы:** `apps/bot/src/config.ts` (zod-схема всех переменных prd п.8; `GROUP_ID`/`ADMIN_ID`
  → BigInt/coerce), `apps/bot/src/logger.ts` (pino), `apps/bot/src/index.ts` (импорт
  config+logger, лог «bot started», без grammY), `apps/bot/package.json` (`dev`: tsx watch),
  `apps/bot/tsconfig.json`
- **Out of scope:** grammY, Fastify, cron, хендлеры (Фазы 2+)
- **DoD:**
  - [x] `npm run dev -w apps/bot` стартует, пишет структурный лог pino, не падает
  - [x] пустой/битый `.env` (нет `BOT_TOKEN` и т.п.) → процесс падает с понятным zod-сообщением
  - [x] секреты доступны только через `config`, а не `process.env` напрямую

## DoD фазы (из phases.md)

- [x] Подключение к реальной БД на хостинге настроено → `migrate deploy` + seed отрабатывает
      (`migrate dev` на Beget недоступен — нет shadow DB)
- [x] `npm run dev -w apps/bot` запускает пустой процесс без ошибок
- [x] невалидный `.env` роняет старт с понятной ошибкой
- [ ] PR `phase-1` → `dev` создан после подтверждения

## Итоги

- **Дата:** 2026-07-04
- **PR:** ожидает подтверждения
- **Отклонения от плана:** `prisma migrate dev` на shared-хостинге Beget недоступен (P3014, нет
  shadow DB) — первая миграция через `migrate diff` + `migrate deploy`; seed и схема применены к
  реальной MySQL. `docker-compose.yml` удалён — БД только на хостинге.
- **Тех. долг:** Task 1.2 DoD (README/`mysql SELECT 1`) не формализован в документации; zod env
  для `apps/admin` — Фаза 7.
