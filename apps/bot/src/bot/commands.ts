import type { Bot } from 'grammy';
import type { BotCommand } from 'grammy/types';

import { logger } from '../logger.js';

const PRIVATE_COMMANDS: BotCommand[] = [{ command: 'start', description: 'Запуск бота' }];

/**
 * Commands are offered in private chats only. Group scopes are explicitly emptied and the default
 * scope is deleted, so the "/" menu inside a group never suggests `/start@<bot>` — the bots do
 * control work in groups, they are not started there.
 */
export async function applyCommandScopes(bot: Bot, botName: string): Promise<void> {
  try {
    await bot.api.setMyCommands(PRIVATE_COMMANDS, { scope: { type: 'all_private_chats' } });
    await bot.api.setMyCommands([], { scope: { type: 'all_group_chats' } });
    await bot.api.setMyCommands([], { scope: { type: 'all_chat_administrators' } });
    await bot.api.deleteMyCommands();
  } catch (err) {
    logger.error({ err, bot: botName }, 'failed to apply command scopes');
  }
}
