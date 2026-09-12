import { PaymentStatus, ProductType, prisma, UserStatus } from '@tg-bot/db';

import {
  getMoscowCalendarDate,
  getMoscowDayBounds,
  getMoscowMonthBounds,
  lastNMoscowDateKeys,
} from '../moscowDate';

export type RevenueByProduct = { subscription: number; lifetime: number; total: number };

async function sumRevenue(start: Date, end: Date): Promise<RevenueByProduct> {
  const rows = await prisma.payment.groupBy({
    by: ['product'],
    where: { status: PaymentStatus.PAID, paidAt: { gte: start, lte: end } },
    _sum: { amount: true },
  });

  const subscription = Number(
    rows.find((row) => row.product === ProductType.SUBSCRIPTION)?._sum.amount ?? 0,
  );
  const lifetime = Number(
    rows.find((row) => row.product === ProductType.LIFETIME)?._sum.amount ?? 0,
  );

  return { subscription, lifetime, total: subscription + lifetime };
}

export async function getRevenueToday(now: Date = new Date()): Promise<RevenueByProduct> {
  const { start, end } = getMoscowDayBounds(now);
  return sumRevenue(start, end);
}

export async function getRevenueThisMonth(now: Date = new Date()): Promise<RevenueByProduct> {
  const { start, end } = getMoscowMonthBounds(now);
  return sumRevenue(start, end);
}

/**
 * MRR normalized to a 30-day month: (active subscribers) × price × (30 / period_days). Settings
 * are read live from `Setting`, not cached (CLAUDE.md п.12).
 */
export async function getMRR(): Promise<number> {
  const [priceSetting, periodDaysSetting, activeCount] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'price' } }),
    prisma.setting.findUnique({ where: { key: 'period_days' } }),
    prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
  ]);

  const price = Number(priceSetting?.value);
  const periodDays = Number(periodDaysSetting?.value);
  if (!Number.isFinite(price) || !Number.isFinite(periodDays) || periodDays <= 0) {
    return 0;
  }

  return activeCount * price * (30 / periodDays);
}

export type PaymentSeriesPoint = { date: string; amount: number };

export async function getPaymentsSeries(
  days = 30,
  now: Date = new Date(),
): Promise<PaymentSeriesPoint[]> {
  const dateKeys = lastNMoscowDateKeys(days, now);
  const rangeStart = dateKeys[0];
  const { start } = getMoscowDayBounds(rangeStart);
  const { end } = getMoscowDayBounds(now);

  const payments = await prisma.payment.findMany({
    where: { status: PaymentStatus.PAID, paidAt: { gte: start, lte: end } },
    select: { amount: true, paidAt: true },
  });

  const byDate = new Map<string, number>();
  for (const key of dateKeys) {
    byDate.set(getMoscowCalendarDate(key), 0);
  }
  for (const payment of payments) {
    if (!payment.paidAt) {
      continue;
    }
    const dateStr = getMoscowCalendarDate(payment.paidAt);
    byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + Number(payment.amount));
  }

  return dateKeys.map((key) => {
    const dateStr = getMoscowCalendarDate(key);
    return { date: dateStr, amount: byDate.get(dateStr) ?? 0 };
  });
}
