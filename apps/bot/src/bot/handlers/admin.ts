import { PaymentStatus, prisma, UserStatus } from '@tg-bot/db';
import type { Context } from 'grammy';

import { config } from '../../config.js';
import { runDailyCheck } from '../../jobs/dailyCheck.js';
import { getMoscowDayBounds } from '../../util/moscowDate.js';
import { adminKeyboard } from '../keyboards.js';

const ADMIN_MENU_MESSAGE = 'Админ-панель бота: выберите действие.';

const CHECK_DONE_MESSAGE = '✅ Проверка подписок выполнена.';
const CHECK_SKIPPED_MESSAGE =
  '⏳ Проверка уже выполняется другим процессом. Запуск пропущен.';

export async function handleAdmin(ctx: Context): Promise<void> {
  await ctx.reply(ADMIN_MENU_MESSAGE, {
    reply_markup: adminKeyboard(config.ADMIN_PANEL_URL),
  });
}

export async function handleAdminCheckCallback(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();
  const { ranNow } = await runDailyCheck();
  await ctx.reply(ranNow ? CHECK_DONE_MESSAGE : CHECK_SKIPPED_MESSAGE);
}

export async function handleAdminSummaryCallback(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();

  const { start, end } = getMoscowDayBounds();

  const [activeCount, mutedCount, paymentsToday] = await Promise.all([
    prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
    prisma.user.count({ where: { status: UserStatus.MUTED } }),
    prisma.payment.count({
      where: {
        status: PaymentStatus.PAID,
        paidAt: { gte: start, lte: end },
      },
    }),
  ]);

  await ctx.reply(
    `📊 Сводка:\n` +
      `• Активных подписок: ${activeCount}\n` +
      `• Замьюченных: ${mutedCount}\n` +
      `• Оплат за сегодня: ${paymentsToday}`,
  );
}
