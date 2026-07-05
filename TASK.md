# TASK: Тесты (vitest): подписи, Receipt-кодирование, продление, webhook

## Фаза

Phase 3 — Робокасса: платёжная ссылка + webhook

## Статус

✅ Готово

## Цель

Настроен vitest (впервые в проекте), `npm test` из корня прогоняет тесты и все зелёные.
Автотестами покрыты обе подписи Робокассы (включая одно/двойное кодирование Receipt),
расчёт продления подписки (граничные даты) и webhook `/robokassa/result`
(валидный / невалидный / повторный запрос), без обращения к реальному Telegram API или MySQL.

## Что нужно создать/изменить

- `vitest.config.ts` (root) — конфиг vitest: `test.include` на `apps/bot/test/**/*.test.ts`,
  `test.setupFiles` на файл с фиктивными env-переменными
- `package.json` (root) — добавить `"test": "vitest run"`
- `apps/bot/package.json` (bot) — `"test": "vitest run"`, devDependency `vitest`
- `apps/bot/test/setup.ts` (bot) — выставляет фиктивные `process.env.*` (BOT_TOKEN, GROUP_ID,
  ADMIN_ID, ROBO_LOGIN, ROBO_PASS1, ROBO_PASS2, ROBO_IS_TEST, ROBO_SNO, ROBO_TAX, DATABASE_URL,
  ADMIN_PANEL_URL, INTERNAL_API_TOKEN, AUTH_SECRET, PORT) **до** импорта модулей, читающих
  `config.ts`
- `apps/bot/test/robokassa.test.ts` (bot) — подпись ссылки (с Receipt, одно/двойное
  кодирование), подпись webhook, `formatOutSum`
- `apps/bot/test/subscription.test.ts` (bot) — `calculateNewExpiresAt` (активна/истекла,
  граничные даты)
- `apps/bot/test/webhook.test.ts` (bot) — Fastify-роут с замоканным `@tg-bot/db` (`vi.mock`):
  валидный webhook, неверная подпись → 400, повторный `PAID` → `OK` без изменений

## Out of scope

- E2E-проверка с реальной тестовой оплатой Робокассы (`IsTest=1`) — ручная проверка, DoD фазы,
  не автотест
- Тесты cron/напоминаний — Фазы 5–6, ещё не реализованы
- Любые изменения в `robokassa.ts` / `webhook.ts` / `subscription.ts` — таск только добавляет
  тесты, бизнес-логику не трогает

## ⚠️ Точки риска при реализации

- **Побочный эффект импорта `config.ts`:** `envSchema.safeParse(process.env)` выполняется на
  уровне модуля и вызывает `process.exit(1)` при невалидном env. Любой тестовый файл,
  импортирующий `robokassa.ts` или `webhook.ts` (транзитивно тянущий `config.ts`), убьёт весь
  vitest-процесс, если нужные env-переменные не выставлены до импорта. Решение — `setupFiles`
  в vitest.config.ts, а не `beforeEach`/`beforeAll` внутри теста (там уже поздно).
- **`new PrismaClient()` в `packages/db/src/index.ts`** выполняется при импорте `@tg-bot/db`.
  Для `webhook.test.ts` нужно мокать весь модуль (`vi.mock('@tg-bot/db', ...)`), иначе тест
  либо попытается читать реальный `DATABASE_URL`, либо начнёт реально стучаться в MySQL —
  нарушение DoD «сеть не задействуется».
- **Идемпотентность webhook легко протестировать неполно:** нужно покрыть именно повторный
  POST по уже `PAID` платежу (должен вернуть `OK` без изменений), а не только «второй вызов
  вообще» — наивный мок `$transaction` может незаметно продлевать подписку второй раз, если мок
  не воспроизводит `updateMany({ where: { status: PENDING } })`-guard.
- **Receipt-кодирование в тесте подписи ссылки:** легко перепутать «подпись = Receipt
  закодирован один раз» с «Receipt в самой ссылке закодирован дважды» — тест должен проверять
  оба значения раздельно, а не просто сверять итоговый URL целиком.

## Definition of Done

- [x] `npm test` из корня запускает vitest и все тесты зелёные
- [x] Telegram API и реальная сеть (включая реальный MySQL) не задействуются в тестах — только
      моки/фикстуры
- [x] Тест покрывает подпись ссылки: `Login:OutSum:InvId:Receipt:Pass1`, Receipt в подписи
      закодирован один раз
- [x] Тест покрывает двойное URL-кодирование Receipt в самой платёжной ссылке
- [x] Тест покрывает подпись webhook: `OutSum:InvId:Pass2`, сравнение case-insensitive, Receipt
      не участвует
- [x] Тест покрывает идемпотентность: повторный webhook по уже `PAID` платежу → `OK{InvId}` без
      изменения `expiresAt`
- [x] Тест покрывает невалидную подпись → 400, `Payment` не создаётся/не меняется
- [x] Тест покрывает расчёт продления: активная подписка (`expiresAt + period_days`) и
      истёкшая/отсутствующая (`now + period_days`)
- [x] TypeScript компилируется без ошибок (`npm run type-check`)
- [x] Проверить .docs/prompts/dod-global.md (разделы TypeScript и «Платежи / Робокасса»)
