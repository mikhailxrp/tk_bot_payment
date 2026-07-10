import { PaymentStatus, ProductType, prisma } from '@tg-bot/db';
import type { Context } from 'grammy';

import { buildPaymentUrl, formatOutSum } from '../../payments/robokassa.js';
import { createSubscriptionPaymentLink } from '../../services/subscription.js';
import {
  type CommonAccessUiState,
  commonAccessKeyboard,
  mainReplyKeyboard,
  paymentKeyboard,
  subscriptionKeyboard,
} from '../keyboards.js';
import { isBotAdmin } from '../middleware/isAdmin.js';
import { handleAdmin } from './admin.js';

const SUBSCRIPTION_WELCOME_MESSAGE = 'Добро пожаловать! Оформите подписку на закрытую группу.';

const COMMON_WELCOME_MESSAGE =
  'Добро пожаловать! Оформите доступ в группу KORDON Transfer.';

const COMMON_ACCESS_PAID_MESSAGE = 'Доступ в общую группу уже оплачен.';

const COMMON_ACCESS_LEFT_MESSAGE =
  'Вы вышли из группы, доступ аннулирован — оплатите повторно, чтобы получить новую ссылку для вступления.';

const PAYMENT_SUCCESS_MESSAGE =
  'Оплата прошла успешно! Доступ будет активирован автоматически — обычно это занимает несколько секунд.';

const PAYMENT_FAIL_MESSAGE =
  'Оплата не была завершена. Нажмите /start и попробуйте оформить оплату снова.';

const PRICE_UNAVAILABLE_MESSAGE =
  'Стоимость подписки временно недоступна. Попробуйте позже.';

const COMMON_PRICE_UNAVAILABLE_MESSAGE =
  'Стоимость доступа в общую группу временно недоступна. Попробуйте позже.';

const COMMON_ACCESS_ALREADY_PAID_MESSAGE = 'Доступ в общую группу уже оплачен.';

const COMMON_ACCESS_DESCRIPTION = 'Разовый доступ в общую группу';

const MENU_KEYBOARD_INTRO_MESSAGE =
  'Кнопка «☰ Меню» всегда под полем ввода — нажмите её, чтобы вернуться в это меню.';

const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

function formatSubscriptionMessage(amount: string): string {
  return `Стоимость подписки: ${amount} ₽\n\nНажмите «Оплатить» для продолжения.`;
}

function formatCommonAccessMessage(amount: string): string {
  return `Стоимость доступа: ${amount} ₽\n\nНажмите «Оплатить» для продолжения.`;
}

/**
 * The User row is shared across both bots, so "first contact" can't be tracked per-bot without
 * a schema change — the intro is sent unconditionally on every /start instead (idempotent from
 * the user's point of view: Telegram just keeps the same reply keyboard pinned).
 */
async function upsertUserAndSendMenuKeyboard(ctx: Context, userId: bigint): Promise<void> {
  const from = ctx.from;
  if (!from) {
    return;
  }

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

  await ctx.reply(MENU_KEYBOARD_INTRO_MESSAGE, { reply_markup: mainReplyKeyboard() });
}

export async function handleSubscriptionStart(ctx: Context): Promise<void> {
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
  await upsertUserAndSendMenuKeyboard(ctx, userId);

  if (await isBotAdmin(userId)) {
    await handleAdmin(ctx);
    return;
  }

  await ctx.reply(SUBSCRIPTION_WELCOME_MESSAGE, {
    reply_markup: subscriptionKeyboard(),
  });
}

export async function handleCommonStart(ctx: Context): Promise<void> {
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
  await upsertUserAndSendMenuKeyboard(ctx, userId);

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
    commonAccessState === 'paid_in_group'
      ? `${COMMON_WELCOME_MESSAGE}\n\n${COMMON_ACCESS_PAID_MESSAGE}`
      : commonAccessState === 'paid_not_in_group'
        ? `${COMMON_WELCOME_MESSAGE}\n\n${COMMON_ACCESS_LEFT_MESSAGE}`
        : COMMON_WELCOME_MESSAGE;

  const keyboard = commonAccessKeyboard(commonAccessState);

  await ctx.reply(message, keyboard ? { reply_markup: keyboard } : undefined);
}

export async function handleSubscribeCallback(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();

  const from = ctx.from;
  if (!from) {
    return;
  }

  const userId = BigInt(from.id);
  const link = await createSubscriptionPaymentLink(userId);
  if (!link) {
    await ctx.reply(PRICE_UNAVAILABLE_MESSAGE);
    return;
  }

  const text = formatSubscriptionMessage(link.amount);
  const keyboard = paymentKeyboard(link.paymentUrl);

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
  if (existingAccess?.inGroup) {
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
