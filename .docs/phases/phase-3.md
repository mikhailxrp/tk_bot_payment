# Phase 3 — Робокасса: платёжная ссылка + webhook

## Статус

🔄 В работе (все таски ✅) | Начата: 2026-07-04 | Ветка: `phase-3`

## Цель

Реальная оплата через Робокассу: кнопка «Оплатить» ведёт на настоящую платёжную ссылку
(с фискальным Receipt и подписью), `POST /robokassa/result` проверяет подпись и в одной
транзакции переводит платёж в `PAID` и продлевает подписку, идемпотентно на повторные вызовы.
Success/Fail редиректы дают пользователю UX-обратную связь, но не влияют на состояние —
источник истины только Result URL. Invite-ссылка, unmute, уведомления админам — вне скоупа
(Фазы 4–5).

## Контекст

Опирается на Фазу 1 (Prisma-схема: `Payment`, `Setting`, `config.ts` с zod) и Фазу 2
(`/start`, меню подписки с ценой из `Setting`, заглушка-URL кнопки «Оплатить»). Разделы PRD:
3.1 (шаги 4–6, 9 — уведомления админам не входят), 3.2 (продление), 7 (интеграция с
Робокассой), 8 (нефункциональные требования — одна транзакция). Правила CLAUDE.md пп. 1–4, 9.

**Блокер снят:** доступ к кабинету Робокассы и система налогообложения (`sno`/`tax`)
подтверждены пользователем перед стартом фазы.

**Решения, принятые на этапе проверки документации:**

- **#1 — `sno`/`tax` через ENV, не через `Setting`.** Новые переменные `ROBO_SNO`, `ROBO_TAX`
  в `config.ts` (zod). Причина: это константы юрлица, не бизнес-параметры, изменяемые через
  панель (в отличие от `price`/`cron_time`); не расширяем seed 5 ключей `Setting`
  (решение #2 Фазы 1).
- **#2 — `ROBO_IS_TEST` — новая ENV в `config.ts`.** Бул, обязателен, на dev `true`.
  Прокидывается в `buildPaymentUrl` как `IsTest=1|0`. До этой фазы такой переменной не было
  ни в `CLAUDE.md`/prd списке `.env`, ни в коде.
- **#3 — Success/Fail URL без новой ENV.** Username бота для `t.me/<username>?start=paid|fail`
  берётся из `bot.botInfo.username` (grammY, доступен после `bot.init()`/`bot.start()`),
  отдельная переменная `BOT_USERNAME` не нужна.
- **#4 — Каждое нажатие «Оплатить» создаёт новый `Payment(PENDING)`.** Не переиспользуем
  предыдущий pending-платёж того же юзера — проще и однозначно определяет `InvId`.
- **#5 — vitest ранее нигде не был настроен** (ни root, ни `apps/bot`), хотя `CLAUDE.md`
  уже описывает `npm test`. Настройка входит в Task 3.5 этой фазы, отдельного решения не
  требовало — прямое следствие правила «тесты на подписи пишутся в Фазе 3».

## Таски

### Task 3.1 — Robokassa: чистые функции подписи + Receipt + buildPaymentUrl

- **Статус:** ✅ Готово
- **Workspace:** bot
- **Цель:** чистые функции без побочных эффектов: сборка Receipt (JSON), подпись ссылки,
  `buildPaymentUrl` с двойным URL-кодированием Receipt в самой ссылке.
- **Файлы:** `apps/bot/src/payments/robokassa.ts`, `apps/bot/src/config.ts`
  (+ `ROBO_IS_TEST`, `ROBO_SNO`, `ROBO_TAX`), `.env.example`
- **Out of scope:** `verifyResultSignature` (Task 3.3), запись `Payment` в БД (Task 3.2)
- **DoD:**
  - [x] `buildPaymentUrl` возвращает URL с `MerchantLogin, OutSum (2 знака после точки), InvId,
        Description, Receipt, SignatureValue, IsTest`
  - [x] подпись ссылки = `md5(MerchantLogin:OutSum:InvId:Receipt:Pass1)`, Receipt в подписи
        закодирован **один раз**, в самой ссылке — **дважды**
  - [x] Receipt JSON: `items[].payment_object = "service"`, `sno`/`tax` берутся из
        `config.ROBO_SNO`/`config.ROBO_TAX`, не хардкодятся
  - [x] функции чистые: принимают все данные аргументами (кроме чтения `config` для
        Login/Pass1/IsTest/sno/tax), не обращаются к Prisma/Telegram

### Task 3.2 — Payment(PENDING) + реальная ссылка вместо заглушки

- **Статус:** ✅ Готово
- **Workspace:** bot
- **Цель:** по нажатию «Оформить подписку» бот создаёт `Payment(PENDING)` с текущей ценой,
  `InvId = Payment.id`, строит реальную ссылку через `buildPaymentUrl`, заменяет заглушку.
- **Файлы:** `apps/bot/src/bot/handlers/start.ts`, `apps/bot/src/bot/keyboards.ts`
- **Out of scope:** сама оплата/webhook (Task 3.3), invite-ссылка (Фаза 4)
- **DoD:**
  - [x] нажатие «Оформить подписку» создаёт запись `Payment` со статусом `PENDING` и
        текущей ценой из `Setting` (формат `OutSum` через `formatOutSum`)
  - [x] кнопка «Оплатить» ведёт на реальный URL Робокассы (`IsTest=1` в dev-окружении)
  - [x] повторное нажатие создаёт новый `Payment` (решение #4), старый PENDING не переиспользуется

### Task 3.3 — Fastify + POST /robokassa/result: подпись, идемпотентность, продление

- **Статус:** ✅ Готово
- **Workspace:** bot
- **Цель:** поднять Fastify рядом с grammY-ботом; эндпоинт проверяет подпись, при уже `PAID`
  отвечает `OK{InvId}` без изменений, иначе одной транзакцией переводит `Payment.PAID` +
  продлевает подписку (правило: активна → `expiresAt + period_days`, истекла/нет → `now +
  period_days`, сброс `reminderSentAt`/`lastMutedRemindAt`).
- **Файлы:** `apps/bot/src/payments/robokassa.ts` (`verifyResultSignature`),
  `apps/bot/src/payments/webhook.ts`, `apps/bot/src/services/subscription.ts`
  (`extendSubscription` — чистый расчёт даты + вызов Prisma), `apps/bot/src/index.ts`
  (bootstrap Fastify), `apps/bot/package.json` (+ `fastify`)
- **Out of scope:** invite-ссылка/unmute (Фазы 4–5), уведомления админам (Фаза 4)
- **DoD:**
  - [x] валидный webhook → `Payment.PAID` + продление (`period_days` из `Setting`, не хардкод
        30) в одной `prisma.$transaction`
  - [x] повторный POST с тем же `InvId` не меняет данные повторно, отвечает `OK{InvId}`
  - [x] подпись = `md5(OutSum:InvId:Pass2)`, Receipt не участвует, сравнение case-insensitive
  - [x] неверная подпись → 400, `Payment` не создаётся/не меняется
  - [x] ответ на валидный webhook — строго `OK{InvId}` plain text

### Task 3.4 — Success/Fail deep-link (`/start paid|fail`)

- **Статус:** ✅ Готово
- **Workspace:** bot
- **Цель:** обработка payload у `/start` — UX-сообщения об успехе/неуспехе оплаты, не
  влияющие на состояние (источник истины — только webhook, решение #3).
- **Файлы:** `apps/bot/src/bot/handlers/start.ts`, `apps/bot/src/bot/bot.ts`
- **Out of scope:** любое изменение `Payment`/`User` по этому пути
- **DoD:**
  - [x] `/start paid` показывает сообщение об успешной оплате, БД не меняет
  - [x] `/start fail` показывает сообщение о неуспехе/отмене, БД не меняет
  - [x] обычный `/start` без payload работает как раньше (регрессия Фазы 2 отсутствует)

### Task 3.5 — Тесты (vitest): подписи, Receipt-кодирование, продление, webhook

- **Статус:** ✅ Готово
- **Workspace:** bot (+ root tooling)
- **Цель:** настроить vitest (решение #5) и покрыть обе подписи Робокассы (включая
  одно/двойное кодирование Receipt), расчёт продления (граничные даты), webhook
  (валид/невалид/повтор).
- **Файлы:** `vitest.config.ts`, `apps/bot/package.json` (`test` script, devDependency
  `vitest`), `apps/bot/test/setup.ts`, `apps/bot/test/robokassa.test.ts`,
  `apps/bot/test/subscription.test.ts`, `apps/bot/test/webhook.test.ts`
- **Out of scope:** e2e с реальной Робокассой (ручная проверка `IsTest=1` — DoD фазы, не
  автотест)
- **DoD:**
  - [x] `npm test` из корня запускает vitest, все тесты зелёные
  - [x] Telegram API и сеть не задействуются в тестах (моки/фикстуры)
  - [x] тесты покрывают: подпись ссылки (с Receipt), подпись webhook, идемпотентность,
        расчёт продления (активна/истекла)

## DoD фазы (из phases.md)

- [ ] в тестовом режиме (`IsTest=1`) реальная тестовая оплата проходит, `Payment → PAID`,
      `expiresAt` проставлен
- [ ] повторный POST webhook не продлевает подписку второй раз
- [ ] кривая подпись → 400
- [ ] Все таски ✅, PR `phase-3` → `dev` создан после подтверждения

## Итоги

_(заполняется при закрытии: что отклонилось от плана, тех. долг, дата, PR)_
