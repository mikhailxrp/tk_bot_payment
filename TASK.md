# TASK: Планировщик (node-cron) + `/admin`: проверка, сводка, ссылка на панель

## Фаза

Phase 6 — Ежедневный cron: mute истёкших (только закрытая группа)

## Статус

🔄 В работе

## Цель

`node-cron` тикает раз в минуту (`* * * * *`, `timezone: 'Europe/Moscow'`), сверяет
`Setting.cron_time` (без кэша) и раз в календарный день (по МСК) вызывает `runDailyCheck()`.
`/admin` перестаёт быть заглушкой и получает все три функции PRD §4: «🔄 Проверить подписки»
(ручной запуск той же логики, что и cron, с явным ответом — выполнено или пропущено из-за
конкурентного запуска), «📊 Сводка» (активные/замьюченные/оплаты за сегодня, без кэша), «🔗
Панель» (url-кнопка на `ADMIN_PANEL_URL`).

`runDailyCheck()` (Task 6.1) меняет сигнатуру `Promise<void>` → `Promise<{ ranNow: boolean }>`,
чтобы кнопка «Проверить подписки» могла различить два исхода — решение принято при проверке
документации перед стартом таска (иначе успешный запуск и пропуск из-за `GET_LOCK` неотличимы
для вызывающего кода).

## Что нужно создать/изменить

- `apps/bot/package.json` (bot) — добавить зависимости `node-cron`, `@types/node-cron`
- `apps/bot/src/util/moscowDate.ts` (bot, новый) — общий helper для Europe/Moscow:
  календарная дата (`YYYY-MM-DD`) для day-guard планировщика, границы суток (`start`/`end`)
  для подсчёта «оплат за сегодня», сравнение текущего `HH:mm` (МСК) с `Setting.cron_time`.
  Единая точка вычисления «сегодня», чтобы планировщик и сводка не разъехались по логике
- `apps/bot/src/jobs/dailyCheck.ts` (bot, изменить) — `runDailyCheck()`:
  `Promise<void>` → `Promise<{ ranNow: boolean }>` (`ranNow: false` при непойманном
  `GET_LOCK`, `ranNow: true` после успешной обработки и `notifyAdmins`)
- `apps/bot/src/jobs/scheduler.ts` (bot, новый) — `cron.schedule('* * * * *', tick, {
  timezone: 'Europe/Moscow' })`; на каждом тике читает `Setting.cron_time` из БД (без кэша),
  через `moscowDate`-helper сравнивает с текущим `HH:mm` (МСК); guard «не чаще раза в
  календарный день» — в памяти хранится дата (МСК) последнего запуска; при совпадении и не
  запущенном сегодня — вызывает `runDailyCheck()`; malformed `cron_time` (не `HH:mm`) —
  `logger.warn`, тик пропускается без падения процесса
- `apps/bot/src/index.ts` (bot, изменить) — запуск планировщика рядом с `fastify.listen`/
  `bot.start()`
- `apps/bot/src/bot/keyboards.ts` (bot, изменить) — новые константы
  `ADMIN_CHECK_CALLBACK`, `ADMIN_SUMMARY_CALLBACK`; `adminKeyboard(panelUrl: string):
  InlineKeyboard` — «🔄 Проверить подписки», «📊 Сводка» (callback-кнопки), «🔗 Панель»
  (url-кнопка)
- `apps/bot/src/bot/handlers/admin.ts` (bot, изменить, заменить заглушку):
  - `handleAdmin` — шлёт `adminKeyboard(config.ADMIN_PANEL_URL)`
  - `handleAdminCheckCallback` — `ctx.answerCallbackQuery()` → `runDailyCheck()` → ответ по
    `ranNow` (`true` — «проверка выполнена»/`false` — «проверка уже выполняется другим
    процессом, пропущено»), тексты явно различаются
  - `handleAdminSummaryCallback` — `ctx.answerCallbackQuery()` → считает через `prisma`
    (без кэша `Setting`): `User.count({status: ACTIVE})`, `User.count({status: MUTED})`,
    `Payment.count({status: PAID, paidAt: {в границах суток МСК через moscowDate}})` → ответ
    одним сообщением
- `apps/bot/src/bot/bot.ts` (bot, изменить) — `bot.callbackQuery(ADMIN_CHECK_CALLBACK,
  isAdmin, handleAdminCheckCallback)`, `bot.callbackQuery(ADMIN_SUMMARY_CALLBACK, isAdmin,
  handleAdminSummaryCallback)` — `isAdmin` обязателен в цепочке каждого нового callback,
  т.к. `bot.callbackQuery` регистрируется отдельно от `bot.command('admin', isAdmin, ...)`
- `apps/bot/test/dailyCheck.test.ts` (bot, изменить) — обновить единственный assert на новый
  возврат: `expect(second).toBeUndefined()` → `expect(second).toEqual({ ranNow: false })`;
  добавить проверку `{ ranNow: true }` на успешном пути
- `apps/bot/test/scheduler.test.ts` (bot, новый) — тик совпадает с `cron_time` → запуск один
  раз; повторный тик в ту же минуту/день — не запускает повторно; смена `cron_time` между
  тиками подхватывается без рестарта; malformed `cron_time` не роняет тик; граница
  полуночи МСК (day-guard считает по МСК, не по UTC)
- `apps/bot/test/admin.test.ts` (bot, новый) — не-админ получает отказ на оба новых callback;
  «Проверить подписки» — `ranNow: true`/`false` → разные тексты ответа; «Сводка» — корректные
  счётчики без кэша, границы «сегодня» по МСК; «Панель» — url-кнопка на `ADMIN_PANEL_URL`

## Out of scope

- Напоминания активным/замьюченным (Фаза 7)
- Сама логика мьюта и unmute при оплате (Task 6.1–6.2, уже готовы, не меняются кроме
  сигнатуры `runDailyCheck()`)
- Веб-панель (Next.js), server actions (Фазы 8–10)
- Изменение Prisma-схемы (`Setting.cron_time` уже существует, миграция не нужна)
- Кик замьюченных дольше N дней (открытый вопрос PRD п.11)
- Retry/reschedule планировщика при падении процесса (рестарт — задача PM2/деплоя)

## ⚠️ Точки риска при реализации

- **Границы календарного дня — строго Europe/Moscow, не UTC/локаль сервера.**
  `new Date().toISOString().slice(0,10)` или `setHours(0,0,0,0)` без явного `timeZone` дадут
  неверную границу суток около полуночи МСК на проде (сервер, вероятно, в UTC) — day-guard
  планировщика либо пропустит день, либо запустит дважды; «оплаты за сегодня» посчитаются по
  неверному окну. Оба места обязаны использовать один и тот же `moscowDate`-helper.
- **`isAdmin` — отдельно для каждого нового `bot.callbackQuery`.** Существующий
  `bot.command('admin', isAdmin, handleAdmin)` не защищает новые callback-кнопки — это
  отдельная регистрация в `bot.ts`. Без явного `isAdmin` в цепочке любой, кто узнает
  `callback_data` (форвард сообщения, инспектор клиента), сможет вызвать `runDailyCheck()`
  или получить сводку без проверки прав.
- **Смена сигнатуры `runDailyCheck()` — единственная точка риска регрессии в уже закрытом
  Task 6.1.** Меняется только тип возврата и одна строка `return` на успешном пути; вся
  остальная логика (лок, mute, сообщения, сводка админам) не трогается. Нужно поправить
  именно один существующий assert в `dailyCheck.test.ts`, не переписывать остальные 10 тестов.
- **Malformed `Setting.cron_time`.** Значение читается как сырая строка без zod-схемы; если в
  БД окажется не `HH:mm` (ручная правка в Prisma Studio), парсинг обязан не падать —
  `logger.warn` + пропуск тика, а не необработанное исключение, которое уронит процесс бота.
- **Рестарт процесса теряет in-memory day-guard.** Если бот перезапустится в ту же минуту,
  что и `cron_time`, возможен повторный вызов `runDailyCheck()` в тот же день — не баг (сам
  `runDailyCheck()` идемпотентен по данным), но лишняя сводка «замьючено 0» уйдёт админам;
  не пытаться «чинить» персистентным guard — вне скоупа таска.
- **Текст ответа на «Проверить подписки» должен явно различать исходы.** Одинаковый текст для
  `ranNow: true` и `ranNow: false` вводит админа в заблуждение — он не поймёт, что проверка не
  выполнилась из-за конкурентного запуска.

## Definition of Done

- [ ] Тик, где текущее `HH:mm` (Europe/Moscow) совпадает с `Setting.cron_time`, запускает
      `runDailyCheck()` один раз; повторные тики в ту же минуту/день — не запускают повторно
- [ ] Day-guard и подсчёт «оплат за сегодня» используют календарные сутки Europe/Moscow
      (тест на границу полуночи МСК)
- [ ] Смена `Setting.cron_time` между тиками подхватывается без рестарта процесса
- [ ] Malformed `cron_time` не роняет процесс — лог `warn`, тик пропущен
- [ ] `/admin` доступен только через `isAdmin`; то же самое явно проверено для обоих новых
      callback-хендлеров (не-админ получает отказ на callback, не только на команду)
- [ ] «Проверить подписки»: обычный запуск → ответ с результатом (`ranNow: true`);
      конкурентный запуск во время другого запуска → отдельное сообщение о пропуске
      (`ranNow: false`), текст не совпадает с успешным ответом
- [ ] «Сводка» показывает актуальные активные/замьюченные/оплаты-за-сегодня без кэша
- [ ] «Панель» — рабочая url-кнопка на `ADMIN_PANEL_URL`
- [ ] `runDailyCheck()` возвращает `{ ranNow: boolean }`; обновлённый тест на конкурентный
      вызов проходит, остальные тесты `dailyCheck.test.ts` не сломаны
- [ ] TypeScript компилируется без ошибок (`npm run type-check`), `any` нет
- [ ] `npm test`, `npm run lint` — чисто
- [ ] Проверить `.docs/prompts/dod-global.md`: «TypeScript» (явные типы возврата,
      BigInt-сериализация в сводке); «Cron / конкурентность» (таймзона явно задана, атомарный
      guard не заменяется наивным «прочитал → проверил → записал», граничные даты покрыты
      тестом); «Код» (build/lint чисто, нет warnings в dev-сервере)
