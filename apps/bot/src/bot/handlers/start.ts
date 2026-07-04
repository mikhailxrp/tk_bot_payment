import { prisma } from '@tg-bot/db';
import type { Context } from 'grammy';

import { paymentKeyboard, subscribeKeyboard } from '../keyboards.js';

const WELCOME_MESSAGE =
  'Добро пожаловать! Здесь вы можете оформить подписку на закрытую группу.';

const PRICE_UNAVAILABLE_MESSAGE =
  'Стоимость подписки временно недоступна. Попробуйте позже.';

const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

function formatSubscriptionMessage(amount: string): string {
  return `Стоимость подписки: ${amount} ₽\n\nНажмите «Оплатить» для продолжения.`;
}

export async function handleStart(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) {
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

  const setting = await prisma.setting.findUnique({
    where: { key: 'price' },
  });

  const amount = setting?.value;
  if (!amount || !PRICE_PATTERN.test(amount)) {
    await ctx.reply(PRICE_UNAVAILABLE_MESSAGE);
    return;
  }

  const text = formatSubscriptionMessage(amount);
  const keyboard = paymentKeyboard(amount);

  if (ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: keyboard });
    return;
  }

  await ctx.reply(text, { reply_markup: keyboard });
}
