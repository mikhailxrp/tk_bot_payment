import { Bot } from 'grammy';

import { config } from '../config.js';
import {
  handleAdmin,
  handleAdminCheckCallback,
  handleAdminSummaryCallback,
} from './handlers/admin.js';
import { handleChatMemberUpdate } from './handlers/chatMember.js';
import {
  handleCommonAccessCallback,
  handleResendAccessCallback,
  handleStart,
  handleSubscribeCallback,
} from './handlers/start.js';
import {
  ADMIN_CHECK_CALLBACK,
  ADMIN_SUMMARY_CALLBACK,
  COMMON_ACCESS_CALLBACK,
  MENU_BUTTON_TEXT,
  RESEND_ACCESS_CALLBACK,
  SUBSCRIBE_CALLBACK,
} from './keyboards.js';
import { isAdmin } from './middleware/isAdmin.js';

export const bot = new Bot(config.BOT_TOKEN);

bot.command('start', handleStart);
bot.hears(MENU_BUTTON_TEXT, handleStart);
bot.command('admin', isAdmin, handleAdmin);
bot.callbackQuery(ADMIN_CHECK_CALLBACK, isAdmin, handleAdminCheckCallback);
bot.callbackQuery(ADMIN_SUMMARY_CALLBACK, isAdmin, handleAdminSummaryCallback);
bot.callbackQuery(SUBSCRIBE_CALLBACK, handleSubscribeCallback);
bot.callbackQuery(COMMON_ACCESS_CALLBACK, handleCommonAccessCallback);
bot.callbackQuery(RESEND_ACCESS_CALLBACK, handleResendAccessCallback);
bot.on('chat_member', handleChatMemberUpdate);
