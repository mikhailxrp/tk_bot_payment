# TASK: apps/bot — config.ts (zod) + pino + пустой запуск

## Фаза

Phase 1 — Каркас монорепо и инфраструктура

## Статус

🔄 В работе

## Цель

После таска `npm run dev -w apps/bot` стартует пустым процессом: валидирует `.env` через zod
(падает с понятной ошибкой при невалидном/пустом env), пишет структурный pino-лог
`"bot started"`, не содержит ни grammY, ни Fastify, ни cron — только каркас config/logger/entry.

## Что нужно создать/изменить

- `apps/bot/package.json` (bot) — заменить echo-стабы `dev`/`build`: добавить зависимости
  `zod`, `pino`; devDependency `tsx`; `"dev": "tsx watch --env-file=../../.env src/index.ts"`
  (паттерн `--env-file` как в `packages/db`); `"build": "tsc"`
- `apps/bot/src/config.ts` (bot) — zod-схема всех переменных prd п.8 (`BOT_TOKEN`, `GROUP_ID`,
  `ADMIN_ID`, `ROBO_LOGIN`, `ROBO_PASS1`, `ROBO_PASS2`, `DATABASE_URL`, `ADMIN_PANEL_URL`,
  `INTERNAL_API_TOKEN`, `AUTH_SECRET`); `GROUP_ID`/`ADMIN_ID` → BigInt-коэрция с явной проверкой
  непустой строки перед `BigInt(...)`; `safeParse` на верхнем уровне модуля, при ошибке —
  читаемый вывод + `process.exit(1)`; экспорт типизированного `config`
- `apps/bot/src/logger.ts` (bot) — инстанс pino, экспорт
- `apps/bot/src/index.ts` (bot) — импорт `config` + `logger`, лог `"bot started"`, без
  grammY/Fastify/cron
- `apps/bot/tsconfig.json` (bot) — без изменений, проверить, что текущий конфиг (`rootDir: src`,
  `noEmit: true` для dev) не мешает `tsc` в `build`

## Out of scope

- grammY, Fastify, node-cron, любые хендлеры (Фазы 2+)
- `pino-pretty`/transport для форматированного вывода (DoD требует только структурный JSON-лог)
- Изменения в `README.md`
- Заполнение реальных секретных значений в `.env` (данные пользователя, не код)

## ⚠️ Точки риска при реализации

- **`z.coerce.bigint()` на пустой строке — не ошибка, а `0n`.** `BigInt("")` в JS возвращает
  `0n`, а не бросает исключение — голый `z.coerce.bigint()` пропустит пустой `GROUP_ID`/`ADMIN_ID`
  молча, и DoD «пустой `.env` → падает» не выполнится. Нужен явный `.refine()`/проверка непустой
  строки до коэрции.
- **`GROUP_ID` — отрицательное число.** ID Telegram-супергруппы имеет вид `-100xxxxxxxxxx`.
  Легко по аналогии с `ADMIN_ID` навесить `.positive()`/`.nonnegative()` на общий BigInt-тип и
  сломать валидацию реального `GROUP_ID`. Ограничение положительности применимо только к
  `ADMIN_ID`.
- **Порядок валидации.** `config.ts` должен валидировать env синхронно на верхнем уровне модуля
  (при импорте), а не внутри функции, вызываемой позже — иначе `index.ts` может успеть
  залогировать/стартовать до падения на невалидном env.
- **Загрузка `.env` для `dev`-скрипта.** У `apps/bot` нет собственного `.env` — он общий в корне.
  Без флага `--env-file=../../.env` в `package.json` (как в `packages/db`) `process.env` при
  `npm run dev -w apps/bot` окажется пустым, и валидация будет падать даже при корректном
  корневом `.env`.
- **Секреты только через `config`.** CLAUDE.md п.15: ни в `logger.ts`, ни в `index.ts` не должно
  быть прямого обращения к `process.env` — только к экспортированному объекту `config`.

## Definition of Done

- [ ] `npm run dev -w apps/bot` стартует, пишет структурный (JSON) pino-лог `"bot started"`, не
      падает
- [ ] Пустой/битый `.env` (отсутствует `BOT_TOKEN` и т.п.) → процесс падает с понятным
      zod-сообщением, а не сырым stack trace
- [ ] `GROUP_ID` (отрицательный) и `ADMIN_ID` (положительный) корректно парсятся в BigInt; пустая
      строка для любого из них не проходит валидацию молча
- [ ] Секреты доступны только через `config`, ни одного прямого обращения к `process.env` вне
      `config.ts`
- [ ] TypeScript компилируется без ошибок (`npm run type-check -w apps/bot`)
- [ ] Проверить `.docs/prompts/dod-global.md` (релевантные разделы): «TypeScript» (нет `any`,
      секреты через zod) и «Код» (секреты только через `config.ts`, невалидный env роняет старт)
