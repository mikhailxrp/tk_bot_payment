import type { Payment } from '@tg-bot/db';
import { prisma, ProductType, UserStatus } from '@tg-bot/db';
import type { Prisma } from '@prisma/client';

import { bot } from '../bot/bot.js';
import { config } from '../config.js';
import { formatOutSum } from '../payments/robokassa.js';
import { notifyAdmins } from './notify.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

export async function applyPayment(
  tx: Prisma.TransactionClient,
  payment: Payment,
  now: Date,
  periodDays: number,
): Promise<Date> {
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

  return expiresAt;
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

export async function grantAccessAfterPayment(
  params: GrantAccessAfterPaymentParams,
): Promise<void> {
  const groupId = resolveGroupId(params.product);

  const invite = await bot.api.createChatInviteLink(groupId.toString(), {
    member_limit: 1,
  });

  const userMessage = buildUserInviteMessage(params.product, invite.invite_link);
  await bot.api.sendMessage(params.userId.toString(), userMessage);

  const adminMessage = buildAdminPaymentNotification(params);
  await notifyAdmins(bot, adminMessage);
}

export async function resendCommonAccessInviteLink(userId: bigint): Promise<void> {
  const invite = await bot.api.createChatInviteLink(config.COMMON_GROUP_ID.toString(), {
    member_limit: 1,
  });

  const userMessage = RESEND_INVITE_LINK_USER_MESSAGE.replace('{link}', invite.invite_link);
  await bot.api.sendMessage(userId.toString(), userMessage);
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
