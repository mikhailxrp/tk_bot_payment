# Phase 4 — Два продукта: общая группа + выбор в /start

## Статус

🔄 В работе | Начата: 2026-07-05 | Ветка: `phase-4`

## Цель

Бот продаёт два продукта: подписку на закрытую группу (30 дней, как раньше) и разовый
бессрочный доступ в общую группу (меньшая сумма, без mute/напоминаний). `/start` даёт выбор
из двух групп; webhook Робокассы ветвится по продукту внутри той же транзакции. После этой
фазы выдача доступа (Фаза 5) пишется один раз сразу под обе группы.

## Контекст

Опирается на Фазу 3 (подписи Робокассы, `POST /robokassa/result`, транзакция
`Payment.PAID` + продление, идемпотентность через `updateMany`-guard, 15 автотестов) и Фазу 2
(`/start`, меню подписки). Разделы PRD: 1 (два продукта), 3.1/3.6 (сценарии), 6 (модель:
`ProductType`, `Payment.product`, `CommonAccess`, `price_common`), 7 (ветвление webhook,
Description/Receipt по продукту), 8 (env `COMMON_GROUP_ID`).

Бизнес-контекст: бот заменяет два существующих бота, работающих на одном магазине Робокассы, —
объединение снимает конфликт Result URL (один магазин не может слать webhook в два места).

**Решения, принятые при планировании фазы:**

- **#1 — `CommonAccess` — отдельная таблица, не поля на `User`.** Один-к-одному, `userId` PK;
  не засоряем `User` nullable-полями второго продукта; `inGroup` общей группы отделён от
  `User.inGroup` закрытой.
- **#2 — enum `ProductType`: `SUBSCRIPTION` | `LIFETIME`**, поле `Payment.product`
  (default `SUBSCRIPTION` — существующие платежи корректны без бэкфилла).
- **#3 — `price_common` — ключ `Setting`** (бизнес-параметр, меняется из панели на лету),
  а не env; сид становится 6 ключей. Заглушка 500 — точная цена в открытых вопросах PRD п.11.
- **#4 — `COMMON_GROUP_ID` — env** (константа инфраструктуры, как `GROUP_ID`).
- **#5 — Повторная оплата общей группы не продаётся:** если `CommonAccess` уже есть, бот
  сообщает «доступ уже оплачен»; повторная выдача invite-ссылки — скоуп Фазы 5.
- **#6 — Cron/напоминания/mute (Фазы 6–7) общую группу не касаются никогда** — их выборки
  строятся только на `User.status`/`expiresAt`, которые LIFETIME-платёж не трогает.

## Таски

### Task 4.1 — БД и конфиг: ProductType, CommonAccess, price_common, COMMON_GROUP_ID

- **Статус:** ✅ Готово
- **Workspace:** db + bot
- **Цель:** модель данных и конфиг под второй продукт, ничего в поведении бота ещё не меняется.
- **Файлы:** `packages/db/prisma/schema.prisma`, новая миграция (через `migrate diff` →
  `migrate:deploy` — на хостинге нет прав на shadow DB, см. итоги Фазы 1),
  `packages/db/prisma/seed.ts` (+`price_common`), `apps/bot/src/config.ts`
  (+`COMMON_GROUP_ID`), `.env.example`, `apps/bot/test/setup.ts` (+фиктивный `COMMON_GROUP_ID`)
- **Out of scope:** любые изменения handlers/webhook (Task 4.2–4.3)
- **DoD:**
  - [x] enum `ProductType` (`SUBSCRIPTION`|`LIFETIME`), `Payment.product`
        (default `SUBSCRIPTION`), модель `CommonAccess` (userId PK BigInt, paidAt, inGroup,
        createdAt, relation на User) — миграция применена к реальной MySQL
  - [x] сид добавляет `price_common` (заглушка 500), идемпотентен, существующие ключи не трогает
  - [x] `COMMON_GROUP_ID` (BigInt) обязателен в `config.ts`, невалидный env роняет старт
  - [x] `npm run type-check` и `npm test` зелёные (существующие тесты не сломаны)

### Task 4.2 — /start: выбор группы, оплата общей группы

- **Статус:** ✅ Готово
- **Workspace:** bot
- **Цель:** `/start` показывает две кнопки (закрытая-подписка / общая-разовый); флоу общей
  группы создаёт `Payment(PENDING, product=LIFETIME)` с ценой из `Setting.price_common`.
- **Файлы:** `apps/bot/src/bot/handlers/start.ts`, `apps/bot/src/bot/keyboards.ts`,
  `apps/bot/src/bot/bot.ts`, `apps/bot/test/start.test.ts`
- **Out of scope:** обработка оплаты (Task 4.3), invite-ссылки (Фаза 5)
- **DoD:**
  - [x] `/start` — выбор из двух групп; закрытая ведёт в текущий флоу подписки (регрессии нет)
  - [x] общая: сумма из `Setting.price_common` (читается при каждом использовании, без кэша),
        `Payment(PENDING, product=LIFETIME)`, ссылка через `buildPaymentUrl` c
        Description/Receipt name «Разовый доступ в общую группу»
  - [x] у пользователя с существующим `CommonAccess` кнопка оплаты общей группы не показывается —
        вместо неё сообщение «доступ уже оплачен» (решение #5)
  - [x] deep-link `/start paid|fail` работает как раньше

### Task 4.3 — Webhook: ветвление по продукту + тесты

- **Статус:** ✅ Готово
- **Workspace:** bot
- **Цель:** обработка оплаты ветвится по `Payment.product` внутри той же транзакции;
  LIFETIME не трогает подписку.
- **Файлы:** `apps/bot/src/payments/webhook.ts`, `apps/bot/src/services/subscription.ts`
  (новая функция применения LIFETIME-платежа), `apps/bot/test/webhook.test.ts`
- **Out of scope:** отправка invite-ссылки/уведомлений (Фаза 5)
- **DoD:**
  - [x] SUBSCRIPTION: поведение Фазы 3 без изменений (продление, unmute-поля, сброс флагов)
  - [x] LIFETIME: в той же транзакции `Payment.PAID` + upsert `CommonAccess(paidAt)`;
        `User.expiresAt`/`status`/`reminderSentAt`/`lastMutedRemindAt` не изменяются
  - [x] идемпотентность обоих продуктов: повторный POST по `PAID` → `OK{InvId}` без изменений
  - [x] тесты: LIFETIME-оплата (CommonAccess создан, user.update не вызван), повторный POST,
        регрессия SUBSCRIPTION — все существующие тесты зелёные
  - [x] `npm test`, `npm run type-check`, `npm run lint` — чисто

## DoD фазы (из phases.md)

- [x] обе кнопки создают `Payment(PENDING)` с верной суммой и продуктом
- [x] тестовая оплата LIFETIME → `CommonAccess.paidAt` проставлен, `expiresAt` не изменился
- [x] повторный webhook идемпотентен для обоих продуктов
- [x] существующие тесты зелёные + новые на ветвление
- [ ] Все таски ✅, PR `phase-4` → `dev` создан после подтверждения

## Итоги

_(заполняется при закрытии: что отклонилось от плана, тех. долг, дата, PR)_
