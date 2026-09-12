import { prisma, UserStatus } from '@tg-bot/db';

import { getMoscowCalendarDate, getMoscowCalendarDateKey, lastNMoscowDateKeys } from '../moscowDate';

export async function getDAU(reference: Date = new Date()): Promise<number> {
  const dateKey = getMoscowCalendarDateKey(reference);
  // One GroupActivity row per user per day (composite PK), so a plain count is already distinct.
  return prisma.groupActivity.count({ where: { date: dateKey } });
}

export async function getWAU(reference: Date = new Date()): Promise<number> {
  const keys = lastNMoscowDateKeys(7, reference);
  const start = keys[0];
  const end = keys[keys.length - 1];

  const rows = await prisma.groupActivity.findMany({
    where: { date: { gte: start, lte: end } },
    select: { userId: true },
    distinct: ['userId'],
  });

  return rows.length;
}

export type MessagesSeriesPoint = { date: string; count: number };

export async function getMessagesSeries(
  days = 30,
  now: Date = new Date(),
): Promise<MessagesSeriesPoint[]> {
  const keys = lastNMoscowDateKeys(days, now);
  const start = keys[0];
  const end = keys[keys.length - 1];

  const rows = await prisma.groupActivity.groupBy({
    by: ['date'],
    where: { date: { gte: start, lte: end } },
    _sum: { messageCount: true },
  });

  const byDate = new Map(
    rows.map((row) => [getMoscowCalendarDate(row.date), row._sum.messageCount ?? 0]),
  );

  return keys.map((key) => {
    const dateStr = getMoscowCalendarDate(key);
    return { date: dateStr, count: byDate.get(dateStr) ?? 0 };
  });
}

export type TopActiveUser = { userId: string; username: string | null; messageCount: number };

export async function getTopActiveUsers(
  limit = 10,
  days = 30,
  now: Date = new Date(),
): Promise<TopActiveUser[]> {
  const keys = lastNMoscowDateKeys(days, now);
  const start = keys[0];
  const end = keys[keys.length - 1];

  const grouped = await prisma.groupActivity.groupBy({
    by: ['userId'],
    where: { date: { gte: start, lte: end } },
    _sum: { messageCount: true },
    orderBy: { _sum: { messageCount: 'desc' } },
    take: limit,
  });

  const userIds = grouped.map((row) => row.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true },
  });
  const usernameById = new Map(users.map((user) => [user.id.toString(), user.username]));

  return grouped.map((row) => ({
    userId: row.userId.toString(),
    username: usernameById.get(row.userId.toString()) ?? null,
    messageCount: row._sum.messageCount ?? 0,
  }));
}

export type SilentShare = { activeTotal: number; silent: number; rate: number };

/** Share of currently ACTIVE subscribers with zero group messages in the last 7 days. */
export async function getSilentActiveShare(now: Date = new Date()): Promise<SilentShare> {
  const activeTotal = await prisma.user.count({ where: { status: UserStatus.ACTIVE } });
  if (activeTotal === 0) {
    return { activeTotal: 0, silent: 0, rate: 0 };
  }

  const keys = lastNMoscowDateKeys(7, now);
  const start = keys[0];
  const end = keys[keys.length - 1];

  const activeWithActivity = await prisma.groupActivity.findMany({
    where: {
      date: { gte: start, lte: end },
      user: { status: UserStatus.ACTIVE },
    },
    select: { userId: true },
    distinct: ['userId'],
  });

  const silent = activeTotal - activeWithActivity.length;
  return { activeTotal, silent, rate: silent / activeTotal };
}
