import { prisma } from '@tg-bot/db';
import type { Context, NextFunction } from 'grammy';

import { logger } from '../../logger.js';

const ACCESS_DENIED_MESSAGE = 'У вас нет прав для выполнения этой команды.';

const ACCESS_CHECK_FAILED_MESSAGE =
  'Не удалось проверить права доступа. Попробуйте позже.';

export async function isAdmin(ctx: Context, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply(ACCESS_DENIED_MESSAGE);
    return;
  }

  const telegramId = BigInt(from.id);

  try {
    const admin = await prisma.admin.findUnique({
      where: { telegramId },
    });

    if (!admin) {
      await ctx.reply(ACCESS_DENIED_MESSAGE);
      return;
    }

    await next();
  } catch (err) {
    logger.error(
      { err, telegramId: telegramId.toString() },
      'isAdmin db check failed',
    );
    await ctx.reply(ACCESS_CHECK_FAILED_MESSAGE);
  }
}
