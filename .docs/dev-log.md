# Development Log

Журнал сессий разработки. Записывай сюда что сделано после каждой сессии.

---

## 2026-07-06 — TASK.md (Task 6.4): ревью автотестов, контрольный прогон, чеклист ручной проверки

**Фаза:** 6 — Ежедневный cron: mute истёкших. **Таск:** 6.4 «Тесты + ручная проверка».

**Что сделано (автоматическая часть):**

- Ревью пяти тестовых файлов против DoD фазы 6 и `dod-global.md` (разделы Cron/конкурентность,
  Telegram API): `dailyCheck.test.ts`, `scheduler.test.ts`, `admin.test.ts`, `subscription.test.ts`,
  `webhook.test.ts`. **Пробелов нет** — production-код и тесты не менялись.
- Контрольный прогон из корня: `npm test` 94/94, `npm run type-check`, `npm run lint` — чисто.
- Сверка `dod-global.md`: `Europe/Moscow`, `GET_LOCK`/`RELEASE_LOCK`, atomic `updateMany`,
  mute/unmute без `banChatMember`, 403 в `notify.ts` — покрыты; граничные даты напоминаний
  (3/9/10/20 дней) — Фаза 7, вне скоупа.
- Подготовлен чеклист ручной проверки (3 сценария): mute → оплата → unmute через `/admin` +
  `test-webhook.ts`; CommonAccess-only не затрагивается; смена `Setting.cron_time` без рестарта
  бота.
- Обновлена документация: `TASK.md` (DoD автоматической части ✅), `phase-6.md`, `_status.md`.

**Остаётся (ручная часть DoD, выполняет пользователь):**

- `expiresAt` в прошлое → «🔄 Проверить подписки» → mute + сообщение с оплатой → webhook → unmute.
- Пользователь только с `CommonAccess` не затрагивается при ручном/cron-запуске.
- Смена `cron_time` в Prisma Studio подхватывается планировщиком на живом процессе.

**Статус:** Task 6.4 — автотесты/ревью ✅, ручная проверка ⏳. Фаза 6 — 🔄 в работе.

## 2026-07-06 — Task 6.3: Планировщик (node-cron) + `/admin`: проверка, сводка, ссылка на панель

- Добавлены зависимости `node-cron`, `@types/node-cron` в `apps/bot/package.json`.
- Создан `apps/bot/src/util/moscowDate.ts`: `getMoscowCalendarDate`, `getMoscowTimeHHmm`,
  `parseCronTime`, `cronTimeMatchesNow`, `getMoscowDayBounds` — единая точка для day-guard
  планировщика и подсчёта «оплат за сегодня» по `Europe/Moscow` (не UTC/локаль сервера).
- Создан `apps/bot/src/jobs/scheduler.ts`: `cron.schedule('* * * * *', …, { timezone:
  'Europe/Moscow' })`; на каждом тике чтение `Setting.cron_time` без кэша; in-memory day-guard
  по календарной дате МСК; malformed `cron_time` → `logger.warn`, тик пропускается; экспорт
  `schedulerTick` и `resetSchedulerDayGuardForTests` для тестов.
- Обновлён `apps/bot/src/jobs/dailyCheck.ts`: `runDailyCheck()` → `Promise<{ ranNow: boolean }>`
  (`false` при `GET_LOCK=0`, `true` после успешной обработки и `notifyAdmins`).
- Обновлён `apps/bot/src/index.ts`: `startScheduler()` при старте процесса.
- Обновлён `apps/bot/src/bot/keyboards.ts`: `ADMIN_CHECK_CALLBACK`, `ADMIN_SUMMARY_CALLBACK`,
  `adminKeyboard(panelUrl)` — «🔄 Проверить подписки», «📊 Сводка», «🔗 Панель» (url).
- Обновлён `apps/bot/src/bot/handlers/admin.ts`: заглушка заменена на `handleAdmin`,
  `handleAdminCheckCallback` (ответ по `ranNow` — явно разные тексты), `handleAdminSummaryCallback`
  (ACTIVE/MUTED/оплаты за сегодня через `getMoscowDayBounds`, без кэша).
- Обновлён `apps/bot/src/bot/bot.ts`: callback-хендлеры с обязательным `isAdmin` в цепочке.
- Создан `apps/bot/test/scheduler.test.ts`: 9 тестов — совпадение `cron_time`, day-guard,
  смена `cron_time` без рестарта, malformed value, граница полуночи МСК.
- Создан `apps/bot/test/admin.test.ts`: 7 тестов — клавиатура с url-кнопкой, `ranNow` true/false,
  сводка с границами МСК, отказ не-админу на callback через `isAdmin`.
- Обновлён `apps/bot/test/dailyCheck.test.ts`: assert на `{ ranNow: true }` / `{ ranNow: false }`
  при конкурентном вызове.
- Out of scope соблюдён: напоминания (Фаза 7), логика mute/unmute (Task 6.1–6.2), веб-панель,
  миграция Prisma.
- Проверено: `npm test` — 94 passed; `npm run type-check`, `npm run lint`, `npm run build -w apps/bot`
  — без ошибок; DoD Task 6.3 ✅; следующий — Task 6.4 (ручная проверка + закрытие фазы).

## 2026-07-06 — Task 6.2: Unmute при оплате (расширение транзакции webhook)

- Обновлён `apps/bot/src/services/subscription.ts`: `applyPayment` возвращает
  `{ expiresAt, wasMuted }` — флаг читается до апдейта (`wasMuted = status === MUTED`);
  `GrantAccessAfterPaymentParams` — поле `wasMuted: boolean`; новая
  `unmuteUserAfterPayment(userId)` — `getChat(GROUP_ID)` → `restrictChatMember(GROUP_ID,
  Number(userId), chat.permissions)` целиком (решение #2 фазы); guard на отсутствие
  `chat.permissions`; при сбое Telegram — `logger.error`, возврат `false` (не ломает webhook).
- Обновлён `apps/bot/src/payments/webhook.ts`: SUBSCRIPTION — деструктуризация
  `{ expiresAt, wasMuted }` из `applyPayment`; LIFETIME — явный `wasMuted: false`;
  `grantAccessBestEffort` после `grantAccessAfterPayment` — при `SUBSCRIPTION && wasMuted`
  вызывает `unmuteUserAfterPayment`; при `false` — лог + алерт админам «Ошибка unmute после
  оплаты», ответ `OK{InvId}` не затрагивается; идемпотентность транзакции webhook без изменений.
- Обновлён `apps/bot/test/subscription.test.ts`: `describe('applyPayment')` — `wasMuted` для
  `MUTED`/`ACTIVE`/`NEW`; `describe('unmuteUserAfterPayment')` — happy path (`getChat` +
  `restrictChatMember` с правами группы) и сбой (лог, без throw); мок `getChat` в `bot.api`;
  `grantAccessAfterPayment` — поле `wasMuted: false` в существующих кейсах.
- Обновлён `apps/bot/test/webhook.test.ts`: unmute для `MUTED` после SUBSCRIPTION; пропуск для
  `ACTIVE`/`NEW` и для LIFETIME даже при `MUTED`; сбой `getChat` → лог + алерт + `OK{InvId}`;
  моки `getChat`/`restrictChatMember` в `bot.api`.
- Out of scope соблюдён: сброс флагов напоминаний (Фаза 3), выдача invite-ссылки без изменений,
  cron и `/admin` (Task 6.3), сквозные тесты фазы (Task 6.4).
- Проверено: `npm test` — 78 passed; `npm run build -w apps/bot` — без ошибок; DoD Task 6.2 ✅;
  следующий — Task 6.3 (планировщик + `/admin`).

## 2026-07-06 — Task 6.1: `jobs/dailyCheck.ts` — mute истёкших + оплата + сводка админам

- Создан `apps/bot/src/jobs/dailyCheck.ts`: `runDailyCheck()` — `GET_LOCK('daily_check', 0)` /
  `RELEASE_LOCK` в одном `prisma.$transaction` (`finally` на release); выборка `User` где
  `status=ACTIVE AND expiresAt <= now`; per-user цикл с атомарным guard через
  `muteExpiredUser`; личное сообщение «Подписка истекла…» + `paymentKeyboard` на новый
  `Payment(PENDING, SUBSCRIPTION)`; `notifyAdmins` со сводкой «замьючено N» + `formatUserMention`
  — всегда, включая `N=0`; при `GET_LOCK=0` — `logger.warn` и выход без обработки.
- Обновлён `apps/bot/src/services/subscription.ts`: `createSubscriptionPaymentLink(userId)` —
  чтение `Setting` (`price`, `period_days` без кэша), `Payment.create` + `buildPaymentUrl`;
  `muteExpiredUser(tx, userId, now)` — `updateMany` guard (`ACTIVE` + `expiresAt <= now` →
  `MUTED`/`mutedAt`), best-effort `restrictChatMember` без `until_date` (`Number(userId)` для
  `user_id`); ошибка Telegram логируется, возврат `true` если guard сработал.
- Обновлён `apps/bot/src/bot/handlers/start.ts`: `handleSubscribeCallback` переключён на
  `createSubscriptionPaymentLink` — поведение и тексты без изменений.
- Создан `apps/bot/test/dailyCheck.test.ts`: 10 тестов — mute + сообщение + сводка; граница
  `expiresAt === now` / `now + 1с`; CommonAccess-only не трогается; идемпотентность для `MUTED`;
  сводка при `N=0`; сбой `restrictChatMember`/`sendMessage` на одном юзере не прерывает цикл;
  конкурентный `GET_LOCK=0`; `RELEASE_LOCK` при ошибке внутри транзакции.
- Обновлён `apps/bot/test/subscription.test.ts`: `describe('createSubscriptionPaymentLink')` и
  `describe('muteExpiredUser')` — guard, restrict, возврат `false` при `count !== 1`.
- Обновлён `apps/bot/test/start.test.ts`: мок `createSubscriptionPaymentLink` вместо прямых
  `prisma.payment.create`/`buildPaymentUrl` — сценарии успеха/недоступной цены сохранены.
- Out of scope соблюдён: напоминания (Фаза 7), unmute при оплате (Task 6.2), cron и `/admin`
  (Task 6.3), миграция Prisma не нужна.
- Проверено: `npm test` — 68 passed; DoD Task 6.1 ✅; следующий — Task 6.2 (unmute при оплате).

## 2026-07-05 — Task 5.5: Тесты сквозного сценария (автотесты)

- Обновлён `apps/bot/test/start.test.ts`: мок `services/subscription.js` (`resendCommonAccessInviteLink`);
  тест кнопки «Получить ссылку снова» при `paid_not_in_group` (`inGroup=false`); блок
  `describe('handleResendAccessCallback')` — 4 теста: нет `CommonAccess` / `inGroup=true` →
  «уже активен», сервис не вызван; `inGroup=false` → вызов сервиса, `Payment` не создаётся;
  сбой сервиса → сообщение об ошибке, без необработанного исключения.
- Обновлён `apps/bot/test/subscription.test.ts`: `describe('grantAccessAfterPayment')` — SUBSCRIPTION
  → `GROUP_ID`, текст «закрытую группу», `notifyAdmins` с «срок до»; LIFETIME → `COMMON_GROUP_ID`,
  текст «общую группу», `notifyAdmins` с «бессрочный доступ»; `describe('resendCommonAccessInviteLink')`
  — строго `COMMON_GROUP_ID`, текст без «Оплата прошла успешно»; `config` из реального `.env`.
- Обновлён `apps/bot/test/webhook.test.ts`: два теста сбоя Telegram после коммита транзакции —
  `createChatInviteLink` бросает ошибку и `sendMessage` бросает ошибку после успешного создания
  ссылки; в обоих случаях ответ `OK{InvId}`, `logger.error`, `notifyAdmins` с алертом
  «Ошибка выдачи доступа» (не с текстом об оплате).
- Out of scope соблюдён: новая функциональность не добавлялась; `chatMember.test.ts` /
  `notify.test.ts` не трогались.
- Проверено: `npm test` — 52 passed; `npm run type-check`, `npm run lint` — без ошибок.
  Task 5.5: автотесты ✅; осталась ручная проверка happy path в Telegram (обе группы).

## 2026-07-05 — Task 5.4: Повторная выдача ссылки в общую группу без оплаты

- Обновлён `apps/bot/src/bot/keyboards.ts`: константа `RESEND_ACCESS_CALLBACK`; тип
  `CommonAccessUiState` (`'none' | 'paid_in_group' | 'paid_not_in_group'`); `productChoiceKeyboard`
  — три состояния вместо `boolean`: без доступа — обе кнопки продукта; `inGroup=true` — только
  «Закрытая группа»; `inGroup=false` — «Закрытая группа» + «Получить ссылку снова».
- Обновлён `apps/bot/src/bot/handlers/start.ts`: `handleStart` читает `commonAccess.inGroup` и
  вычисляет `CommonAccessUiState`; новый `handleResendAccessCallback` — `answerCallbackQuery`,
  повторное чтение `CommonAccess` из БД (защита от race condition с `chat_member`), при
  `inGroup=true` или отсутствии доступа — «Доступ в общую группу уже активен»; иначе вызов
  `resendCommonAccessInviteLink`; ошибки Telegram API — `logger.error` + понятное сообщение
  пользователю, без `Payment` и без необработанного исключения.
- Обновлён `apps/bot/src/services/subscription.ts`: `resendCommonAccessInviteLink(userId)` —
  `createChatInviteLink` в `config.COMMON_GROUP_ID` (`member_limit: 1`), отдельный текст
  «Ваша ссылка для вступления…» (без «Оплата прошла успешно»); без `notifyAdmins`, без
  `resolveGroupId` (группа жёстко `COMMON_GROUP_ID`).
- Обновлён `apps/bot/src/bot/bot.ts`: регистрация
  `bot.callbackQuery(RESEND_ACCESS_CALLBACK, handleResendAccessCallback)`.
- Обновлён `apps/bot/test/start.test.ts`: мок `CommonAccess` с полем `inGroup: true` для
  регрессионного теста «hides common access button…».
- Out of scope соблюдён: повторная выдача для закрытой группы (решение #1), полный набор
  автотестов resend/race/error (Task 5.5), отзыв старых invite-ссылок (решение #5).
- Проверено: `npm test` — 41 passed; `npm run type-check` — без ошибок.
  Task 5.4 ✅; следующий — Task 5.5 (сквозные тесты + ручная проверка).

## 2026-07-05 — Task 5.3: `chat_member` — вступление/выход в обеих группах

- Создан `apps/bot/src/bot/handlers/chatMember.ts`: `handleChatMemberUpdate(ctx)` — группа
  определяется через `BigInt(ctx.chatMember.chat.id)` против `config.GROUP_ID`/`COMMON_GROUP_ID`;
  неизвестный `chat.id` — тихий игнор. `new_chat_member.status` → `member` пишет `inGroup=true`,
  `left`/`kicked` — `false`, остальные статусы (`restricted`, `administrator`, `creator`) не
  трогают `inGroup` вовсе. `notifyAdmins` о вступлении вызывается только при переходе
  `old_chat_member.status` (`left`/`kicked`) → `new_chat_member.status === 'member'` — обычный
  `restricted → member` (будущий unmute Фаз 6–7) уведомления не генерирует.
- Обновлён `apps/bot/src/services/subscription.ts`: `formatUserMention` экспортирована (была
  приватной); добавлены `setUserInGroup(userId, inGroup)` и
  `setCommonAccessInGroup(userId, inGroup)` — оба через `updateMany` (не `update`), чтобы
  отсутствующая запись `User`/`CommonAccess` не роняла хендлер.
- Обновлён `apps/bot/src/bot/bot.ts`: регистрация `bot.on('chat_member', handleChatMemberUpdate)`.
- Обновлён `apps/bot/src/index.ts`: `bot.start({ allowed_updates: [...API_CONSTANTS.DEFAULT_UPDATE_TYPES, 'chat_member'] })`,
  импорт `API_CONSTANTS` из `grammy`.
- Создан `apps/bot/test/chatMember.test.ts`: 7 тестов — join в `GROUP_ID`/`COMMON_GROUP_ID`
  (`left`/`kicked` → `member`), переход `restricted → member` без предшествующего
  `left`/`kicked` (обновляет `inGroup`, но не уведомляет — сценарий будущего unmute),
  `left`/`kicked` без уведомления, статус `restricted` полностью игнорируется, неизвестный
  `chat.id`. Моки `services/subscription.js`, `services/notify.js`, `bot/bot.js` через `vi.mock`.
- Out of scope соблюдён: `UserStatus.LEFT` как статус подписки, кик замьюченных, повторная
  выдача invite-ссылки без оплаты (Task 5.4), полное покрытие сценариев (Task 5.5).
- Проверено: `npm test` — 41 passed; `npm run type-check`, `npm run lint` — без ошибок;
  `npm run build -w apps/bot` (`tsc`) — OK (полный `npm run build` упал на `prisma generate`
  EPERM Windows — query engine занят другим процессом, к коду таска не относится).
  Task 5.3 ✅; следующий — Task 5.4 (повторная выдача ссылки без оплаты).

## 2026-07-05 — Task 5.2: Webhook — `freshlyProcessed` + выдача доступа после оплаты

- Обновлён `apps/bot/src/payments/webhook.ts`: транзакция возвращает `freshlyProcessed`
  (`true` только при первом `PENDING→PAID`, `false` при идемпотентном повторе по уже `PAID`);
  после коммита — `grantAccessBestEffort()` только при `freshlyProcessed: true`; ошибки
  Telegram в try/catch после транзакции — лог + алерт админам через `notifyAdmins`, ответ
  webhook остаётся `OK{InvId}`.
- Обновлён `apps/bot/src/services/subscription.ts`: `applyPayment` возвращает `expiresAt`;
  новая `grantAccessAfterPayment()` — `resolveGroupId()` (`SUBSCRIPTION` → `GROUP_ID`,
  `LIFETIME` → `COMMON_GROUP_ID`), `createChatInviteLink({ member_limit: 1 })`, разовый
  `sendMessage` пользователю, `notifyAdmins` с текстом по продукту (решение #6: «срок до …» /
  «бессрочный доступ в общую группу»); все BigInt → `.toString()` перед Telegram API.
- `apps/bot/src/bot/bot.ts` без изменений — webhook/subscription импортируют синглтон `bot`
  напрямую; `registerRobokassaWebhook` и `index.ts` не трогались.
- Обновлён `apps/bot/test/webhook.test.ts`: моки `bot/bot.ts` (`createChatInviteLink`,
  `sendMessage`) и `notify.ts` (`notifyAdmins`); мок `user.findUniqueOrThrow` для `username`;
  проверки вызова/не-вызова Telegram при первичной оплате и идемпотентном повторе.
- Out of scope соблюдён: `chat_member` (Task 5.3), повторная выдача без оплаты (Task 5.4),
  полное покрытие новых веток и сценарий ошибки Telegram (Task 5.5).
- Проверено: `npm test` — 34 passed; `npm run type-check`, `npm run lint` — без ошибок.
  Task 5.2 ✅; следующий — Task 5.3 (`chat_member`).

## 2026-07-05 — Task 5.1: `services/notify.ts` — рассылка админам с троттлингом

- Создан `apps/bot/src/services/notify.ts`: `sendThrottledTextMessages(bot, chatIds, text, options?)`
  — последовательная отправка с интервалом 40 ms (≤25 msg/sec), `bigint` → `.toString()` перед
  `sendMessage` и логами; `try/catch` на каждого получателя (`GrammyError`, `HttpError`, прочие) —
  ошибка логируется, рассылка продолжается; инъекция `delay` для тестов. `notifyAdmins(bot, text)` —
  `prisma.admin.findMany`, затем вызов примитива; пустой список админов не падает.
- Создан `apps/bot/test/notify.test.ts`: 8 тестов — рассылка по chatId, троттлинг (26 получателей →
  25 пауз без реального ожидания), пустой массив, 403/400 `GrammyError` и `HttpError` без
  прерывания, `notifyAdmins` и пустая таблица; моки `bot.api.sendMessage`, Prisma, logger.
- Out of scope соблюдён: вызов `notifyAdmins` из webhook (Task 5.2), рассылка пользователям
  (Фаза 7), retry.
- Проверено: `npm test` — 34 passed; `npm run type-check -w apps/bot` — без ошибок.
  Task 5.1 ✅; следующий — Task 5.2 (webhook + выдача доступа).

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
