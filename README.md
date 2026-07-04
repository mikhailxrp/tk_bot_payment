# Telegram Subscription Bot + Admin Panel

Монорепо: Telegram-бот платной подписки и веб-админ-панель (Next.js).
Подробности — `prd.md`, правила разработки — `CLAUDE.md`.

## Требования

- Node.js 22 LTS
- npm (workspaces)
- Доступ к реальной MySQL 8 базе на хостинге (см. ниже) — локальная MySQL/Docker не используются

## Быстрый старт

```bash
npm install
cp .env.example .env   # если .env ещё нет
# заполните .env, включая DATABASE_URL (см. раздел «Подключение к БД»)
```

## Подключение к БД

БД не поднимается локально и не запускается в Docker: используется реальная MySQL-база на
хостинге. База и пользователь для проекта уже созданы — нужно только указать корректный
`DATABASE_URL` в `.env`.

1. Укажите `DATABASE_URL` в `.env` в формате:

```
DATABASE_URL=mysql://USER:PASSWORD@HOST:PORT/DATABASE
```

Значения (`USER`, `PASSWORD`, `HOST`, `PORT`, `DATABASE`) выдаёт хостинг-провайдер.

2. Проверьте подключение (без Prisma):

```bash
mysql -u <user> -p -h <host> -P <port> <database> -e "SELECT 1;"
```

Ожидаемый вывод: таблица с колонкой `1` и значением `1`.

Если подключение не проходит — сначала проверьте на стороне хостинга доступ по IP/whitelist
и требование SSL, а не только саму строку подключения.

3. Проверьте кодировку базы (должна быть `utf8mb4_unicode_ci`):

```bash
mysql -u <user> -p -h <host> -P <port> -e "SHOW CREATE DATABASE <database>;"
```

Если кодировка отличается — согласуйте изменение с хостинг-провайдером до создания таблиц
(Task 1.3), иначе эмодзи/юзернеймы в сообщениях будут повреждены.

### Переменные окружения

Полный список — в `.env.example`. Минимум для этого этапа — рабочий `DATABASE_URL`.
Остальные переменные (`BOT_TOKEN`, `ROBO_*` и т.д.) понадобятся в следующих тасках.

## Команды

```bash
npm run type-check                # проверка TypeScript
npm run lint                      # ESLint
npm run format:check              # Prettier
```

Миграции Prisma и запуск приложений появятся в тасках 1.3–1.5.
