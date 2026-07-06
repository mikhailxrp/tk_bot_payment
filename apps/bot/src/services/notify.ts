import { prisma } from '@tg-bot/db';
import { Bot, GrammyError, HttpError, type InlineKeyboard } from 'grammy';

import { logger } from '../logger.js';

export const MAX_MESSAGES_PER_SECOND = 25;
export const THROTTLE_INTERVAL_MS = Math.ceil(1000 / MAX_MESSAGES_PER_SECOND);

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export type SendThrottledTextMessagesOptions = {
  delay?: (ms: number) => Promise<void>;
};

export type PersonalMessage = {
  chatId: bigint;
  text: string;
  reply_markup?: InlineKeyboard;
};

export type SendThrottledPersonalMessagesOptions = {
  delay?: (ms: number) => Promise<void>;
};

function formatChatId(chatId: bigint): string {
  return chatId.toString();
}

function logSendError(chatId: bigint, err: unknown): void {
  const chatIdStr = formatChatId(chatId);

  if (err instanceof GrammyError) {
    logger.warn(
      {
        chatId: chatIdStr,
        error_code: err.error_code,
        description: err.description,
      },
      'Failed to send throttled message',
    );
    return;
  }

  if (err instanceof HttpError) {
    logger.warn(
      { chatId: chatIdStr, message: err.message },
      'Failed to send throttled message',
    );
    return;
  }

  logger.warn(
    {
      chatId: chatIdStr,
      err: err instanceof Error ? err.message : String(err),
    },
    'Failed to send throttled message',
  );
}

export async function sendThrottledPersonalMessages(
  bot: Bot,
  items: readonly PersonalMessage[],
  options: SendThrottledPersonalMessagesOptions = {},
): Promise<number> {
  const delayFn = options.delay ?? defaultDelay;
  let successCount = 0;

  for (let i = 0; i < items.length; i += 1) {
    if (i > 0) {
      await delayFn(THROTTLE_INTERVAL_MS);
    }

    const item = items[i]!;
    const chatIdStr = formatChatId(item.chatId);

    try {
      await bot.api.sendMessage(
        chatIdStr,
        item.text,
        item.reply_markup !== undefined ? { reply_markup: item.reply_markup } : undefined,
      );
      successCount += 1;
    } catch (err) {
      logSendError(item.chatId, err);
    }
  }

  return successCount;
}

export async function sendThrottledTextMessages(
  bot: Bot,
  chatIds: readonly bigint[],
  text: string,
  options: SendThrottledTextMessagesOptions = {},
): Promise<void> {
  const delayFn = options.delay ?? defaultDelay;

  for (let i = 0; i < chatIds.length; i += 1) {
    if (i > 0) {
      await delayFn(THROTTLE_INTERVAL_MS);
    }

    const chatId = chatIds[i]!;
    const chatIdStr = formatChatId(chatId);

    try {
      await bot.api.sendMessage(chatIdStr, text);
    } catch (err) {
      logSendError(chatId, err);
    }
  }
}

export async function notifyAdmins(bot: Bot, text: string): Promise<void> {
  const admins = await prisma.admin.findMany({
    select: { telegramId: true },
  });

  const chatIds = admins.map((admin) => admin.telegramId);
  await sendThrottledTextMessages(bot, chatIds, text);
}
