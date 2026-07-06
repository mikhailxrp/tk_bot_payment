import { Bot } from 'grammy';

import { config } from '../config.js';
import {
  handleAdmin,
  handleAdminCheckCallback,
  handleAdminSummaryCallback,
} from './handlers/admin.js';
import { handleCommonChatMemberUpdate, handleGroupChatMemberUpdate } from './handlers/chatMember.js';
import {
  handleCommonAccessCallback,
  handleCommonStart,
  handleResendAccessCallback,
  handleSubscribeCallback,
  handleSubscriptionStart,
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

/** Closed group: paid 30-day subscription, mute/unmute, reminders, admin panel. */
export const subscriptionBot = new Bot(config.BOT_TOKEN);

/** Common group ("KORDON Transfer"): one-time payment, lifetime access, no admin panel. */
export const commonBot = new Bot(config.COMMON_BOT_TOKEN);

subscriptionBot.command('start', handleSubscriptionStart);
subscriptionBot.hears(MENU_BUTTON_TEXT, handleSubscriptionStart);
subscriptionBot.command('admin', isAdmin, handleAdmin);
subscriptionBot.callbackQuery(ADMIN_CHECK_CALLBACK, isAdmin, handleAdminCheckCallback);
subscriptionBot.callbackQuery(ADMIN_SUMMARY_CALLBACK, isAdmin, handleAdminSummaryCallback);
subscriptionBot.callbackQuery(SUBSCRIBE_CALLBACK, handleSubscribeCallback);
subscriptionBot.on('chat_member', handleGroupChatMemberUpdate);

commonBot.command('start', handleCommonStart);
commonBot.hears(MENU_BUTTON_TEXT, handleCommonStart);
commonBot.callbackQuery(COMMON_ACCESS_CALLBACK, handleCommonAccessCallback);
commonBot.callbackQuery(RESEND_ACCESS_CALLBACK, handleResendAccessCallback);
commonBot.on('chat_member', handleCommonChatMemberUpdate);
