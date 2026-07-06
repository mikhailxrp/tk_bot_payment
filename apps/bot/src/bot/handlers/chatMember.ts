import type { Context } from 'grammy';
import type { ChatMemberUpdated } from '@grammyjs/types';

import { commonBot, subscriptionBot } from '../bot.js';
import { config } from '../../config.js';
import { notifyAdmins } from '../../services/notify.js';
import { formatUserMention, setCommonAccessInGroup, setUserInGroup } from '../../services/subscription.js';

function resolveInGroup(status: string): boolean | null {
  if (status === 'member') {
    return true;
  }
  if (status === 'left' || status === 'kicked') {
    return false;
  }

  return null;
}

function isJoinTransition(update: ChatMemberUpdated): boolean {
  const wasOutside =
    update.old_chat_member.status === 'left' || update.old_chat_member.status === 'kicked';
  const isNowMember = update.new_chat_member.status === 'member';

  return wasOutside && isNowMember;
}

export async function handleGroupChatMemberUpdate(ctx: Context): Promise<void> {
  const update = ctx.chatMember;
  if (!update || BigInt(update.chat.id) !== config.GROUP_ID) {
    return;
  }

  const userId = BigInt(update.new_chat_member.user.id);
  const inGroup = resolveInGroup(update.new_chat_member.status);
  if (inGroup !== null) {
    await setUserInGroup(userId, inGroup);
  }

  if (isJoinTransition(update)) {
    const mention = formatUserMention(update.new_chat_member.user.username ?? null, userId);
    await notifyAdmins(subscriptionBot, `${mention} вступил(а) в закрытую группу`);
  }
}

export async function handleCommonChatMemberUpdate(ctx: Context): Promise<void> {
  const update = ctx.chatMember;
  if (!update || BigInt(update.chat.id) !== config.COMMON_GROUP_ID) {
    return;
  }

  const userId = BigInt(update.new_chat_member.user.id);
  const inGroup = resolveInGroup(update.new_chat_member.status);
  if (inGroup !== null) {
    await setCommonAccessInGroup(userId, inGroup);
  }

  if (isJoinTransition(update)) {
    const mention = formatUserMention(update.new_chat_member.user.username ?? null, userId);
    await notifyAdmins(commonBot, `${mention} вступил(а) в общую группу`);
  }
}
