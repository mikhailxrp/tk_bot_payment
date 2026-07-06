import { prisma, UserStatus } from '@tg-bot/db';
import type { Prisma } from '@prisma/client';

import { subscriptionBot } from '../bot/bot.js';
import { paymentKeyboard } from '../bot/keyboards.js';
import { logger } from '../logger.js';
import {
  notifyAdmins,
  sendThrottledPersonalMessages,
  type PersonalMessage,
} from '../services/notify.js';
import {
  buildActiveReminderMessage,
  buildMutedReminderMessage,
  createSubscriptionPaymentLink,
  formatUserMention,
  muteExpiredUser,
  readPositiveIntSetting,
  restrictExpiredUser,
  selectAndMarkActiveReminders,
  selectAndMarkMutedReminders,
  type ReminderCandidate,
} from '../services/subscription.js';

const DAILY_CHECK_LOCK_NAME = 'daily_check';

const EXPIRED_SUBSCRIPTION_MESSAGE =
  'Ваша подписка на закрытую группу истекла, и доступ приостановлен. Оплатите продление, чтобы снова писать в группе.';

type DailyCheckOutcome =
  | { acquired: false }
  | {
      acquired: true;
      mutedUsers: ReminderCandidate[];
      activeReminders: ReminderCandidate[];
      mutedReminders: ReminderCandidate[];
    };

async function acquireLock(tx: Prisma.TransactionClient): Promise<boolean> {
  const rows = await tx.$queryRaw<{ locked: number | bigint | null }[]>`
    SELECT GET_LOCK(${DAILY_CHECK_LOCK_NAME}, 0) AS locked
  `;

  return Number(rows[0]?.locked) === 1;
}

async function releaseLock(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT RELEASE_LOCK(${DAILY_CHECK_LOCK_NAME})`;
}

function buildSummary(
  mutedUsers: ReminderCandidate[],
  activeReminderSentCount: number,
  mutedReminderSentCount: number,
): string {
  const mutedPart =
    mutedUsers.length === 0
      ? 'замьючено 0 пользователей'
      : `замьючено ${mutedUsers.length} пользователей: ${mutedUsers
          .map((user) => formatUserMention(user.username, user.id))
          .join(', ')}`;

  return (
    `Ежедневная проверка подписок: ${mutedPart}. ` +
    `Напоминаний отправлено: активным ${activeReminderSentCount}, ` +
    `замьюченным ${mutedReminderSentCount}.`
  );
}

export async function runDailyCheck(): Promise<{ ranNow: boolean }> {
  const now = new Date();

  const [remindDays, mutedRemindDays] = await Promise.all([
    readPositiveIntSetting('remind_days'),
    readPositiveIntSetting('muted_remind_days'),
  ]);

  if (remindDays === null) {
    logger.warn(
      { key: 'remind_days' },
      'daily check: remind_days setting invalid/missing, skipping active reminders this run',
    );
  }
  if (mutedRemindDays === null) {
    logger.warn(
      { key: 'muted_remind_days' },
      'daily check: muted_remind_days setting invalid/missing, skipping muted reminders this run',
    );
  }

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

      const mutedUsers: ReminderCandidate[] = [];

      for (const candidate of candidates) {
        const wasMuted = await muteExpiredUser(tx, candidate.id, now);
        if (wasMuted) {
          mutedUsers.push(candidate);
        }
      }

      const activeReminders =
        remindDays !== null ? await selectAndMarkActiveReminders(tx, now, remindDays) : [];
      const mutedReminders =
        mutedRemindDays !== null
          ? await selectAndMarkMutedReminders(tx, now, mutedRemindDays)
          : [];

      return { acquired: true, mutedUsers, activeReminders, mutedReminders };
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

  logger.info(
    {
      activeReminders: outcome.activeReminders.length,
      mutedReminders: outcome.mutedReminders.length,
    },
    'daily check: reminder candidates selected',
  );

  // Telegram calls run after the transaction has committed — the DB guard above is already
  // the source of truth for who got muted, and network I/O here must not risk expiring the
  // transaction's lock/timeout (see muteExpiredUser's doc comment).
  const muteMessages: PersonalMessage[] = [];

  for (const candidate of outcome.mutedUsers) {
    await restrictExpiredUser(candidate.id);

    const link = await createSubscriptionPaymentLink(candidate.id);
    if (!link) {
      logger.warn(
        { userId: candidate.id.toString() },
        'daily check: subscription price/period settings unavailable, payment message not sent',
      );
      continue;
    }

    muteMessages.push({
      chatId: candidate.id,
      text: EXPIRED_SUBSCRIPTION_MESSAGE,
      reply_markup: paymentKeyboard(link.paymentUrl),
    });
  }

  await sendThrottledPersonalMessages(subscriptionBot, muteMessages);

  const activeReminderMessages: PersonalMessage[] = [];
  if (outcome.activeReminders.length > 0 && remindDays !== null) {
    const activeReminderText = buildActiveReminderMessage(remindDays);

    for (const candidate of outcome.activeReminders) {
      const link = await createSubscriptionPaymentLink(candidate.id);
      if (!link) {
        logger.warn(
          { userId: candidate.id.toString() },
          'daily check: subscription price/period settings unavailable, active reminder not sent',
        );
        continue;
      }

      activeReminderMessages.push({
        chatId: candidate.id,
        text: activeReminderText,
        reply_markup: paymentKeyboard(link.paymentUrl),
      });
    }
  }

  const activeReminderSentCount = await sendThrottledPersonalMessages(
    subscriptionBot,
    activeReminderMessages,
  );

  const mutedReminderMessages: PersonalMessage[] = [];
  if (outcome.mutedReminders.length > 0) {
    const mutedReminderText = buildMutedReminderMessage();

    for (const candidate of outcome.mutedReminders) {
      const link = await createSubscriptionPaymentLink(candidate.id);
      if (!link) {
        logger.warn(
          { userId: candidate.id.toString() },
          'daily check: subscription price/period settings unavailable, muted reminder not sent',
        );
        continue;
      }

      mutedReminderMessages.push({
        chatId: candidate.id,
        text: mutedReminderText,
        reply_markup: paymentKeyboard(link.paymentUrl),
      });
    }
  }

  const mutedReminderSentCount = await sendThrottledPersonalMessages(
    subscriptionBot,
    mutedReminderMessages,
  );

  await notifyAdmins(
    subscriptionBot,
    buildSummary(outcome.mutedUsers, activeReminderSentCount, mutedReminderSentCount),
  );
  return { ranNow: true };
}
