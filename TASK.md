# TASK: Тесты сквозного сценария + ручная проверка

## Фаза

Phase 5 — Выдача доступа в группы

## Статус

🔄 В работе

## Цель

Закрыть пробелы в тестовом покрытии функциональности, реализованной в тасках 5.1–5.4
(webhook `freshlyProcessed` + выдача доступа, `chat_member`, повторная выдача ссылки без
оплаты), и провести ручную проверку полного happy path в Telegram для обеих групп.

## Что нужно создать/изменить

- `apps/bot/test/start.test.ts` (bot) — добавить тест кнопки для состояния
  `paid_not_in_group` (видна «Получить ссылку снова»); добавить
  `describe('handleResendAccessCallback')`: нет `CommonAccess` / `inGroup=true` → «уже
  активен», сервис не вызван; `inGroup=false` → вызывает `resendCommonAccessInviteLink`,
  `Payment` не создаётся; сбой сервиса → `ctx.reply` с понятным текстом ошибки, без
  падения исключения
- `apps/bot/test/subscription.test.ts` (bot) — добавить `describe('grantAccessAfterPayment')`:
  SUBSCRIPTION → ссылка в `GROUP_ID`, текст пользователю «закрытую группу», `notifyAdmins`
  с текстом «срок до…»; LIFETIME → ссылка в `COMMON_GROUP_ID`, текст «общую группу»,
  `notifyAdmins` с текстом «бессрочный доступ»; добавить
  `describe('resendCommonAccessInviteLink')`: ссылка строго в `COMMON_GROUP_ID` (не через
  `resolveGroupId`), текст сообщения пользователю НЕ содержит «Оплата прошла успешно»
- `apps/bot/test/webhook.test.ts` (bot) — добавить тест: `createChatInviteLink`/`sendMessage`
  бросает ошибку → ответ всё равно `OK{InvId}`, ошибка залогирована, `notifyAdmins` вызван
  с алертом об ошибке (не с обычным текстом об оплате)
- Ручная проверка в Telegram (не код): `/start` → оплата (`IsTest=1`) → ссылка → вступление
  → 2 уведомления админам (оплата + вступление), для обеих групп; повторное использование
  ссылки отклоняется Telegram

## Out of scope

- Новая функциональность — только закрытие пробелов в тестах уже реализованного (5.1–5.4)
- e2e с реальной Робокассой (уже покрыто ручной проверкой Фазы 3)
- Изменения в `chatMember.test.ts` / `notify.test.ts` — уже полностью покрывают DoD своих
  тасков (5.1, 5.3), трогать не нужно

## ⚠️ Точки риска при реализации

- **Двойное мокирование одной и той же логики.** В `start.test.ts` нужно мокать модуль
  `services/subscription.js` целиком (как уже мокаются остальные модули в этом файле), чтобы
  тестировать только логику хендлера (чтение `CommonAccess`, вызов/невызов сервиса), а не
  реальную генерацию ссылки — иначе тест задвоит проверку с `subscription.test.ts`.
- **Ошибка в `grantAccessAfterPayment` может случиться на разных шагах.** Сбой возможен и на
  `createChatInviteLink`, и на `sendMessage` (уже после создания ссылки) — тест webhook
  должен закрыть оба пути, иначе останется непокрытый сценарий рассинхронизации «ссылка
  создана, но не отправлена».
- **`config.GROUP_ID`/`COMMON_GROUP_ID` — реальные BigInt из `.env`.** Как в
  `chatMember.test.ts`, нужно импортировать настоящий `config`, а не хардкодить числа —
  иначе тест сломается при смене `.env`.
- **Один и тот же мок `notifyAdmins` вызывается для двух разных сообщений** (обычное
  уведомление об оплате и алерт об ошибке выдачи доступа) — в тесте важно проверять
  конкретный текст/количество вызовов, а не просто факт вызова, иначе тест пройдёт даже при
  перепутанном тексте.

## Definition of Done

- [x] `start.test.ts`: кнопка «Получить ссылку снова» видна при состоянии `paid_not_in_group`
- [x] `start.test.ts`: `handleResendAccessCallback` — нет доступа / `inGroup=true` → «уже
      активен», сервис не вызван
- [x] `start.test.ts`: `handleResendAccessCallback` — `inGroup=false` → сервис вызван,
      `Payment` не создаётся
- [x] `start.test.ts`: `handleResendAccessCallback` — сбой сервиса → лог + сообщение
      пользователю, без необработанного исключения
- [x] `subscription.test.ts`: `grantAccessAfterPayment` — верная группа и текст для
      SUBSCRIPTION и LIFETIME
- [x] `subscription.test.ts`: `resendCommonAccessInviteLink` — строго `COMMON_GROUP_ID`,
      текст без «Оплата прошла успешно»
- [x] `webhook.test.ts`: сбой Telegram-вызова после коммита транзакции → `OK{InvId}` всё
      равно отдан, ошибка залогирована, `notifyAdmins` вызван с алертом
- [ ] Ручная проверка: `/start` → оплата (`IsTest=1`) → ссылка → вступил → 2 уведомления
      админам (обе группы); повторное использование ссылки отклонено Telegram
- [x] `npm test`, `npm run type-check`, `npm run lint` — чисто
- [x] Проверить `.docs/prompts/dod-global.md` (разделы «TypeScript», «Платежи / Робокасса»,
      «Telegram API»)
