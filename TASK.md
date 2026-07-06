# TASK: Unmute при оплате (расширение транзакции webhook)

## Фаза

Phase 6 — Ежедневный cron: mute истёкших (только закрытая группа)

## Статус

✅ Готово

## Цель

Пользователь, оплативший подписку в статусе `MUTED`, автоматически снимается с ограничения
в закрытой группе сразу после успешной обработки Robokassa-webhook — без ручного
вмешательства админа. `applyPayment` возвращает признак `wasMuted` (статус пользователя до
апдейта), и если он `true`, после коммита транзакции best-effort вызывается
`restrictChatMember` с текущими правами группы (как есть, не хардкод).

## Что нужно создать/изменить

- `apps/bot/src/services/subscription.ts` (bot, изменить):
  - `applyPayment` — читает `user.status` до апдейта, возвращает
    `{ expiresAt: Date; wasMuted: boolean }` вместо просто `Date`
    (`wasMuted = user.status === UserStatus.MUTED`)
  - `GrantAccessAfterPaymentParams` — новое поле `wasMuted: boolean`
  - новая функция `unmuteUserAfterPayment(userId: bigint): Promise<void>` —
    `bot.api.getChat(config.GROUP_ID.toString())` → `restrictChatMember(config.GROUP_ID.toString(),
    Number(userId), chat.permissions)` (права группы целиком, не хардкод)
- `apps/bot/src/payments/webhook.ts` (bot, изменить):
  - деструктуризация `{ expiresAt, wasMuted }` из `applyPayment` для ветки `SUBSCRIPTION`;
    для ветки `LIFETIME` — явный `wasMuted: false` в `accessBase`
  - `grantAccessBestEffort` — после `grantAccessAfterPayment`, при
    `result.access.product === ProductType.SUBSCRIPTION && result.access.wasMuted` вызывает
    `unmuteUserAfterPayment(result.access.userId)` в собственном `try/catch`: сбой логируется,
    уходит алерт `notifyAdmins` (тот же паттерн, что и для сбоя invite-ссылки), не влияет на
    уже вычисленный `OK{InvId}`
- `apps/bot/test/subscription.test.ts` (bot, изменить) — тесты: `applyPayment` возвращает
  `wasMuted=true` при предыдущем статусе `MUTED`, `wasMuted=false` при `ACTIVE`/`NEW`;
  `unmuteUserAfterPayment` — happy path (`getChat`+`restrictChatMember` с правильными
  аргументами) и сбой (логируется, не бросает исключение наружу); добавить `getChat` в мок
  `bot.api`
- `apps/bot/test/webhook.test.ts` (bot, изменить) — тесты: оплата `MUTED`-пользователя →
  `getChat`+`restrictChatMember` вызваны; оплата `ACTIVE`/`NEW` → не вызваны; `LIFETIME`-платёж
  никогда не вызывает unmute-ветку; сбой `getChat`/`restrictChatMember` → лог + алерт
  админам + всё равно `OK{InvId}` в ответе; добавить `getChat` в мок `bot.api`

## Out of scope

- Сброс `reminderSentAt`/`lastMutedRemindAt` — уже реализовано в Фазе 3, не меняется
- Сама выдача invite-ссылки (`grantAccessAfterPayment`) — не меняется
- Планировщик (`node-cron`) и кнопки `/admin` (Task 6.3)
- Автотесты/ручная проверка всей фазы разом (Task 6.4)

## ⚠️ Точки риска при реализации

- **`user_id` в `restrictChatMember` — `Number(userId)`, не `.toString()`.** `chat_id`
  (`GROUP_ID`) передаётся строкой, `user_id` — числом; это уже стало реальной ошибкой в Итогах
  Task 6.1 (`muteExpiredUser`), легко повторить на новом call site при копипасте.
- **`wasMuted` должен браться из статуса ДО апдейста, не после.** `applyPayment` сначала делает
  `findUniqueOrThrow`, потом `update` на `ACTIVE` — если прочитать статус после `update`, флаг
  всегда будет `false` и unmute никогда не сработает.
- **`LIFETIME` не должен доходить до unmute-ветки.** `accessBase` — общий объект для обеих
  веток webhook; нужен явный `wasMuted: false` в LIFETIME-ветке и явная проверка
  `product === SUBSCRIPTION` в `grantAccessBestEffort`, а не расчёт на то, что поле останется
  `undefined`/falsy по умолчанию.
- **Права передаются `chat.permissions` целиком, не хардкодом.** Telegram трактует
  непереданные поля `ChatPermissions` как `false` — частичный объект (например, только
  `can_send_messages: true`) молча урезал бы права относительно реальных настроек группы
  (решение #2 фазы).
- **Сбой `getChat`/`restrictChatMember` не должен пробрасываться наружу.** Вызов идёт после
  того, как `OK{InvId}` для Робокассы уже вычислен — нужен собственный `try/catch` по аналогии
  с существующим для сбоя invite-ссылки, иначе необработанное исключение помешает ответу на
  webhook (и Робокасса начнёт ретраить уже обработанный платёж).
- **Тестовые моки:** `getChat` нужно добавить в `vi.mock('../src/bot/bot.js')` в обоих
  тестовых файлах (`subscription.test.ts`, `webhook.test.ts`) — иначе тесты упадут с «getChat is
  not a function» вместо содержательной проверки логики.

## Definition of Done

- [x] Оплата пользователем в статусе `MUTED` → после коммита вызывается `getChat` +
      `restrictChatMember` с текущими правами группы; `status` уже `ACTIVE`
- [x] Оплата пользователем НЕ в статусе `MUTED` (`ACTIVE`/`NEW`) → `restrictChatMember` для
      unmute не вызывается
- [x] `LIFETIME`-платежи никогда не вызывают unmute-ветку
- [x] Сбой `getChat`/`restrictChatMember` логируется, уходит алерт админам, не влияет на уже
      отданный `OK{InvId}`
- [x] TypeScript компилируется без ошибок, `any` нет
- [x] `npm test` проходит (новые кейсы в `subscription.test.ts`, `webhook.test.ts`)
- [x] Проверить `.docs/prompts/dod-global.md`: «TypeScript» (BigInt/`Number()` на call site
      Telegram API); «Telegram API» (`restrictChatMember`, не `banChatMember`; unmute — права
      по умолчанию/текущие права группы); «Платежи / Робокасса» (транзакция и идемпотентность
      webhook не нарушены — только расширение best-effort части после коммита); «Код»
      (lint/build чисто)
