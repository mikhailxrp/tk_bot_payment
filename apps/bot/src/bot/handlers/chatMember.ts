import type { Context } from 'grammy';
import type { ChatMemberUpdated } from '@grammyjs/types';

import { bot } from '../bot.js';
import { config } from '../../config.js';
import { notifyAdmins } from '../../services/notify.js';
import { formatUserMention, setCommonAccessInGroup, setUserInGroup } from '../../services/subscription.js';

type GroupKind = 'group' | 'common' | null;

function resolveGroupKind(chatId: number): GroupKind {
  const id = BigInt(chatId);

  if (id === config.GROUP_ID) {
    return 'group';
  }
  if (id === config.COMMON_GROUP_ID) {
    return 'common';
  }

  return null;
}

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

export async function handleChatMemberUpdate(ctx: Context): Promise<void> {
  const update = ctx.chatMember;
  if (!update) {
    return;
  }

  const groupKind = resolveGroupKind(update.chat.id);
  if (!groupKind) {
    return;
  }

  const userId = BigInt(update.new_chat_member.user.id);
  const inGroup = resolveInGroup(update.new_chat_member.status);
  if (inGroup !== null) {
    if (groupKind === 'group') {
      await setUserInGroup(userId, inGroup);
    } else {
      await setCommonAccessInGroup(userId, inGroup);
    }
  }

  if (isJoinTransition(update)) {
    const mention = formatUserMention(update.new_chat_member.user.username ?? null, userId);
    const groupLabel = groupKind === 'group' ? 'закрытую группу' : 'общую группу';
    await notifyAdmins(bot, `${mention} вступил(а) в ${groupLabel}`);
  }
}
