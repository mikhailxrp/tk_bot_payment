import { Bot } from 'grammy';

import { config } from '../config.js';
import { handleAdmin } from './handlers/admin.js';
import {
  handleCommonAccessCallback,
  handleStart,
  handleSubscribeCallback,
} from './handlers/start.js';
import { COMMON_ACCESS_CALLBACK, SUBSCRIBE_CALLBACK } from './keyboards.js';
import { isAdmin } from './middleware/isAdmin.js';

export const bot = new Bot(config.BOT_TOKEN);

bot.command('start', handleStart);
bot.command('admin', isAdmin, handleAdmin);
bot.callbackQuery(SUBSCRIBE_CALLBACK, handleSubscribeCallback);
bot.callbackQuery(COMMON_ACCESS_CALLBACK, handleCommonAccessCallback);
