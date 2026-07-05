# Phase 5 — Выдача доступа в группы

## Статус

🔄 В работе | Начата: 2026-07-05 | Ветка: `phase-5` | Таски 5.1–5.4 ✅, 5.5 автотесты ✅, ручная проверка ожидает

## Цель

После успешной оплаты (обоих продуктов) пользователь получает одноразовую invite-ссылку в
нужную группу — закрытую (`SUBSCRIPTION`) или общую (`LIFETIME`) — и уведомление; вступление и
выход фиксируются в БД (`User.inGroup` / `CommonAccess.inGroup`), при этом `User.status` не
меняется этим флагом. Админы получают уведомления об оплате и о вступлении через
`services/notify.ts`. Пользователь с уже оплаченным LIFETIME-доступом, вышедший из общей
группы, может получить новую одноразовую ссылку без повторной оплаты. Mute, cron и напоминания
пользователям — вне скоупа (Фазы 6–7).

## Контекст

Опирается на Фазу 4 (✅): `ProductType`/`CommonAccess`, `/start` с выбором группы, webhook
ветвится по `Payment.product` внутри транзакции (`Payment.PAID` + продление/`CommonAccess`).
Разделы PRD: 3.1 (шаги 7–9 — invite-ссылка, снятие mute, уведомление админам), 3.5 (возврат
после оплаты), 3.6.3–3.6.6 (общая группа: ссылка, cron/mute её не касаются, повторная выдача
без оплаты), 8 (Telegram-вызовы best-effort). Правила CLAUDE.md пп. 6, 7, 8, 11, 16.

**Решения, принятые на этапе проверки документации (обсуждены и подтверждены перед стартом):**

- **#1 — CLAUDE.md п.7 дополняется исключением.** Invite-ссылка создаётся не только «в момент
  успешной оплаты», но и по запросу пользователя с уже оплаченным `LIFETIME`-доступом, если он
  вышел из общей группы (`CommonAccess.inGroup=false`) — без создания нового `Payment`. Для
  `SUBSCRIPTION` исключений нет: вернуться в закрытую группу можно только через новую оплату
  (существующий флоу продления/unmute), это правило не меняется.
- **#2 — `chat_member`-хендлер обрабатывает обе стороны перехода**, join И left/kicked, для
  обеих групп: `new_chat_member.status === 'member'` → `inGroup=true`; `'left'`/`'kicked'` →
  `inGroup=false`. Ни та, ни другая ветка не трогает `User.status` — обработка `UserStatus.LEFT`
  как отдельного статуса подписки по-прежнему вне скоупа (решение от 2026-07-05, Фаза 4/5 до
  перенумерации). `inGroup=false` нужен только как триггер для кнопки повторной выдачи ссылки
  (решение #1).
- **#3 — `bot.start()` должен явно запрашивать `allowed_updates` с `chat_member`.** Telegram Bot
  API не включает `chat_member` в дефолтный набор апдейтов при long polling — без явного списка
  хендлер никогда не вызовется. Список должен включать существующие типы (`message`,
  `callback_query`) плюс `chat_member`.
- **#4 — результат транзакции webhook получает флаг `freshlyProcessed: boolean`.** Повторный
  идемпотентный POST (`updated.count === 0`, но `existing.status === PAID`) → `freshlyProcessed:
  false`; действия после коммита (invite-ссылка, уведомления) выполняются только при `true`.
- **#5 — invite-ссылки не хранятся в БД и не отзываются.** Каждая ссылка — новая,
  `member_limit:1`; при повторных запросах старые неиспользованные ссылки остаются валидными,
  но бесполезны без явной передачи третьим лицам (риск принят для v1, без миграции схемы).
- **#6 — текст уведомления админам об оплате ветвится по продукту.** `SUBSCRIPTION` — «оплата
  от @user, сумма, срок до {expiresAt}»; `LIFETIME` — «оплата от @user, сумма, бессрочный
  доступ в общую группу». Уведомление о вступлении — отдельным текстом, с указанием группы.
- **#7 — Telegram-вызовы после оплаты выполняются после коммита транзакции, best-effort**, без
  auto-retry; сбой логируется и уходит отдельным алертом админам через `notifyAdmins` (решение
  от 2026-07-05, перенесено без изменений).

## Таски

### Task 5.1 — `services/notify.ts`: рассылка админам с троттлингом

- **Статус:** ✅ Готово (2026-07-05)
- **Workspace:** bot
- **Цель:** переиспользуемый механизм рассылки: троттлинг ≤25 msg/sec, ошибки одного получателя
  (403 и другие) логируются и не прерывают рассылку остальным; готов для уведомления об оплате
  (эта фаза) и напоминаний пользователям (Фаза 7) без изменений сигнатуры.
- **Файлы:** `apps/bot/src/services/notify.ts`, `apps/bot/test/notify.test.ts`
- **Out of scope:** рассылка пользователям (Фаза 7), вызов `notifyAdmins` из webhook (Task 5.2),
  retry
- **DoD:** см. `TASK.md` (перенесён из чернового `phase-5-task-notify.md`)

### Task 5.2 — Webhook: `freshlyProcessed` + выдача доступа после оплаты

- **Статус:** ✅ Готово (2026-07-05)
- **Workspace:** bot
- **Цель:** транзакция webhook возвращает `freshlyProcessed`; после коммита (только если
  `true`, best-effort) — создание одноразовой invite-ссылки в группу по продукту платежа,
  отправка её пользователю, `notifyAdmins` с текстом по продукту (решение #6).
- **Файлы:** `apps/bot/src/payments/webhook.ts`, `apps/bot/src/services/subscription.ts`
  (функция выдачи доступа: invite-ссылка + отправка), `apps/bot/src/bot/bot.ts` (экспорт/доступ
  к `bot.api` из webhook-модуля)
- **Out of scope:** `chat_member`-хендлер (Task 5.3), повторная выдача без оплаты (Task 5.4)
- **DoD:**
  - [x] повторный POST по уже `PAID` платежу → `freshlyProcessed: false`, ссылка/уведомления не
        повторяются
  - [x] первичная оплата `SUBSCRIPTION` → invite-ссылка (`member_limit:1`) в `GROUP_ID`,
        отправлена пользователю, `notifyAdmins` с текстом «срок до …»
  - [x] первичная оплата `LIFETIME` → invite-ссылка в `COMMON_GROUP_ID`, `notifyAdmins` с
        текстом «бессрочный доступ»
  - [x] сбой Telegram-вызова (invite-ссылка/отправка) логируется, не влияет на уже отданный
        `OK{InvId}`, дублирующий алерт админам уходит

### Task 5.3 — `chat_member`: вступление/выход в обеих группах

- **Статус:** ✅ Готово (2026-07-05)
- **Workspace:** bot
- **Цель:** хендлер различает группу по `chat.id` и обновляет `inGroup` (`User` для закрытой,
  `CommonAccess` для общей) на join и left/kicked, не трогая `User.status`; join —
  уведомление админам о вступлении (решение #2, #3, #6).
- **Файлы:** `apps/bot/src/bot/bot.ts` (регистрация хендлера), `apps/bot/src/bot/handlers/chatMember.ts`
  (новый), `apps/bot/src/index.ts` (`bot.start({ allowed_updates: [...] })`),
  `apps/bot/src/services/subscription.ts` (хелперы обновления `inGroup`)
- **Out of scope:** обработка `UserStatus.LEFT`, кик замьюченных
- **DoD:**
  - [x] join в `GROUP_ID` (переход `left`/`kicked` → `member`) → `User.inGroup=true`, `status` не
        изменён; `notifyAdmins` (вступление, закрытая группа)
  - [x] join в `COMMON_GROUP_ID` (тот же переход) → `CommonAccess.inGroup=true`; `notifyAdmins`
        (вступление, общая группа)
  - [x] переход в `member` без предшествующего `left`/`kicked` (например, `restricted` → `member`
        при unmute) → `inGroup=true` обновляется, но `notifyAdmins` не вызывается
  - [x] `left`/`kicked` в любой из групп → соответствующий `inGroup=false`, без уведомления
  - [x] апдейт с неизвестным `chat.id` игнорируется без падения
  - [x] `bot.start()` явно передаёт `allowed_updates` с `chat_member` (через
        `API_CONSTANTS.DEFAULT_UPDATE_TYPES`)

### Task 5.4 — Повторная выдача ссылки в общую группу без оплаты

- **Статус:** ✅ Готово (2026-07-05)
- **Workspace:** bot
- **Цель:** `/start` для пользователя с `CommonAccess` и `inGroup=false` показывает кнопку
  «Получить ссылку снова»; клик создаёт новую одноразовую ссылку в `COMMON_GROUP_ID` без
  создания `Payment` (решение #1).
- **Файлы:** `apps/bot/src/bot/handlers/start.ts`, `apps/bot/src/bot/keyboards.ts`,
  `apps/bot/src/services/subscription.ts`, `apps/bot/src/bot/bot.ts`, `apps/bot/test/start.test.ts`
- **Out of scope:** аналогичный флоу для закрытой группы (его нет — решение #1)
- **DoD:**
  - [x] `CommonAccess` + `inGroup=true` → только сообщение «доступ уже оплачен», без кнопки
        (регрессия текущего поведения отсутствует)
  - [x] `CommonAccess` + `inGroup=false` → кнопка «Получить ссылку снова» есть; клик выдаёт
        новую одноразовую ссылку, `Payment` не создаётся
  - [x] пользователь без `CommonAccess` — поведение как в Фазе 4, без изменений
  - [x] повторный клик при `inGroup=true` на момент клика — «доступ уже активен», ссылка не
        создаётся (race condition)
  - [x] сбой Telegram API — лог + сообщение пользователю, без необработанного исключения

### Task 5.5 — Тесты сквозного сценария + ручная проверка

- **Статус:** ✅ Готово — автотесты ✅ (2026-07-05), ручная проверка ожидает
- **Workspace:** bot
- **Цель:** автотесты на весь новый функционал (Task 5.2–5.4) + ручная проверка полного happy
  path в Telegram (DoD фазы).
- **Файлы:** `apps/bot/test/webhook.test.ts`, `apps/bot/test/subscription.test.ts`,
  `apps/bot/test/start.test.ts`
- **Out of scope:** e2e с реальной Робокассой (уже покрыто ручной проверкой Фазы 3);
  `chatMember.test.ts` / `notify.test.ts` — уже покрывают DoD своих тасков
- **DoD:**
  - [x] `start.test.ts`: кнопка «Получить ссылку снова» при `paid_not_in_group`
  - [x] `start.test.ts`: `handleResendAccessCallback` — нет доступа / `inGroup=true` / `inGroup=false` /
        сбой сервиса
  - [x] `subscription.test.ts`: `grantAccessAfterPayment` — SUBSCRIPTION и LIFETIME
  - [x] `subscription.test.ts`: `resendCommonAccessInviteLink` — `COMMON_GROUP_ID`, текст без «Оплата
        прошла успешно»
  - [x] `webhook.test.ts`: сбой `createChatInviteLink` и `sendMessage` после коммита → `OK{InvId}`,
        лог + алерт админам
  - [ ] ручная проверка: `/start` → оплата (тест, `IsTest=1`) → ссылка → вступил → админам
        пришли 2 уведомления (оплата + вступление); повторное использование ссылки Telegram
        отклоняет — для обеих групп
  - [x] `npm test`, `npm run type-check`, `npm run lint` — чисто

## DoD фазы (из phases.md)

- [ ] полный happy path для обеих групп: `/start` → оплата (тест) → ссылка → вступил → админам
      пришли 2 уведомления
- [ ] ссылка второй раз не работает
- [ ] Все таски ✅, PR `phase-5` → `dev` создан после подтверждения

## Итоги

_(заполняется при закрытии: что отклонилось от плана, тех. долг, дата, PR)_
