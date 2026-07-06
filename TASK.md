# TASK: `jobs/dailyCheck.ts` — mute истёкших + сообщение с оплатой + сводка админам

## Фаза

Phase 6 — Ежедневный cron: mute истёкших (только закрытая группа)

## Статус

🔄 В работе

## Цель

Общая функция `runDailyCheck()`, которую одинаково смогут вызывать cron и ручная кнопка
`/admin` (обвязка — Task 6.3, здесь функция вызывается напрямую из тестов): находит
пользователей закрытой группы с истёкшей подпиской (`status=ACTIVE`, `expiresAt < now`),
мьютит их (`restrictChatMember`, никогда `banChatMember`), переводит в `MUTED`, шлёт личное
сообщение с кнопкой оплаты и сводку админам. Функция сама защищена от конкурентного запуска
через MySQL `GET_LOCK`/`RELEASE_LOCK`.

## Что нужно создать/изменить

- `apps/bot/src/jobs/dailyCheck.ts` (bot, новый) — `runDailyCheck()`:
  - `GET_LOCK('daily_check', 0)` (неблокирующий) → работа → `RELEASE_LOCK` в `finally`, всё
    в одном `prisma.$transaction`, чтобы acquire/release шли на одном соединении; при
    `GET_LOCK=0` — лог и выход без обработки строк
  - выборка кандидатов: `User` где `status=ACTIVE AND expiresAt < now`
  - на каждого — атомарный per-user guard (`updateMany` с условием `status=ACTIVE AND
    expiresAt < now` в `where`), и только при `count===1` — `restrictChatMember` без
    `until_date`, отправка личного сообщения с кнопкой «Оплатить»
  - сбор результатов → `notifyAdmins` сводкой (сколько замьючено + упоминания через
    `formatUserMention`), отправляется всегда, включая `N=0`
- `apps/bot/src/services/subscription.ts` (bot, изменить):
  - вынести общую функцию создания `Payment(PENDING, product=SUBSCRIPTION)` +
    `buildPaymentUrl` (сейчас захардкожена внутри `handleSubscribeCallback` в `start.ts`),
    переиспользуемую `start.ts` и `dailyCheck.ts`
  - добавить функцию мьюта одного пользователя: атомарный DB-guard (`updateMany`) +
    `restrictChatMember(config.GROUP_ID.toString(), userId.toString(), { can_send_messages:
    false })`, возвращает признак, был ли пользователь реально замьючен этим вызовом
- `apps/bot/src/bot/handlers/start.ts` (bot, изменить) — `handleSubscribeCallback`
  переключается на вынесенный общий хелпер создания `Payment`+ссылки; поведение и текст не
  меняются (регрессии нет)
- `apps/bot/test/dailyCheck.test.ts` (bot, новый) — покрытие `runDailyCheck()` целиком
- `apps/bot/test/subscription.test.ts` (bot, изменить) — тесты на вынесенные хелперы

## Out of scope

- Напоминания активным/замьюченным (Фаза 7) — `reminderSentAt`/`lastMutedRemindAt` этим
  таском не читаются и не пишутся
- Unmute при оплате (Task 6.2)
- Реальный планировщик (`node-cron`) и кнопки `/admin` — «Проверить подписки», «Сводка»,
  «Панель» (Task 6.3); в этом таске `runDailyCheck()` только определяется и тестируется
  прямым вызовом
- Поведение при рестарте процесса во время удержания `GET_LOCK` (вне скоупа v1)
- Изменение Prisma-схемы — не требуется, `UserStatus.MUTED`/`mutedAt` есть с Фазы 1

## ⚠️ Точки риска при реализации

- **`GET_LOCK`/`RELEASE_LOCK` обязаны выполниться на одном соединении MySQL.** Если вызвать
  их как два независимых top-level запроса Prisma, пул соединений может отдать разные
  сессии — `RELEASE_LOCK` тогда вернёт `0`/`NULL` и не снимет чужой лок. Обязательно
  оборачивать acquire+работу+release в один `prisma.$transaction`; release — строго в
  `finally`, иначе лок «протекает» до закрытия соединения.
- **TOCTOU между выборкой и записью.** Наивные `findMany` → цикл `restrictChatMember` +
  отдельный `update` выглядят рабочими, но пользователь может оплатить между select и write
  (гонка с webhook). Нужен атомарный per-user `updateMany({ where: { id, status: 'ACTIVE',
  expiresAt: { lt: now } }, data: {...} })` с проверкой `count===1` перед звонком в Telegram
  — иначе можно замьютить того, кто уже оплатил секунду назад.
- **Не указывать `until_date` в `restrictChatMember`.** По умолчанию ограничение бессрочно;
  скопированный пример Bot API с фиксированной длительностью («замьютить на 24 часа»)
  автоматически снял бы mute раньше оплаты — а mute должен держаться до explicit unmute
  (Task 6.2).
- **Сбой Telegram-вызова на одном пользователе не должен прерывать цикл для остальных.**
  DB-статус `MUTED` уже закоммичен атомарным `updateMany` до звонка в Telegram —
  `restrictChatMember`/`sendMessage` вызываются best-effort, ошибка логируется на конкретного
  пользователя (аналог паттерна best-effort из Фазы 5), обработка остальных продолжается.
- **BigInt → `.toString()` на каждом новом вызове Telegram API** (`restrictChatMember`,
  `sendMessage`) — по аналогии с существующими вызовами в `subscription.ts`; забытый
  `.toString()` на новом call site — частая мелкая ошибка.
- **Рефакторинг `handleSubscribeCallback`** не должен изменить его текущее поведение —
  существующие тесты в `start.test.ts` должны остаться зелёными без изменений.
- **Сводка админам должна уйти всегда, включая `N=0`.** Ранний `return` на пустой выборке
  («нечего делать — просто выходим») молча пропустит уведомление админам о том, что проверка
  вообще прошла.

## Definition of Done

- [x] Конкурентный вызов `runDailyCheck()` (два параллельных вызова в тесте) — второй получает
      `GET_LOCK=0`, завершается без обработки строк, с логом; `RELEASE_LOCK` вызывается всегда,
      включая ветку с ошибкой внутри транзакции
- [x] `ACTIVE` + `expiresAt < now` → `restrictChatMember(can_send_messages:false)`,
      `status=MUTED`, `mutedAt` проставлен
- [x] Граница: `expiresAt === now` → мьютится; `expiresAt = now + 1с` → не трогается
- [x] Пользователь только с `CommonAccess` (без активной `SUBSCRIPTION`) не затрагивается
      никогда
- [x] Уже `MUTED`/`NEW`/`LEFT` — повторно не обрабатывается; повторный запуск в тот же день
      идемпотентен
- [x] Мьют реализован через атомарный `updateMany`-guard, а не «прочитал → проверил → записал»
- [x] Сбой отдельного Telegram-вызова (`restrictChatMember`/`sendMessage`) на одном юзере
      логируется и не прерывает обработку остальных
- [x] Каждому замьюченному — личное сообщение с кнопкой «Оплатить» на новый
      `Payment(PENDING, SUBSCRIPTION)` + реальную Робокасса-ссылку
- [x] `notifyAdmins` — сводка «замьючено N» + упоминания (`formatUserMention`), отправляется
      всегда, включая `N=0`
- [x] `handleSubscribeCallback` после рефакторинга ведёт себя как раньше (существующие тесты
      зелёные — `start.test.ts` адаптирован под новый мок `createSubscriptionPaymentLink`,
      поведение и покрытие не изменились, см. «Итоги»)
- [x] TypeScript компилируется без ошибок, `any` нет
- [x] Проверить `.docs/prompts/dod-global.md`: «TypeScript»; «Telegram API» (mute =
      `restrictChatMember`, не `banChatMember`; 403 не роняет цикл); «Cron / конкурентность»
      (`GET_LOCK`/`RELEASE_LOCK`, атомарный guard, граничные даты покрыты тестом); «Данные»
      (`Setting` читается без кэша, миграция не нужна); «Код» (lint/build чисто)

## Итоги

- Граница мьюта реализована как `expiresAt <= now` (`lte`), а не строгое `<`: DoD явно требует
  мьютить пользователя с `expiresAt === now`, что со строгим `lt` невозможно. Формулировка
  «expiresAt < now» в теле таска — неточный пересказ; реализация ориентируется на явный
  список граничных случаев в DoD.
- `handleSubscribeCallback` теперь вызывает `createSubscriptionPaymentLink` из
  `subscription.ts`. Поскольку `start.test.ts` мокает весь модуль `subscription.js`
  (`vi.mock('../src/services/subscription.js', () => ({...}))`), добавление вызова в новый
  экспорт неизбежно требовало добавить его в мок — «без изменений» из риск-секции было
  невозможно выполнить буквально. Тест адаптирован: тот же сценарий (успешная ссылка / недоступная
  цена) проверяется через мок хелпера вместо прямых `prisma.payment.create`/`buildPaymentUrl`
  моков; поведение и покрытие не изменились.
- `muteExpiredUser` не пробрасывает ошибку `restrictChatMember` — она логируется внутри
  функции, а признак «замьючен» остаётся `true`, поскольку атомарный DB-guard уже закоммитил
  `MUTED` в транзакции. Это позволяет `dailyCheck.ts` корректно учитывать пользователя в
  сводке админам и пытаться отправить платёжное сообщение независимо от исхода
  `restrictChatMember`.
- `restrictChatMember`'s `user_id` — `number`, не `string` (в отличие от `chat_id` у grammY);
  `Number(userId)` вместо `.toString()` на этом конкретном call site.
