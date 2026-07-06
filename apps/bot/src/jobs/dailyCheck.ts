import { prisma, UserStatus } from '@tg-bot/db';
import type { Prisma } from '@prisma/client';

import { subscriptionBot } from '../bot/bot.js';
import { paymentKeyboard } from '../bot/keyboards.js';
import { logger } from '../logger.js';
import { notifyAdmins } from '../services/notify.js';
import {
  createSubscriptionPaymentLink,
  formatUserMention,
  muteExpiredUser,
  restrictExpiredUser,
} from '../services/subscription.js';

const DAILY_CHECK_LOCK_NAME = 'daily_check';

const EXPIRED_SUBSCRIPTION_MESSAGE =
  'Ваша подписка на закрытую группу истекла, и доступ приостановлен. Оплатите продление, чтобы снова писать в группе.';

type DailyCheckCandidate = {
  id: bigint;
  username: string | null;
};

type DailyCheckOutcome =
  | { acquired: false }
  | { acquired: true; mutedUsers: DailyCheckCandidate[] };

async function acquireLock(tx: Prisma.TransactionClient): Promise<boolean> {
  const rows = await tx.$queryRaw<{ locked: number | bigint | null }[]>`
    SELECT GET_LOCK(${DAILY_CHECK_LOCK_NAME}, 0) AS locked
  `;

  return Number(rows[0]?.locked) === 1;
}

async function releaseLock(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT RELEASE_LOCK(${DAILY_CHECK_LOCK_NAME})`;
}

async function sendExpiredSubscriptionMessage(userId: bigint): Promise<void> {
  const link = await createSubscriptionPaymentLink(userId);
  if (!link) {
    logger.warn(
      { userId: userId.toString() },
      'daily check: subscription price/period settings unavailable, payment message not sent',
    );
    return;
  }

  await subscriptionBot.api.sendMessage(userId.toString(), EXPIRED_SUBSCRIPTION_MESSAGE, {
    reply_markup: paymentKeyboard(link.paymentUrl),
  });
}

function buildSummary(mutedUsers: DailyCheckCandidate[]): string {
  if (mutedUsers.length === 0) {
    return 'Ежедневная проверка подписок: замьючено 0 пользователей.';
  }

  const mentions = mutedUsers
    .map((user) => formatUserMention(user.username, user.id))
    .join(', ');

  return `Ежедневная проверка подписок: замьючено ${mutedUsers.length} пользователей: ${mentions}.`;
}

export async function runDailyCheck(): Promise<{ ranNow: boolean }> {
  const now = new Date();

  const outcome = await prisma.$transaction(async (tx): Promise<DailyCheckOutcome> => {
    const acquired = await acquireLock(tx);
    if (!acquired) {
      return { acquired: false };
    }

    try {
      const candidates = await tx.user.findMany({
        where: { status: UserStatus.ACTIVE, expiresAt: { lte: now } },
        select: { id: true, username: true },
      });

      const mutedUsers: DailyCheckCandidate[] = [];

      for (const candidate of candidates) {
        const wasMuted = await muteExpiredUser(tx, candidate.id, now);
        if (wasMuted) {
          mutedUsers.push(candidate);
        }
      }

      return { acquired: true, mutedUsers };
    } finally {
      await releaseLock(tx);
    }
  });

  if (!outcome.acquired) {
    logger.warn(
      { lockName: DAILY_CHECK_LOCK_NAME },
      'daily check: lock not acquired, another run is already in progress — skipping',
    );
    return { ranNow: false };
  }

  // Telegram calls run after the transaction has committed — the DB guard above is already
  // the source of truth for who got muted, and network I/O here must not risk expiring the
  // transaction's lock/timeout (see muteExpiredUser's doc comment).
  for (const candidate of outcome.mutedUsers) {
    await restrictExpiredUser(candidate.id);

    try {
      await sendExpiredSubscriptionMessage(candidate.id);
    } catch (err) {
      logger.error(
        { err, userId: candidate.id.toString() },
        'daily check: failed to send expired subscription message',
      );
    }
  }

  await notifyAdmins(subscriptionBot, buildSummary(outcome.mutedUsers));
  return { ranNow: true };
}
