import { PaymentStatus, ProductType, prisma } from '@tg-bot/db';
import type { Context } from 'grammy';

import { logger } from '../../logger.js';
import { buildPaymentUrl, formatOutSum } from '../../payments/robokassa.js';
import { resendCommonAccessInviteLink } from '../../services/subscription.js';
import {
  type CommonAccessUiState,
  paymentKeyboard,
  productChoiceKeyboard,
} from '../keyboards.js';

const WELCOME_MESSAGE =
  'Добро пожаловать! Выберите группу для оформления доступа.';

const COMMON_ACCESS_PAID_MESSAGE = 'Доступ в общую группу уже оплачен.';

const PAYMENT_SUCCESS_MESSAGE =
  'Оплата прошла успешно! Подписка будет активирована автоматически — обычно это занимает несколько секунд.';

const PAYMENT_FAIL_MESSAGE =
  'Оплата не была завершена. Нажмите /start и попробуйте оформить подписку снова.';

const PRICE_UNAVAILABLE_MESSAGE =
  'Стоимость подписки временно недоступна. Попробуйте позже.';

const COMMON_PRICE_UNAVAILABLE_MESSAGE =
  'Стоимость доступа в общую группу временно недоступна. Попробуйте позже.';

const COMMON_ACCESS_ALREADY_PAID_MESSAGE = 'Доступ в общую группу уже оплачен.';

const COMMON_ACCESS_ALREADY_ACTIVE_MESSAGE = 'Доступ в общую группу уже активен.';

const RESEND_LINK_ERROR_MESSAGE =
  'Не удалось создать ссылку для вступления. Попробуйте позже или обратитесь к администратору.';

const COMMON_ACCESS_DESCRIPTION = 'Разовый доступ в общую группу';

const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;
const PERIOD_DAYS_PATTERN = /^\d+$/;

function formatSubscriptionMessage(amount: string): string {
  return `Стоимость подписки: ${amount} ₽\n\nНажмите «Оплатить» для продолжения.`;
}

function formatCommonAccessMessage(amount: string): string {
  return `Стоимость доступа: ${amount} ₽\n\nНажмите «Оплатить» для продолжения.`;
}

export async function handleStart(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) {
    return;
  }

  const payload = ctx.match;
  if (payload === 'paid') {
    await ctx.reply(PAYMENT_SUCCESS_MESSAGE);
    return;
  }
  if (payload === 'fail') {
    await ctx.reply(PAYMENT_FAIL_MESSAGE);
    return;
  }

  const userId = BigInt(from.id);

  await prisma.user.upsert({
    where: { id: userId },
    update: {
      username: from.username ?? null,
      firstName: from.first_name ?? null,
    },
    create: {
      id: userId,
      username: from.username ?? null,
      firstName: from.first_name ?? null,
    },
  });

  const commonAccess = await prisma.commonAccess.findUnique({
    where: { userId },
  });

  const commonAccessState: CommonAccessUiState =
    commonAccess === null
      ? 'none'
      : commonAccess.inGroup
        ? 'paid_in_group'
        : 'paid_not_in_group';

  const message =
    commonAccessState === 'none'
      ? WELCOME_MESSAGE
      : `${WELCOME_MESSAGE}\n\n${COMMON_ACCESS_PAID_MESSAGE}`;

  await ctx.reply(message, {
    reply_markup: productChoiceKeyboard(commonAccessState),
  });
}

export async function handleSubscribeCallback(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();

  const from = ctx.from;
  if (!from) {
    return;
  }

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
    await ctx.reply(PRICE_UNAVAILABLE_MESSAGE);
    return;
  }

  const amount = formatOutSum(price);
  const userId = BigInt(from.id);

  const payment = await prisma.payment.create({
    data: {
      userId,
      amount,
      status: PaymentStatus.PENDING,
    },
  });

  const description = `Подписка на ${periodDays} дней`;
  const paymentUrl = buildPaymentUrl(amount, payment.id, description);
  const text = formatSubscriptionMessage(amount);
  const keyboard = paymentKeyboard(paymentUrl);

  if (ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: keyboard });
    return;
  }

  await ctx.reply(text, { reply_markup: keyboard });
}

export async function handleCommonAccessCallback(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();

  const from = ctx.from;
  if (!from) {
    return;
  }

  const userId = BigInt(from.id);

  const existingAccess = await prisma.commonAccess.findUnique({
    where: { userId },
  });
  if (existingAccess) {
    await ctx.reply(COMMON_ACCESS_ALREADY_PAID_MESSAGE);
    return;
  }

  const priceSetting = await prisma.setting.findUnique({
    where: { key: 'price_common' },
  });

  const price = priceSetting?.value;
  if (!price || !PRICE_PATTERN.test(price)) {
    await ctx.reply(COMMON_PRICE_UNAVAILABLE_MESSAGE);
    return;
  }

  const amount = formatOutSum(price);

  const payment = await prisma.payment.create({
    data: {
      userId,
      amount,
      status: PaymentStatus.PENDING,
      product: ProductType.LIFETIME,
    },
  });

  const paymentUrl = buildPaymentUrl(amount, payment.id, COMMON_ACCESS_DESCRIPTION);
  const text = formatCommonAccessMessage(amount);
  const keyboard = paymentKeyboard(paymentUrl);

  if (ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: keyboard });
    return;
  }

  await ctx.reply(text, { reply_markup: keyboard });
}

export async function handleResendAccessCallback(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();

  const from = ctx.from;
  if (!from) {
    return;
  }

  const userId = BigInt(from.id);

  const commonAccess = await prisma.commonAccess.findUnique({
    where: { userId },
  });

  if (!commonAccess || commonAccess.inGroup) {
    await ctx.reply(COMMON_ACCESS_ALREADY_ACTIVE_MESSAGE);
    return;
  }

  try {
    await resendCommonAccessInviteLink(userId);
  } catch (err) {
    logger.error({ err, userId: userId.toString() }, 'failed to resend common access invite link');
    await ctx.reply(RESEND_LINK_ERROR_MESSAGE);
  }
}
