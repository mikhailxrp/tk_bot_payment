import type { Payment } from '@tg-bot/db';
import { UserStatus } from '@tg-bot/db';
import type { Prisma } from '@prisma/client';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type UserForExtension = {
  status: UserStatus;
  expiresAt: Date | null;
};

export function calculateNewExpiresAt(
  user: UserForExtension,
  now: Date,
  periodDays: number,
): Date {
  const periodMs = periodDays * MS_PER_DAY;

  if (user.expiresAt !== null && user.expiresAt > now) {
    return new Date(user.expiresAt.getTime() + periodMs);
  }

  return new Date(now.getTime() + periodMs);
}

export async function applyPayment(
  tx: Prisma.TransactionClient,
  payment: Payment,
  now: Date,
  periodDays: number,
): Promise<void> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: payment.userId },
    select: { status: true, expiresAt: true },
  });
  const expiresAt = calculateNewExpiresAt(user, now, periodDays);

  await tx.user.update({
    where: { id: payment.userId },
    data: {
      expiresAt,
      status: UserStatus.ACTIVE,
      reminderSentAt: null,
      lastMutedRemindAt: null,
    },
  });
}
