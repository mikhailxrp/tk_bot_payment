# Phase 8 — Панель: каркас + auth

## Статус

✅ Готово (автотесты + сквозная проверка через curl; ждёт ручного клика `/admin` в реальном
Telegram) | Начата: 2026-09-12 | Ветка: `phase-8`

## Цель

После этой фазы `apps/admin` — работающее Next.js-приложение с единственным способом входа:
одноразовая подписанная ссылка, которую бот присылает по команде `/admin` (только реальным
`Admin.telegramId`). Без сессии любой роут ведёт на `/login`; переход по свежей ссылке создаёт
сессию Auth.js; просроченная/невалидная/чужая ссылка — отказ. Полноценного функционала панели
(пользователи/платежи/настройки) в этой фазе нет — только каркас, auth и заглушка `/dashboard`,
которую в Фазе 10 наполнят реальными метриками.

## Контекст

`apps/admin` сейчас — stub-пакет («Phase 7 lands here» — устаревшая нумерация, реально Фаза 8).
`packages/db` уже содержит `Admin { telegramId, username, email, passwordHash, addedBy,
createdAt }` — поля `email`/`passwordHash` в этой фазе не используются и не заполняются
(остаются нетронутыми в схеме на случай будущего пересмотра). Бот уже умеет проверять
`isBotAdmin(telegramId)` ([isAdmin.ts](../../apps/bot/src/bot/middleware/isAdmin.ts)) и
показывает кнопку «Ссылка на веб-панель» в `/admin` ([admin.ts](../../apps/bot/src/bot/handlers/admin.ts),
[keyboards.ts](../../apps/bot/src/bot/keyboards.ts)) — в этой фазе кнопка меняется со статичного
`ADMIN_PANEL_URL` на URL с одноразовым токеном.

**Решение (зафиксировано в `_status.md` 2026-09-12, отклонение от исходного prd.md §5):**
вместо Auth.js credentials (email+bcrypt) — вход только по одноразовой подписанной ссылке.
Механика: бот подписывает `${telegramId}.${exp}` через HMAC-SHA256 общим секретом
`AUTH_SECRET` (уже зарезервирован в `.env`/`.env.example`), получает
`${telegramId}.${exp}.${hmacHex}`, кладёт в query `?token=...` ссылки на `/login/telegram`.
Панель в `authorize()` пересчитывает HMAC (timing-safe сравнение), проверяет `exp > now` и что
`Admin.findUnique({ telegramId })` всё ещё существует — только тогда `signIn()` создаёт сессию.
TTL короткий (2 минуты — токен предполагается кликнутым сразу из Telegram). Токен без
персистентного хранения/отзыва (stateless) — если ссылка перехвачена в течение TTL, повторное
использование не блокируется; риск принят осознанно ради простоты v1 (нет отдельной БД-таблицы
токенов, нет лишней связанности бот↔панель). Если бот недоступен — входа в панель нет, других
путей логина не предусмотрено.

**Важно (Auth.js v5):** сессию создаёт только `authorize()` credentials-провайдера через
`signIn()` — кастомный route не может сам поставить cookie сессии. Клиентская страница
`/login/telegram` обязана вызвать `signIn('credentials', { token, redirect: false })`, а не
проверять токен и редиректить напрямую.

Разделы PRD: 5 (веб-панель, обновлён), 5.1 (таблица разделов), 5.2 (действия панели →
Telegram, не в этой фазе). CLAUDE.md п.14 (auth панели, обновлён).

## Таски

### Task 8.1 — Bot: генерация одноразовой ссылки входа

- **Статус:** ✅ Готово (2026-09-12)
- **Workspace:** bot
- **Цель:** чистые функции подписи токена + встраивание в `/admin`.
- **Файлы:** `apps/bot/src/services/adminAuth.ts` (новый: `buildAdminLoginToken(telegramId,
  now) => string`, TTL-константа), `apps/bot/src/config.ts` (добавить `AUTH_SECRET` в zod-схему,
  `ADMIN_PANEL_URL` уже есть), `apps/bot/src/bot/handlers/admin.ts` (строить
  `${ADMIN_PANEL_URL}/login/telegram?token=...` вместо статичного URL), `apps/bot/src/bot/keyboards.ts`
  (если нужно поменять сигнатуру `adminKeyboard`).
- **Out of scope:** проверка токена (Task 8.3, другое приложение).
- **DoD:**
  - [ ] `buildAdminLoginToken` возвращает `${telegramId}.${exp}.${hmac}`, `exp = now + TTL`,
        `hmac = HMAC-SHA256(secret, "${telegramId}.${exp}")` в hex
  - [ ] невалидный/отсутствующий `AUTH_SECRET` роняет старт бота (как остальные секреты, п.15
        CLAUDE.md)
  - [ ] `/admin` присылает кнопку со свежим токеном при каждом вызове (не кэшируется)

### Task 8.2 — Admin: каркас Next.js 15 + Tailwind

- **Статус:** ✅ Готово (2026-09-12)
- **Workspace:** admin
- **Цель:** живое Next.js App Router приложение вместо stub-пакета, подключённое к
  `@tg-bot/db`.
- **Файлы:** `apps/admin/package.json`, `apps/admin/next.config.ts`, `apps/admin/tsconfig.json`,
  `apps/admin/postcss.config.mjs`, `apps/admin/app/layout.tsx`, `apps/admin/app/globals.css`
  (Tailwind v4, `@import 'tailwindcss'`, без отдельного `tailwind.config.ts`),
  `apps/admin/app/dashboard/page.tsx` (заглушка — контент в Фазе 10).
- **Out of scope:** сам дашборд/метрики (Фаза 10), auth (Task 8.3).
- **DoD:**
  - [x] `npm run dev -w apps/admin` поднимает Next.js без ошибок
  - [x] `npm run build -w apps/admin` собирается
  - [x] `@tg-bot/db` импортируется в server-компоненте без ошибок типов
  - **Отклонение от плана:** TypeScript в этом workspace закреплён на `^5` (собственный
    `apps/admin/node_modules/typescript`, отдельно от `^6.0.3` в корне) — Next.js 15.5.25 не
    распознаёт CSS side-effect импорты под TS 6, `next build` падал с "Cannot find module ...
    globals.css". Также: `@next/env`/`loadEnvConfig` пришлось вызывать с `forceReload: true` в
    `apps/admin/lib/config.ts` (не только в `next.config.ts`) — `next dev` однопроцессный и уже
    дергает `loadEnvConfig` сам для (несуществующих) `.env` приложения; без `forceReload` кеш
    `@next/env` не давал перечитать корневой `.env`.

### Task 8.3 — Admin: Auth.js v5 (проверка токена) + guard всех роутов

- **Статус:** ✅ Готово (2026-09-12)
- **Workspace:** admin
- **Цель:** Credentials-провайдер без пароля, проверяющий токен из Task 8.1; middleware-гвард;
  страницы `/login` и `/login/telegram`.
- **Файлы:** `apps/admin/auth.config.ts` (Edge-safe часть конфига — без `node:crypto`/Prisma,
  используется в middleware), `apps/admin/auth.ts` (полный конфиг + credentials provider),
  `apps/admin/lib/verifyAdminLoginToken.ts`, `apps/admin/lib/config.ts` (zod-валидация env),
  `apps/admin/middleware.ts`, `apps/admin/app/login/page.tsx`,
  `apps/admin/app/login/telegram/page.tsx`, `apps/admin/app/api/auth/[...nextauth]/route.ts`.
- **Out of scope:** email/пароль-логин (не реализуется, см. решение выше), CRUD админов (Фаза 9).
- **DoD:**
  - [x] валидный свежий токен → сессия создаётся, редирект на `/dashboard` (проверено curl:
        полный `csrf → callback/credentials → session` цикл с реальным `AUTH_SECRET`/`ADMIN_ID`)
  - [x] просроченный токен (`exp < now`) → отказ (покрыто unit-тестом `verifyAdminLoginToken`)
  - [x] токен с неверной подписью (подделанный `telegramId`/`exp`) → отказ (curl: изменённый
        последний символ подписи → `CredentialsSignin`, `session=null`)
  - [x] `telegramId` из валидного токена отсутствует в `Admin` (удалён) → отказ (curl:
        корректно подписанный токен для несуществующего `telegramId` → `CredentialsSignin`)
  - [x] без сессии любой роут (`/dashboard` и другие) → редирект на `/login` (curl: `/` и
        `/dashboard` без cookie → 307 на `/login?callbackUrl=...`)
  - [x] сессию создаёт только `authorize()` через `signIn()` — `middleware.ts` использует
        Edge-safe `auth.config.ts` без providers, полный провайдер только в `auth.ts`
  - **Важное отклонение:** `middleware.ts` не может импортировать `auth.ts` напрямую — оно
    бандлится для Edge runtime, а `verifyAdminLoginToken.ts` использует `node:crypto`
    (webpack: `UnhandledSchemeError` на `node:crypto`). Решение — официальный паттерн Auth.js
    v5: `auth.config.ts` (без providers, только `pages`/`session`/`callbacks.authorized`) отдельно
    от `auth.ts` (полный конфиг с `Credentials`); `middleware.ts` собирает свой `NextAuth(authConfig)`
    только ради Edge-safe `auth`.

### Task 8.4 — Тесты + ручная проверка

- **Статус:** 🔄 Автотесты и сквозная проверка через curl готовы; ждёт ручного клика в Telegram
- **Workspace:** bot, admin
- **Цель:** автотесты на подпись/проверку токена с обеих сторон + ручная сквозная проверка.
- **Файлы:** `apps/bot/test/adminAuth.test.ts`, `apps/admin/test/verifyAdminLoginToken.test.ts`,
  `vitest.config.ts` (расширен `include` на `apps/admin/test/**`).
- **Out of scope:** e2e в реальном браузере автоматизированно — только ручная проверка.
- **DoD:**
  - [x] `npm test` (150 тестов), `npm run type-check`, `npm run lint` — чисто по всему монорепо
        (единственная lint-ошибка — `apps/bot/test/routing.test.ts:40`, не связана с этой фазой,
        существовала до неё)
  - [x] сквозная проверка полного цикла воспроизведена через curl (реальный `AUTH_SECRET`/`ADMIN_ID`
        из `.env`, реальная БД): валидный токен → сессия → `/dashboard` с живыми данными
        («Активных подписок: 25»); подделанная подпись, несуществующий `telegramId` → отказ
  - [ ] ручная проверка: `/admin` в Telegram → переход по ссылке → попал в `/dashboard`-заглушку
  - [ ] ручная проверка: та же ссылка повторно после истечения TTL → отказ
  - [ ] ручная проверка: временно удалить себя из `Admin` (Prisma Studio) → свежая ссылка → отказ

## DoD фазы (из phases.md)

- [x] без сессии любой роут → `/login`
- [x] переход по свежей ссылке из `/admin` создаёт сессию
- [x] просроченная/невалидная подпись — отказ
- [x] удалённый из `Admin` не может войти по старой ссылке
- [ ] Все таски ✅ (осталась ручная проверка в реальном Telegram), PR `phase-8` → `dev` создан
      после подтверждения

## Итоги

Реализовано полностью по плану, с двумя техническими отклонениями (см. Task 8.2/8.3):
локальный `typescript@^5` для `apps/admin` (несовместимость Next 15.5.25 с TS 6 на CSS-импортах)
и разделение `auth.config.ts`/`auth.ts` (Edge-совместимость middleware). Функциональность
проверена end-to-end через curl с реальными `AUTH_SECRET`/`ADMIN_ID`/БД вместо моков — все
сценарии (успех, просрочка, подделка, несуществующий админ, guard без сессии) подтверждены.
Осталась только ручная проверка непосредственно через Telegram-клиент (открыть `/admin` у
реального бота) — не выполнялась в этой сессии, т.к. требует живого запущенного бота.

