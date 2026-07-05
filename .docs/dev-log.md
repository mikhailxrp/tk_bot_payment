# Development Log

Журнал сессий разработки. Записывай сюда что сделано после каждой сессии.

---

## 2026-07-05 — Task 4.3: Webhook — ветвление по продукту + тесты

- Обновлён `apps/bot/src/payments/webhook.ts`: после `payment.findUniqueOrThrow` ветвление по
  `payment.product` внутри той же транзакции; `ProductType.LIFETIME` → `applyCommonAccess`
  (без чтения `Setting.period_days`); иначе — прежняя логика Фазы 3 (`period_days` +
  `applyPayment`); идемпотентность через `updateMany`-guard на `PENDING` без изменений.
- Обновлён `apps/bot/src/services/subscription.ts`: новая функция `applyCommonAccess(tx, payment, now)` —
  `tx.commonAccess.upsert` (`create: { userId, paidAt: now }`, `update: { paidAt: now }`);
  `tx.user` не трогает (`expiresAt`/`status`/флаги напоминаний остаются без изменений).
- Обновлён `apps/bot/test/webhook.test.ts`: мок `@tg-bot/db` дополнен `ProductType` и
  `commonAccess.upsert`; 2 новых теста — LIFETIME happy path (upsert с верными данными,
  `user.update` не вызван, `period_days` не запрашивается), LIFETIME idempotent repeat
  (повторный POST по `PAID` → `OK{InvId}` без повторного upsert); регрессия SUBSCRIPTION — 3
  существующих теста без изменения ожиданий.
- Out of scope соблюдён: invite-ссылки и уведомления (Фаза 5), реальные вызовы Telegram API,
  изменения `/start`/keyboards, правки схемы `CommonAccess`/`price_common`.
- Проверено: `npm test` — 26 passed; `npm run type-check`, `npm run lint` — без ошибок.
  Фаза 4: все таски (4.1–4.3) ✅; остался PR `phase-4` → `dev`.

## 2026-07-05 — Task 4.2: /start — выбор группы, оплата общей группы

- Обновлён `apps/bot/src/bot/keyboards.ts`: константа `COMMON_ACCESS_CALLBACK`;
  `productChoiceKeyboard(showCommonAccessButton)` — «Закрытая группа (подписка)» /
  «Общая группа (разовый доступ)» или только первая кнопка, если общий доступ уже оплачен;
  `subscribeKeyboard()` заменён на выбор продукта.
- Обновлён `apps/bot/src/bot/handlers/start.ts`: `handleStart` — upsert пользователя,
  `commonAccess.findUnique` до построения клавиатуры; при наличии `CommonAccess` — текст
  «Доступ в общую группу уже оплачен» и одна кнопка подписки; deep-link `paid`/`fail` без
  изменений (выход до Prisma). Новый `handleCommonAccessCallback`: цена из `Setting.price_common`
  (без `period_days`), валидация `PRICE_PATTERN`, `Payment(PENDING, product=LIFETIME)`,
  `buildPaymentUrl` с Description/Receipt «Разовый доступ в общую группу»; защита от повторной
  оплаты в callback. `handleSubscribeCallback` — без изменений по логике (регрессия).
- Обновлён `apps/bot/src/bot/bot.ts`: регистрация
  `bot.callbackQuery(COMMON_ACCESS_CALLBACK, handleCommonAccessCallback)`.
- Создан `apps/bot/test/start.test.ts`: 9 тестов — `/start` с/без `CommonAccess`, создание
  LIFETIME-платежа, регрессия SUBSCRIBE-callback, deep-link `paid`/`fail`; мок `@tg-bot/db`
  через `vi.hoisted()`.
- Out of scope соблюдён: webhook LIFETIME (Task 4.3), invite-ссылки (Фаза 5).
- Проверено: `npm test` — 24 passed; `npm run type-check`, `npm run lint` — без ошибок;
  `npm run build -w apps/bot` — OK (полный `npm run build` упал на `prisma generate` EPERM
  Windows — query engine занят другим процессом, к коду таска не относится).

## 2026-07-05 — Task 4.1: БД и конфиг — ProductType, CommonAccess, price_common, COMMON_GROUP_ID

- Обновлён `packages/db/prisma/schema.prisma`: enum `ProductType` (`SUBSCRIPTION` | `LIFETIME`);
  `Payment.product ProductType @default(SUBSCRIPTION)` (NOT NULL, без бэкфилла); модель
  `CommonAccess` (`userId BigInt @id`, `paidAt`, `inGroup @default(false)`, `createdAt`);
  `User.commonAccess CommonAccess?`.
- Миграция `20260705145215_two_products/migration.sql` применена к реальной MySQL через
  `migrate:deploy`; `migrate status` — «Database schema is up to date!» (обход P3014: diff →
  deploy, без shadow DB).
- Обновлён `packages/db/prisma/seed.ts`: ключ `price_common=500` (заглушка prd п.11);
  upsert с пустым `update` — идемпотентно, существующие значения не перезатираются.
- Обновлён `packages/db/src/index.ts`: реэкспорт типа `CommonAccess` и value `ProductType`
  (импорт из `@tg-bot/db`, не из `@prisma/client` — совместимость с `vi.mock` в тестах).
- Обновлён `apps/bot/src/config.ts`: обязательный `COMMON_GROUP_ID` через
  `bigIntFromNonEmptyString` (отрицательный id супергруппы, как `GROUP_ID`).
- Обновлён `.env.example`: `COMMON_GROUP_ID=` в блоке Telegram bot; реальный `.env` дополнен.
- Обновлён `apps/bot/test/setup.ts`: фиктивный `COMMON_GROUP_ID` до импорта `config.ts`.
- Поведение бота не менялось (`/start`, webhook, клавиатуры — out of scope таска 4.2–4.3).
- Проверено: существующие `Payment` читаются с `product = SUBSCRIPTION`; CRUD `CommonAccess`
  через Prisma (таблица пустая, готова к Фазе 5); `npm test` — 15 passed;
  `npm run type-check`, `npm run lint`, `npm run build` — без ошибок во всех workspace.

## 2026-07-05 — Планирование: второй продукт (общая группа) + перенумерация фаз

- Новое требование: бот заменяет два существующих бота на одном магазине Робокассы —
  добавлен второй продукт «общая группа» (разовый платёж меньшей суммы, бессрочный доступ,
  без mute/напоминаний). Заодно снимается конфликт Result URL (один магазин — один webhook).
- Решение (вариант A): новая **Фаза 4 «Два продукта: общая группа + выбор в /start»**
  вставлена до выдачи доступа, чтобы invite-логика писалась один раз под обе группы;
  прежние фазы 4–10 перенумерованы в 5–11 (файлов/веток phase-4+ ещё не существовало —
  перенумерация безопасна).
- Обновлено: `prd.md` (п.1/2/3.1/3.6/5.1/6/7/8/9/10/11 — enum `ProductType`, `Payment.product`,
  таблица `CommonAccess`, `Setting.price_common`, env `COMMON_GROUP_ID`; из «вне скоупа» убрано
  противоречие «несколько групп»), `phases.md` (карта зависимостей, новая фаза, перенумерация),
  `_status.md` (таблица, журнал решений), `CLAUDE.md` (описание проекта + правило 16),
  создан `.docs/phases/phase-4.md` (таски 4.1–4.3: БД/конфиг → /start выбор → ветвление webhook).
- Решения планирования Фазы 5 (бывш. 4) из параллельной сессии сохранены в журнале `_status.md`;
  таск `services/notify.ts` (TASK.md) остаётся валидным — продукто-независим, отнесён к Фазе 5.
- Открытые вопросы (prd п.11): точная цена `price_common` (в сиде заглушка 500), нужны ли
  админам отдельные сводки по общей группе.

## 2026-07-05 — Task 3.5: Тесты (vitest) — подписи, Receipt-кодирование, продление, webhook

- Создан `vitest.config.ts` (root): `include` на `apps/bot/test/**/*.test.ts`, `setupFiles` на
  `apps/bot/test/setup.ts`; пути относительно конфига (forward slashes) — работает из корня и
  из `npm run test -w apps/bot`.
- Обновлён `package.json` (root): скрипт `"test": "vitest run --config vitest.config.ts"`.
- Обновлён `apps/bot/package.json`: devDependency `vitest`, скрипт
  `"test": "vitest run --config ../../vitest.config.ts"`.
- Создан `apps/bot/test/setup.ts`: фиктивные env (`BOT_TOKEN`, `GROUP_ID`, `ADMIN_ID`,
  `ROBO_*`, `DATABASE_URL`, `ADMIN_PANEL_URL`, `INTERNAL_API_TOKEN`, `AUTH_SECRET`, `PORT`)
  выставляются до импорта модулей с `config.ts`.
- Создан `apps/bot/test/robokassa.test.ts`: `formatOutSum`; подпись ссылки
  `md5(Login:OutSum:InvId:Receipt:Pass1)` с однократным URL-кодированием Receipt; двойное
  кодирование Receipt в query string (проверка через regex в сыром URL, не через
  `URLSearchParams`); `verifyResultSignature` — case-insensitive, Receipt не участвует.
- Создан `apps/bot/test/subscription.test.ts`: `calculateNewExpiresAt` — активная подписка
  (`expiresAt + period_days`), истёкшая, `null`, граница `expiresAt === now`.
- Создан `apps/bot/test/webhook.test.ts`: Fastify + `@fastify/formbody`, `@tg-bot/db` замокан
  через `vi.hoisted()`; валидный webhook → `OK{InvId}` + guard `updateMany(PENDING)`; неверная
  подпись → `400` без `$transaction`; повторный `PAID` → `OK{InvId}` без `user.update`.
- Бизнес-логика (`robokassa.ts`, `webhook.ts`, `subscription.ts`) не менялась.
- Проверено: `npm test` — 15 passed; `npm run test -w apps/bot` — 15 passed;
  `npm run type-check` — проходит.

## 2026-07-05 — Task 3.4: Success/Fail deep-link (`/start paid|fail`)

- Обновлён `apps/bot/src/bot/handlers/start.ts`: в `handleStart` читается `ctx.match` (пустая
  строка при обычном `/start`); при `'paid'` — `PAYMENT_SUCCESS_MESSAGE`, при `'fail'` —
  `PAYMENT_FAIL_MESSAGE`; обе ветки выходят до upsert и без обращения к Prisma. Пустой или
  неизвестный payload — прежняя логика (upsert + `subscribeKeyboard()`).
- `apps/bot/src/bot/bot.ts` без изменений — `bot.command('start', handleStart)` уже передаёт
  `ctx.match`.
- Проверено: `npm run type-check` — проходит.

## 2026-07-05 — Task 3.3: Fastify + POST /robokassa/result — подпись, идемпотентность, продление

- Обновлён `apps/bot/src/payments/robokassa.ts`: `verifyResultSignature(outSum, invId, signature)` —
  `md5(OutSum:InvId:Pass2)`, Receipt не участвует, сравнение case-insensitive.
- Создан `apps/bot/src/services/subscription.ts`: `calculateNewExpiresAt` (активная подписка
  `expiresAt > now` → `expiresAt + periodDays`; истекла/нет → `now + periodDays`);
  `applyPayment(tx, payment, now, periodDays)` — внутри транзакции обновляет `User.expiresAt`,
  `status = ACTIVE`, сбрасывает `reminderSentAt`/`lastMutedRemindAt`.
- Создан `apps/bot/src/payments/webhook.ts`: `POST /robokassa/result` — zod-парсинг тела;
  подпись проверяется до БД (невалидная → `400`); атомарный guard
  `updateMany({ where: { id, status: PENDING }, data: { PAID, paidAt } })`; `count === 0` →
  если уже `PAID` — `OK{InvId}` без изменений, иначе `400`; `count === 1` → в той же
  `$transaction` читается `period_days` из `Setting`, вызывается `applyPayment`; ответ —
  строго `OK{InvId}` plain text; `userId` в логах через `.toString()`.
- Обновлён `apps/bot/src/index.ts`: Fastify + `@fastify/formbody`, регистрация webhook,
  `Promise.all([fastify.listen, bot.start()])`.
- Обновлён `apps/bot/src/config.ts`: zod-поле `PORT` (опционально, дефолт `3000`).
- Обновлён `apps/bot/package.json`: зависимости `fastify`, `@fastify/formbody`; скрипт
  `test:webhook` + `scripts/test-webhook.ts` для ручной проверки (валид/невалид/повтор).
- Обновлён `.env.example`: `PORT=3000`.
- Проверено: `npm run type-check -w apps/bot` — проходит.

## 2026-07-05 — Task 3.2: Payment(PENDING) + реальная ссылка вместо заглушки

- Обновлён `apps/bot/src/bot/keyboards.ts`: `paymentKeyboard(url)` принимает готовый URL;
  `PAYMENT_PLACEHOLDER_URL` удалён.
- Обновлён `apps/bot/src/bot/handlers/start.ts`: `handleSubscribeCallback` — на каждый клик
  «Оформить подписку» параллельно читает `Setting` (`price`, `period_days`) без кэша;
  `amount = formatOutSum(price)` один раз — тот же формат для `Payment.amount` и `OutSum`;
  `prisma.payment.create({ status: PENDING, amount, userId })`, затем
  `buildPaymentUrl(amount, payment.id, \`Подписка на ${periodDays} дней\`)`; кнопка «Оплатить»
  ведёт на реальный URL Робокассы (`IsTest` из `ROBO_IS_TEST`). Каждый клик — новый `Payment`,
  старые `PENDING` не переиспользуются.
- Проверено: `npm run type-check -w apps/bot` — проходит.

## 2026-07-04 — Task 3.1: Robokassa — чистые функции подписи + Receipt + buildPaymentUrl

- Создан `apps/bot/src/payments/robokassa.ts`: `formatOutSum` (`toFixed(2)` для `OutSum` и
  `items[].sum`); `buildReceipt` — одна каноническая JSON-строка (`sno`/`tax` из `config`,
  `payment_object: "service"`, `sum` вставляется без `JSON.stringify`, чтобы не терять нули);
  `buildSignature` — `md5(Login:OutSum:InvId:encodeURIComponent(receipt):Pass1)`; `buildPaymentUrl`
  — полный URL `auth.robokassa.ru/Merchant/Index.aspx`, Receipt в параметре закодирован **дважды**,
  `IsTest` → `"1"`/`"0"`. Только `config` + `node:crypto`, без Prisma/grammY.
- Обновлён `apps/bot/src/config.ts`: zod-поля `ROBO_IS_TEST` (хелпер `booleanFromEnv`:
  `true`/`false`/`1`/`0`), `ROBO_SNO`, `ROBO_TAX`.
- Обновлён `.env.example`: `ROBO_IS_TEST`, `ROBO_SNO`, `ROBO_TAX` в блоке Robokassa.
- Проверено: `npm run type-check -w apps/bot` — проходит.

## 2026-07-04 — Task 2.3: Middleware isAdmin + skeleton /admin

- Создан `apps/bot/src/bot/middleware/isAdmin.ts`: middleware проверяет `ctx.from` (ранний отказ
  при `undefined`); `prisma.admin.findUnique({ where: { telegramId: BigInt(from.id) } })` на каждый
  вызов — без сравнения с `config.ADMIN_ID`; админ → `next()`, не-админ → явное сообщение-отказ;
  ошибки Prisma логируются через pino, пользователю — нейтральный ответ без проброса исключения.
- Создан `apps/bot/src/bot/handlers/admin.ts`: `handleAdmin` — заглушка «Админ-панель бота:
  функциональность появится в следующих фазах.».
- Обновлён `apps/bot/src/bot/bot.ts`: `bot.command('admin', isAdmin, handleAdmin)` — middleware
  точечно на `/admin`, не через глобальный `bot.use()`.
- Проверено: `npm run type-check -w apps/bot`, `npm run build -w apps/bot` — проходят.

## 2026-07-04 — Task 2.2: Меню подписки — цена из Setting + заглушка оплаты

- Обновлён `apps/bot/src/bot/keyboards.ts`: `paymentKeyboard(amount)` — `InlineKeyboard` с кнопкой
  «Оплатить» (`url: https://example.com/payment-placeholder`).
- Обновлён `apps/bot/src/bot/handlers/start.ts`: `handleSubscribeCallback` — на каждый клик
  `prisma.setting.findUnique({ where: { key: 'price' } })` (без кэша); валидация значения
  (`/^\d+(\.\d{1,2})?$/`); при отсутствии/некорректной цене — явное сообщение пользователю;
  при успехе — `editMessageText` с суммой и клавиатурой оплаты; `ctx.answerCallbackQuery()` в
  начале хендлера.
- Обновлён `apps/bot/src/bot/bot.ts`: регистрация `bot.callbackQuery(SUBSCRIBE_CALLBACK,
  handleSubscribeCallback)`.
- Проверено: `npm run type-check -w apps/bot` — проходит.

## 2026-07-04 — Task 2.1: Бутстрап бота + upsert User на /start

- Обновлён `apps/bot/package.json`: зависимость `grammy` (^1.44.0).
- Создан `apps/bot/src/bot/bot.ts`: инстанс `Bot(config.BOT_TOKEN)`, регистрация команды `/start`.
- Создан `apps/bot/src/bot/handlers/start.ts`: `prisma.user.upsert` по `id` (`BigInt(ctx.from.id)`),
  `username`/`firstName` через `?? null` в `update` и `create`; приветствие + inline-клавиатура.
- Создан `apps/bot/src/bot/keyboards.ts`: `InlineKeyboard` с кнопкой «Оформить подписку`
  (`callback_data: 'subscribe'`; обработчик — Task 2.2).
- Обновлён `apps/bot/src/index.ts`: `bot.start()` (long polling), `bot.catch` → pino-лог ошибок.
- Проверено: `npm run type-check -w apps/bot`, `npm run build -w apps/bot` — проходят;
  `npm run dev -w apps/bot` — long polling стартует без ошибок в консоли.

## 2026-07-04 — Task 1.5: apps/bot — config.ts (zod) + pino + пустой запуск

- Обновлён `apps/bot/package.json`: зависимости `zod`, `pino`; devDependency `tsx`; `dev` —
  `tsx watch --env-file=../../.env src/index.ts` (корневой `.env`, как у `packages/db`);
  `build` — `tsc`.
- Создан `apps/bot/src/config.ts`: zod-схема всех 10 переменных prd п.8; хелпер
  `bigIntFromNonEmptyString` — явная проверка непустой строки до `BigInt(...)` (обход
  `z.coerce.bigint()` → `0n` на `""`); `GROUP_ID` без ограничения знака (отрицательный ID
  супергруппы); `ADMIN_ID` — `.refine(value > 0n)`; `safeParse` на верхнем уровне модуля,
  при ошибке — читаемый список полей + `process.exit(1)`; экспорт типизированного `config`.
- Создан `apps/bot/src/logger.ts`: экспорт инстанса pino (структурный JSON-лог).
- Создан `apps/bot/src/index.ts`: импорт `config` + `logger`, лог `"bot started"` с
  `groupId`/`adminId` как строки (BigInt-safe); без grammY, Fastify, cron.
- `apps/bot/tsconfig.json` без изменений (`noEmit` для dev, `tsc` для `build`/`type-check`).
- Проверено: `npm run type-check -w apps/bot` — проходит; `process.env` только в
  `config.ts`.

## 2026-07-04 — Task 1.4: Seed — настройки + первый админ

- Создан `packages/db/prisma/seed.ts`: идемпотентный seed через `upsert` — 5 дефолтных `Setting`
  (`price=990`, `period_days=30`, `remind_days=3`, `muted_remind_days=10`, `cron_time=09:00`) и
  первый `Admin` с `telegramId = BigInt(process.env.ADMIN_ID)` без email/passwordHash; при
  отсутствии `ADMIN_ID` — явная ошибка на старте.
- Обновлён `packages/db/package.json`: devDependency `tsx`; скрипт `seed` и блок `prisma.seed` —
  `node --env-file=../../.env --import tsx prisma/seed.ts` (тот же паттерн загрузки env, что у
  `migrate`/`generate`).
- `packages/db/tsconfig.json`: `rootDir: "."`, включён `prisma/seed.ts` для `type-check`.
- Проверено: `npm run seed -w packages/db` дважды — без дублей и падений; в БД 5 `Setting` и 1
  `Admin` с корректным `telegramId` (BigInt = `ADMIN_ID` из `.env`); `npm run type-check -w
  packages/db` — проходит.

## 2026-07-04 — Task 1.3: packages/db — Prisma-схема + клиент + миграция

- Создан workspace `packages/db`: `prisma/schema.prisma` (MySQL, модели `User`, `Payment`,
  `Admin`, `Setting`; enum `UserStatus` NEW|ACTIVE|MUTED|LEFT, `PaymentStatus` PENDING|PAID|FAILED;
  `User.id`/`Admin.telegramId`/`Payment.userId` — `BigInt` без autoincrement;
  `Payment.id` — `Int @default(autoincrement())`; `Payment.amount` — `Decimal(10,2)`;
  `User.status` default `NEW`), `src/index.ts` (синглтон `prisma` + реэкспорт типов/enum'ов),
  `package.json` (prisma 6.19, скрипты `generate`/`migrate`/`migrate:deploy`/`studio`/`build`/`type-check`),
  `tsconfig.json` (extends `tsconfig.base.json`).
- Первая миграция `prisma/migrations/20250704102800_init/migration.sql` применена к реальной MySQL
  на Beget через `migrate deploy`; `migrate status` — `Database schema is up to date!`.
- Минимальный stub `apps/bot` (`package.json`, `tsconfig.json`, `src/db-import-check.ts`) —
  проверка импорта `@tg-bot/db` компилируется (`npm run type-check` в обоих workspace).
- Скрипты Prisma читают корневой `.env` через `node --env-file=../../.env` (единый `DATABASE_URL`
  для монорепо); путь к CLI — `../../node_modules/prisma/build/index.js` (кроссплатформенно, в т.ч. Windows).
- Найдено при миграции: `prisma migrate dev` на shared-хостинге падает с P3014 (нет прав на shadow DB);
  обходной путь — `migrate diff --from-empty --to-schema-datamodel` → файл в `migrations/` →
  `migrate:deploy`. Хак `shadowDatabaseUrl = url` в Prisma 6.19 запрещён (валидация P1012).
- `npm run generate`, `npm run type-check` (root, `packages/db`, `apps/bot`) — проходят чисто.

## 2026-07-04 — Task 1.1: каркас монорепо и инструментарий

- Root `package.json` (npm workspaces `apps/*`, `packages/*`), `tsconfig.base.json`
  (strict, `module`/`moduleResolution: NodeNext`, `types: ["node"]`), `eslint.config.js`
  (flat config, typed linting через `projectService`, ограничен на `**/*.ts` — иначе
  падал на самом `eslint.config.js`), `.prettierrc` + `.prettierignore` (`.docs`,
  `.gigacode` исключены из форматирования как hand-authored), `.gitignore`, `.env.example`
  (10 переменных из prd п.8), `apps/admin/package.json` (минимальный stub без реальных
  зависимостей).
- Версии зафиксированы по факту из npm registry на дату таска: eslint 10.6.0,
  typescript-eslint 8.62.1, typescript 6.0.3, prettier 3.9.4 — совместимость peer-зависимостей
  проверена (`typescript-eslint` поддерживает `eslint@^10` и `typescript <6.1.0`).
- Найдено и исправлено при проверке: без явного `@types/node` в базовом tsconfig глобалы
  Node (`console` и т.п.) не резолвились даже при установленном пакете — добавлено
  `"types": ["node"]` в `tsconfig.base.json`.
- Проверено вручную (не осталось в репо): временный тестовый файл с ESM-импортом без
  `.js` расширения корректно падает с `TS2835` под `NodeNext`, strict-режим ловит
  несовместимость типов.
- `npm install`, `npm run lint`, `npm run format:check`, `npm run type-check`,
  `npm run build` — все проходят чисто.
