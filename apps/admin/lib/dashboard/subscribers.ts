import { PaymentStatus, ProductType, prisma, UserStatus } from '@tg-bot/db';

export type StatusCounts = { active: number; muted: number; left: number; new: number };

export async function getStatusCounts(): Promise<StatusCounts> {
  const [active, muted, left, brandNew] = await Promise.all([
    prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
    prisma.user.count({ where: { status: UserStatus.MUTED } }),
    prisma.user.count({ where: { status: UserStatus.LEFT } }),
    prisma.user.count({ where: { status: UserStatus.NEW } }),
  ]);

  return { active, muted, left, new: brandNew };
}

/** Users whose first-ever PAID SUBSCRIPTION payment falls within [start, end]. */
export async function getNewSubscribersCount(start: Date, end: Date): Promise<number> {
  const firstPayments = await prisma.payment.groupBy({
    by: ['userId'],
    where: { status: PaymentStatus.PAID, product: ProductType.SUBSCRIPTION },
    _min: { paidAt: true },
  });

  return firstPayments.filter((row) => {
    const firstPaidAt = row._min.paidAt;
    return firstPaidAt !== null && firstPaidAt >= start && firstPaidAt <= end;
  }).length;
}

export type ConversionResult = { usersCreated: number; usersPaid: number; rate: number };

/** Share of users created in [start, end] who have made at least one PAID payment (either product), ever. */
export async function getStartToPaymentConversion(start: Date, end: Date): Promise<ConversionResult> {
  const usersCreated = await prisma.user.findMany({
    where: { createdAt: { gte: start, lte: end } },
    select: { id: true },
  });

  if (usersCreated.length === 0) {
    return { usersCreated: 0, usersPaid: 0, rate: 0 };
  }

  const ids = usersCreated.map((user) => user.id);
  const paidGroups = await prisma.payment.groupBy({
    by: ['userId'],
    where: { userId: { in: ids }, status: PaymentStatus.PAID },
  });

  const usersPaid = paidGroups.length;
  return { usersCreated: usersCreated.length, usersPaid, rate: usersPaid / usersCreated.length };
}

export type WinBackResult = { everMuted: number; wonBack: number; rate: number };

/** Among users removed for non-payment (`mutedAt` in [start, end]), how many later paid again. */
export async function getWinBackRate(start: Date, end: Date): Promise<WinBackResult> {
  const mutedUsers = await prisma.user.findMany({
    where: { mutedAt: { gte: start, lte: end } },
    select: { id: true, mutedAt: true },
  });

  if (mutedUsers.length === 0) {
    return { everMuted: 0, wonBack: 0, rate: 0 };
  }

  const ids = mutedUsers.map((user) => user.id);
  const payments = await prisma.payment.findMany({
    where: { userId: { in: ids }, status: PaymentStatus.PAID, product: ProductType.SUBSCRIPTION },
    select: { userId: true, paidAt: true },
  });

  const mutedAtByUser = new Map(
    mutedUsers.map((user) => [user.id.toString(), user.mutedAt as Date]),
  );
  const wonBackUserIds = new Set<string>();
  for (const payment of payments) {
    const mutedAt = mutedAtByUser.get(payment.userId.toString());
    if (mutedAt && payment.paidAt && payment.paidAt > mutedAt) {
      wonBackUserIds.add(payment.userId.toString());
    }
  }

  return {
    everMuted: mutedUsers.length,
    wonBack: wonBackUserIds.size,
    rate: wonBackUserIds.size / mutedUsers.length,
  };
}
