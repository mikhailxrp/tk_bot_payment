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

  let admin;
  try {
    admin = await prisma.admin.findUnique({
      where: { telegramId },
    });
  } catch (err) {
    logger.error(
      { err, telegramId: telegramId.toString() },
      'isAdmin db check failed',
    );
    await ctx.reply(ACCESS_CHECK_FAILED_MESSAGE);
    return;
  }

  if (!admin) {
    await ctx.reply(ACCESS_DENIED_MESSAGE);
    return;
  }

  await next();
}

export async function isBotAdmin(telegramId: bigint): Promise<boolean> {
  try {
    const admin = await prisma.admin.findUnique({ where: { telegramId } });
    return admin !== null;
  } catch (err) {
    logger.error({ err, telegramId: telegramId.toString() }, 'isBotAdmin db check failed');
    return false;
  }
}
