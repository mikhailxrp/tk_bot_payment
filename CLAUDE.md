# CLAUDE.md — Telegram Subscription Bot + Admin Panel

Этот файл читается при каждой сессии.
Следуй этим правилам при любой задаче.
Правила оформления кода и работы с проектом смотри тут .docs/rules/\*.mdc

## Проект

Монорепо: Telegram-бот продажи доступа в две группы через Робокассу — закрытая
(подписка 30 дней, mute вместо kick, напоминания) и общая (разовый платёж, бессрочный
доступ, без mute/напоминаний) + веб-админ-панель на Next.js (управление, статистика,
аналитика). Источник истины по требованиям — `prd.md`.

## Стек

- **Монорепо:** npm workspaces — `apps/bot`, `apps/admin`, `packages/db`
- **Bot:** Node.js 22 LTS, TypeScript (strict), ESM, grammY (+ @grammyjs/conversations), Fastify (webhook Робокассы + internal API), node-cron (Europe/Moscow), pino
- **Admin:** Next.js 15 (App Router), Auth.js v5 (credentials), Tailwind, recharts
- **БД:** реальная MySQL 8 на хостинге (без Docker/локальной установки), Prisma в `packages/db` (единая схема для обоих приложений)
- **Валидация:** zod (env, webhook, server actions)

## Команды

```bash
npm run dev -w apps/bot              # tsx watch
npm run dev -w apps/admin            # next dev
npx prisma migrate dev --name <x> -w packages/db
npx prisma studio -w packages/db
npm test                             # vitest
npm run build                        # все workspace
```

## Структура

```
apps/
  bot/src/
    index.ts            # запуск: bot + fastify + cron
    bot/
      bot.ts            # инстанс grammY, middleware (isAdmin)
      handlers/
        start.ts        # /start, кнопки подписки и оплаты
        admin.ts        # /admin: ручная проверка, сводка, ссылка на панель
      keyboards.ts
    payments/
      robokassa.ts      # ссылка + Receipt + подписи (чистые функции)
      webhook.ts        # POST /robokassa/result
    internal/
      api.ts            # POST /internal/mute|unmute (Bearer INTERNAL_API_TOKEN, вызывает панель)
    jobs/
      dailyCheck.ts     # mute истёкших + оба типа напоминаний (общая логика для cron и ручного запуска)
    services/
      subscription.ts   # продление, mute/unmute, invite-ссылки
      notify.ts         # рассылка с троттлингом, обработка 403
    config.ts           # zod-валидация .env
  admin/
    app/
      (auth)/login/
      dashboard/        # выручка, MRR, статусы, конверсия, график
      users/            # таблица + вкладка MUTED + действия
      payments/
      settings/
      admins/
    lib/actions/        # server actions (zod-валидация)
packages/
  db/
    prisma/schema.prisma
    prisma/seed.ts      # дефолтные Setting + первый админ (ADMIN_ID)
    src/index.ts        # экспорт PrismaClient
docker-compose.yml
```

## Ключевые правила проекта

1. **Источник истины оплаты — только Result URL Робокассы.** Success URL — UX-редирект, ничего не начислять.
2. **Идемпотентность webhook:** платёж уже `PAID` → ответить `OK{InvId}`, ничего не менять. Ответ на валидный webhook — строго `OK{InvId}` plain text.
3. **Подписи Робокассы (с фискализацией):**
   - ссылка: `md5(Login:OutSum:InvId:Receipt:Pass1)`, Receipt URL-encoded **один раз** в подписи и **дважды** в самой ссылке (особенность Робокассы, проверить IsTest=1);
   - webhook: `md5(OutSum:InvId:Pass2)`, Receipt не участвует, сравнение case-insensitive;
   - `OutSum` — строка с двумя знаками после точки, одинаковый формат в ссылке и подписи.
4. **Receipt обязателен** (Робокасса сама шлёт чеки): items с `payment_object: "service"`, `sno`/`tax` — из настроек/env, не хардкодить.
5. **Оплата → (продление + unmute + Payment.PAID)** — одна `prisma.$transaction`.
6. **«Блокировка» = mute:** `restrictChatMember(groupId, userId, { can_send_messages: false })`. Никогда `banChatMember`. Unmute — restrictChatMember с правами по умолчанию супергруппы.
7. **Invite-ссылки:** `createChatInviteLink({ member_limit: 1 })`, одноразовые, в момент успешной оплаты, не переиспользовать.
8. **telegram_id — BigInt** везде (id > 2^31 существуют). Помнить про BigInt при JSON-сериализации (панель!).
9. **Продление:** активная → `expiresAt + 30d`; истёкшая → `now + 30d`. При оплате сбрасывать `reminderSentAt` и `lastMutedRemindAt`.
10. **Два типа напоминаний в dailyCheck:** активным — за 3 дня, один раз (`reminderSentAt`); замьюченным — каждые `muted_remind_days` (10) дней (`lastMutedRemindAt`), до оплаты.
11. **Рассылки** — только через `services/notify.ts`: ≤ 25 msg/sec, 403 логировать и продолжать.
12. **Настройки читать из таблицы `Setting` при каждом использовании**, не кэшировать — панель меняет их на лету.
13. **Панель → Telegram:** mute/unmute из панели идёт через internal API бота (`Bearer INTERNAL_API_TOKEN`), панель не вызывает Telegram API напрямую и не дублирует токен бота.
14. **Auth панели:** Auth.js credentials, bcrypt для `passwordHash`, доступ только для записей `Admin` с email. Все server actions валидировать zod и проверять сессию.
15. Секреты только через `config.ts` (zod), падать на старте при невалидном env.
16. **Два продукта (`Payment.product`):** `SUBSCRIPTION` — закрытая группа, подписка;
    `LIFETIME` — общая группа (`COMMON_GROUP_ID`), разовый платёж, бессрочно. LIFETIME-оплата
    пишет `CommonAccess` и **не трогает** `expiresAt`/`status`/флаги напоминаний; cron, mute
    и напоминания применяются только к закрытой группе. Ветвление по продукту — внутри той же
    транзакции webhook.

## Git workflow

- Ветки: `phase-N` → PR в `dev` → PR в `main`
- Conventional commits, кратко: `feat: robokassa receipt`, `fix: mute timezone`
- Перед созданием PR — спросить подтверждение

## Тестирование

- Unit: обе подписи Робокассы (включая Receipt-кодирование), расчёт продления, выборки cron (граничные даты, оба типа напоминаний)
- Интеграция: webhook с валидной/невалидной подписью, повторный webhook (идемпотентность), internal API с/без токена
- Telegram API мокать; Робокасса — `IsTest=1`

## Стиль ответов

- Общение — на русском; код, коммиты — на английском
- Перед реализацией фазы — краткий план, потом код
