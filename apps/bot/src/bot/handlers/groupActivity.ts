import { prisma } from '@tg-bot/db';
import type { Context } from 'grammy';

import { config } from '../../config.js';
import { logger } from '../../logger.js';
import { getMoscowCalendarDateKey } from '../../util/moscowDate.js';

export async function handleGroupActivityMessage(ctx: Context): Promise<void> {
  const chat = ctx.chat;
  const from = ctx.from;
  if (!chat || !from || from.is_bot) {
    return;
  }

  if (BigInt(chat.id) !== config.GROUP_ID) {
    return;
  }

  const date = getMoscowCalendarDateKey(new Date());
  const userId = BigInt(from.id);

  try {
    await prisma.groupActivity.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, messageCount: 1 },
      update: { messageCount: { increment: 1 } },
    });
  } catch (err) {
    logger.error(
      { err, userId: userId.toString() },
      'group activity: failed to record message',
    );
  }
}
