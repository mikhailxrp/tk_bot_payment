import { PaymentStatus, prisma } from '@tg-bot/db';
import type { Context } from 'grammy';

import { buildPaymentUrl, formatOutSum } from '../../payments/robokassa.js';
import { paymentKeyboard, subscribeKeyboard } from '../keyboards.js';

const WELCOME_MESSAGE =
  'Добро пожаловать! Здесь вы можете оформить подписку на закрытую группу.';

const PAYMENT_SUCCESS_MESSAGE =
  'Оплата прошла успешно! Подписка будет активирована автоматически — обычно это занимает несколько секунд.';

const PAYMENT_FAIL_MESSAGE =
  'Оплата не была завершена. Нажмите /start и попробуйте оформить подписку снова.';

const PRICE_UNAVAILABLE_MESSAGE =
  'Стоимость подписки временно недоступна. Попробуйте позже.';

const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;
const PERIOD_DAYS_PATTERN = /^\d+$/;

function formatSubscriptionMessage(amount: string): string {
  return `Стоимость подписки: ${amount} ₽\n\nНажмите «Оплатить» для продолжения.`;
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

  await ctx.reply(WELCOME_MESSAGE, {
    reply_markup: subscribeKeyboard(),
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
