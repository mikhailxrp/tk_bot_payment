import { Bot } from 'grammy';

import { config } from '../config.js';
import {
  handleAdmin,
  handleAdminCheckCallback,
  handleAdminSummaryCallback,
} from './handlers/admin.js';
import { handleCommonChatMemberUpdate, handleGroupChatMemberUpdate } from './handlers/chatMember.js';
import { handleGroupActivityMessage } from './handlers/groupActivity.js';
import {
  handleCommonAccessCallback,
  handleCommonStart,
  handleSubscribeCallback,
  handleSubscriptionStart,
} from './handlers/start.js';
import {
  ADMIN_CHECK_CALLBACK,
  ADMIN_SUMMARY_CALLBACK,
  COMMON_ACCESS_CALLBACK,
  MENU_BUTTON_TEXT,
  SUBSCRIBE_CALLBACK,
} from './keyboards.js';
import { isAdmin } from './middleware/isAdmin.js';

/** Closed group: paid 30-day subscription, mute/unmute, reminders, admin panel. */
export const subscriptionBot = new Bot(config.BOT_TOKEN);

/** Common group ("KORDON Transfer"): one-time payment, lifetime access, no admin panel. */
export const commonBot = new Bot(config.COMMON_BOT_TOKEN);

/**
 * The bots are group admins, so Telegram delivers group messages to them regardless of privacy
 * mode. User-facing commands/buttons are scoped to private chats; inside a group the bots only
 * do control/analytics work (chat_member tracking, ban/unban via internal API, and — for the
 * closed group only — per-day message-count activity tracking for the dashboard).
 */
const subscriptionPrivate = subscriptionBot.chatType('private');
const commonPrivate = commonBot.chatType('private');

subscriptionPrivate.command('start', handleSubscriptionStart);
subscriptionPrivate.hears(MENU_BUTTON_TEXT, handleSubscriptionStart);
subscriptionPrivate.command('admin', isAdmin, handleAdmin);
subscriptionPrivate.callbackQuery(ADMIN_CHECK_CALLBACK, isAdmin, handleAdminCheckCallback);
subscriptionPrivate.callbackQuery(ADMIN_SUMMARY_CALLBACK, isAdmin, handleAdminSummaryCallback);
subscriptionPrivate.callbackQuery(SUBSCRIBE_CALLBACK, handleSubscribeCallback);
subscriptionBot.on('chat_member', handleGroupChatMemberUpdate);
subscriptionBot.chatType(['group', 'supergroup']).on('message', handleGroupActivityMessage);

commonPrivate.command('start', handleCommonStart);
commonPrivate.hears(MENU_BUTTON_TEXT, handleCommonStart);
commonPrivate.callbackQuery(COMMON_ACCESS_CALLBACK, handleCommonAccessCallback);
commonBot.on('chat_member', handleCommonChatMemberUpdate);
