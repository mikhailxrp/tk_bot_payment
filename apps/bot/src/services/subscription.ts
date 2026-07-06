import type { Payment } from '@tg-bot/db';
import { prisma, ProductType, PaymentStatus, UserStatus } from '@tg-bot/db';
import type { Prisma } from '@prisma/client';

import { commonBot, subscriptionBot } from '../bot/bot.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { buildPaymentUrl, formatOutSum } from '../payments/robokassa.js';
import { notifyAdmins } from './notify.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;
const PERIOD_DAYS_PATTERN = /^\d+$/;

const INVITE_LINK_USER_MESSAGE_SUBSCRIPTION =
  'Оплата прошла успешно! Перейдите по ссылке для вступления в закрытую группу:\n\n{link}';

const INVITE_LINK_USER_MESSAGE_LIFETIME =
  'Оплата прошла успешно! Перейдите по ссылке для вступления в общую группу:\n\n{link}';

const RESEND_INVITE_LINK_USER_MESSAGE =
  'Ваша ссылка для вступления в общую группу:\n\n{link}';

export type GrantAccessAfterPaymentParams = {
  userId: bigint;
  product: ProductType;
  amount: Payment['amount'];
  username: string | null;
  expiresAt?: Date;
  wasMuted: boolean;
};

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

export type ApplyPaymentResult = {
  expiresAt: Date;
  wasMuted: boolean;
};

export async function applyPayment(
  tx: Prisma.TransactionClient,
  payment: Payment,
  now: Date,
  periodDays: number,
): Promise<ApplyPaymentResult> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: payment.userId },
    select: { status: true, expiresAt: true },
  });
  const wasMuted = user.status === UserStatus.MUTED;
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

  return { expiresAt, wasMuted };
}

export async function unmuteUserAfterPayment(userId: bigint): Promise<boolean> {
  try {
    const chat = await subscriptionBot.api.getChat(config.GROUP_ID.toString());
    if (!chat.permissions) {
      throw new Error('Group chat permissions are unavailable');
    }

    await subscriptionBot.api.restrictChatMember(
      config.GROUP_ID.toString(),
      Number(userId),
      chat.permissions,
    );
    return true;
  } catch (err) {
    logger.error(
      { err, userId: userId.toString() },
      'payment: failed to unmute user after payment',
    );
    return false;
  }
}

export async function readPositiveIntSetting(key: string): Promise<number | null> {
  const setting = await prisma.setting.findUnique({ where: { key } });
  const value = setting?.value;

  if (!value || !PERIOD_DAYS_PATTERN.test(value) || Number(value) <= 0) {
    return null;
  }

  return Number(value);
}

export type SubscriptionPaymentLink = {
  paymentUrl: string;
  amount: string;
  periodDays: string;
};

export async function createSubscriptionPaymentLink(
  userId: bigint,
): Promise<SubscriptionPaymentLink | null> {
  const [priceSetting, periodDaysSetting] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'price' } }),
    prisma.setting.findUnique({ where: { key: 'period_days' } }),
  ]);

  const price = priceSetting?.value;
  const periodDays = periodDaysSetting?.value;
  if (
    !price ||
    !PRICE_PATTERN.test(price) ||
    !periodDays ||
    !PERIOD_DAYS_PATTERN.test(periodDays) ||
    Number(periodDays) <= 0
  ) {
    return null;
  }

  const amount = formatOutSum(price);
  const payment = await prisma.payment.create({
    data: {
      userId,
      amount,
      status: PaymentStatus.PENDING,
    },
  });

  const description = `Подписка на ${periodDays} дней`;
  const paymentUrl = buildPaymentUrl(amount, payment.id, description);

  return { paymentUrl, amount, periodDays };
}

/**
 * Atomic per-user guard against the ACTIVE+expired condition. DB-only by design: this must
 * stay fast, since it runs inside the daily-check transaction alongside the GET_LOCK, which
 * has a 5s interactive-transaction timeout. Telegram calls belong outside that transaction
 * (see `restrictExpiredUser`) — putting network I/O in here previously caused the transaction
 * to time out and roll back committed MUTED rows while the Telegram-side mute had already
 * taken effect, desyncing DB state from reality.
 */
export async function muteExpiredUser(
  tx: Prisma.TransactionClient,
  userId: bigint,
  now: Date,
): Promise<boolean> {
  const updated = await tx.user.updateMany({
    where: { id: userId, status: UserStatus.ACTIVE, expiresAt: { lte: now } },
    data: { status: UserStatus.MUTED, mutedAt: now },
  });

  return updated.count === 1;
}

export type ReminderCandidate = {
  id: bigint;
  username: string | null;
};

/**
 * Same atomic-guard shape as `muteExpiredUser`: select candidates, then re-check the full
 * guard condition per id in `updateMany`'s `where`. A plain `updateMany({ where: { id: { in } } })`
 * would not re-verify status/expiresAt/flag at write time, so a concurrent payment transaction
 * committing between the select and the write (a different GET_LOCK domain) could still get
 * marked/reminded here.
 */
export async function selectAndMarkActiveReminders(
  tx: Prisma.TransactionClient,
  now: Date,
  remindDays: number,
): Promise<ReminderCandidate[]> {
  const windowEnd = new Date(now.getTime() + remindDays * MS_PER_DAY);
  const guard: Prisma.UserWhereInput = {
    status: UserStatus.ACTIVE,
    expiresAt: { gt: now, lte: windowEnd },
    reminderSentAt: null,
  };

  const candidates = await tx.user.findMany({
    where: guard,
    select: { id: true, username: true },
  });

  const marked: ReminderCandidate[] = [];

  for (const candidate of candidates) {
    const updated = await tx.user.updateMany({
      where: { ...guard, id: candidate.id },
      data: { reminderSentAt: now },
    });

    if (updated.count === 1) {
      marked.push(candidate);
    }
  }

  return marked;
}

function buildMutedReminderDueGuard(now: Date, mutedRemindDays: number): Prisma.UserWhereInput {
  const threshold = new Date(now.getTime() - mutedRemindDays * MS_PER_DAY);

  return {
    status: UserStatus.MUTED,
    OR: [
      { lastMutedRemindAt: null, mutedAt: { lte: threshold } },
      { lastMutedRemindAt: { lte: threshold } },
    ],
  };
}

export async function selectAndMarkMutedReminders(
  tx: Prisma.TransactionClient,
  now: Date,
  mutedRemindDays: number,
): Promise<ReminderCandidate[]> {
  const guard = buildMutedReminderDueGuard(now, mutedRemindDays);

  const candidates = await tx.user.findMany({
    where: guard,
    select: { id: true, username: true },
  });

  const marked: ReminderCandidate[] = [];

  for (const candidate of candidates) {
    const updated = await tx.user.updateMany({
      where: { ...guard, id: candidate.id },
      data: { lastMutedRemindAt: now },
    });

    if (updated.count === 1) {
      marked.push(candidate);
    }
  }

  return marked;
}

export async function restrictExpiredUser(userId: bigint): Promise<boolean> {
  try {
    await subscriptionBot.api.restrictChatMember(config.GROUP_ID.toString(), Number(userId), {
      can_send_messages: false,
    });
    return true;
  } catch (err) {
    logger.error({ err, userId: userId.toString() }, 'daily check: failed to restrictChatMember');
    return false;
  }
}

export function formatUserMention(username: string | null, userId: bigint): string {
  if (username) {
    return `@${username}`;
  }

  return `id:${userId.toString()}`;
}

function formatExpiresAt(date: Date): string {
  return date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

export function buildActiveReminderMessage(remindDays: number): string {
  return `Ваша подписка на закрытую группу истекает через ${remindDays} дн. Оплатите продление, чтобы не потерять доступ.`;
}

export function buildMutedReminderMessage(): string {
  return 'Доступ к закрытой группе всё ещё ограничен из-за неоплаченной подписки. Оплатите, чтобы восстановить доступ.';
}

function resolveGroupId(product: ProductType): bigint {
  if (product === ProductType.LIFETIME) {
    return config.COMMON_GROUP_ID;
  }

  return config.GROUP_ID;
}

function buildUserInviteMessage(product: ProductType, inviteLink: string): string {
  const template =
    product === ProductType.LIFETIME
      ? INVITE_LINK_USER_MESSAGE_LIFETIME
      : INVITE_LINK_USER_MESSAGE_SUBSCRIPTION;

  return template.replace('{link}', inviteLink);
}

function buildAdminPaymentNotification(params: GrantAccessAfterPaymentParams): string {
  const user = formatUserMention(params.username, params.userId);
  const sum = formatOutSum(params.amount.toString());

  if (params.product === ProductType.LIFETIME) {
    return `Оплата от ${user}, ${sum} ₽, бессрочный доступ в общую группу`;
  }

  if (!params.expiresAt) {
    throw new Error('expiresAt is required for SUBSCRIPTION payment notification');
  }

  return `Оплата от ${user}, ${sum} ₽, срок до ${formatExpiresAt(params.expiresAt)}`;
}

function resolveBotForProduct(product: ProductType) {
  return product === ProductType.LIFETIME ? commonBot : subscriptionBot;
}

export async function grantAccessAfterPayment(
  params: GrantAccessAfterPaymentParams,
): Promise<void> {
  const groupId = resolveGroupId(params.product);
  const targetBot = resolveBotForProduct(params.product);

  const invite = await targetBot.api.createChatInviteLink(groupId.toString(), {
    member_limit: 1,
  });

  const userMessage = buildUserInviteMessage(params.product, invite.invite_link);
  await targetBot.api.sendMessage(params.userId.toString(), userMessage);

  const adminMessage = buildAdminPaymentNotification(params);
  await notifyAdmins(targetBot, adminMessage);
}

export async function resendCommonAccessInviteLink(userId: bigint): Promise<void> {
  const invite = await commonBot.api.createChatInviteLink(config.COMMON_GROUP_ID.toString(), {
    member_limit: 1,
  });

  const userMessage = RESEND_INVITE_LINK_USER_MESSAGE.replace('{link}', invite.invite_link);
  await commonBot.api.sendMessage(userId.toString(), userMessage);
}

export async function setUserInGroup(userId: bigint, inGroup: boolean): Promise<void> {
  await prisma.user.updateMany({
    where: { id: userId },
    data: { inGroup },
  });
}

export async function setCommonAccessInGroup(userId: bigint, inGroup: boolean): Promise<void> {
  await prisma.commonAccess.updateMany({
    where: { userId },
    data: { inGroup },
  });
}

export async function applyCommonAccess(
  tx: Prisma.TransactionClient,
  payment: Payment,
  now: Date,
): Promise<void> {
  await tx.commonAccess.upsert({
    where: { userId: payment.userId },
    create: { userId: payment.userId, paidAt: now },
    update: { paidAt: now },
  });
}
