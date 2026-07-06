import type { Context } from 'grammy';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSetUserInGroup, mockSetCommonAccessInGroup, mockNotifyAdmins } = vi.hoisted(() => ({
  mockSetUserInGroup: vi.fn<(userId: bigint, inGroup: boolean) => Promise<void>>(),
  mockSetCommonAccessInGroup: vi.fn<(userId: bigint, inGroup: boolean) => Promise<void>>(),
  mockNotifyAdmins: vi.fn<(bot: unknown, text: string) => Promise<void>>(),
}));

vi.mock('../src/services/subscription.js', () => ({
  setUserInGroup: mockSetUserInGroup,
  setCommonAccessInGroup: mockSetCommonAccessInGroup,
  formatUserMention: (username: string | null, userId: bigint) =>
    username ? `@${username}` : `id:${userId.toString()}`,
}));

vi.mock('../src/services/notify.js', () => ({
  notifyAdmins: mockNotifyAdmins,
}));

vi.mock('../src/bot/bot.js', () => ({
  subscriptionBot: { api: {}, __name: 'subscriptionBot' },
  commonBot: { api: {}, __name: 'commonBot' },
}));

import { config } from '../src/config.js';
import { commonBot, subscriptionBot } from '../src/bot/bot.js';
import {
  handleCommonChatMemberUpdate,
  handleGroupChatMemberUpdate,
} from '../src/bot/handlers/chatMember.js';

type ChatMemberStatus = 'left' | 'kicked' | 'member' | 'restricted' | 'administrator' | 'creator';

function buildContext(
  chatId: bigint,
  oldStatus: ChatMemberStatus,
  newStatus: ChatMemberStatus,
  userId = 555,
  username: string | null = 'newuser',
): Context {
  return {
    chatMember: {
      chat: { id: Number(chatId), type: 'supergroup', title: 'Test group' },
      from: { id: 1, is_bot: false, first_name: 'Admin' },
      date: 0,
      old_chat_member: { status: oldStatus, user: { id: userId, is_bot: false, first_name: 'User' } },
      new_chat_member: {
        status: newStatus,
        user: { id: userId, is_bot: false, first_name: 'User', username: username ?? undefined },
      },
    },
  } as unknown as Context;
}

describe('handleGroupChatMemberUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetUserInGroup.mockResolvedValue(undefined);
    mockNotifyAdmins.mockResolvedValue(undefined);
  });

  it('join (left -> member) sets User.inGroup=true and notifies admins via subscriptionBot', async () => {
    const ctx = buildContext(config.GROUP_ID, 'left', 'member');

    await handleGroupChatMemberUpdate(ctx);

    expect(mockSetUserInGroup).toHaveBeenCalledWith(555n, true);
    expect(mockSetCommonAccessInGroup).not.toHaveBeenCalled();
    expect(mockNotifyAdmins).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdmins.mock.calls[0]?.[0]).toBe(subscriptionBot);
    expect(mockNotifyAdmins.mock.calls[0]?.[1]).toContain('закрытую группу');
  });

  it('transition to member without prior left/kicked (e.g. restricted -> member) updates inGroup but does not notify', async () => {
    const ctx = buildContext(config.GROUP_ID, 'restricted', 'member');

    await handleGroupChatMemberUpdate(ctx);

    expect(mockSetUserInGroup).toHaveBeenCalledWith(555n, true);
    expect(mockNotifyAdmins).not.toHaveBeenCalled();
  });

  it('left sets User.inGroup=false without notifying', async () => {
    const ctx = buildContext(config.GROUP_ID, 'member', 'left');

    await handleGroupChatMemberUpdate(ctx);

    expect(mockSetUserInGroup).toHaveBeenCalledWith(555n, false);
    expect(mockNotifyAdmins).not.toHaveBeenCalled();
  });

  it('restricted status is ignored entirely (inGroup untouched)', async () => {
    const ctx = buildContext(config.GROUP_ID, 'member', 'restricted');

    await handleGroupChatMemberUpdate(ctx);

    expect(mockSetUserInGroup).not.toHaveBeenCalled();
    expect(mockNotifyAdmins).not.toHaveBeenCalled();
  });

  it('ignores updates for COMMON_GROUP_ID (that chat belongs to the other bot)', async () => {
    const ctx = buildContext(config.COMMON_GROUP_ID, 'left', 'member');

    await expect(handleGroupChatMemberUpdate(ctx)).resolves.toBeUndefined();

    expect(mockSetUserInGroup).not.toHaveBeenCalled();
    expect(mockNotifyAdmins).not.toHaveBeenCalled();
  });

  it('ignores an unknown chat.id without throwing', async () => {
    const ctx = buildContext(999999n, 'left', 'member');

    await expect(handleGroupChatMemberUpdate(ctx)).resolves.toBeUndefined();

    expect(mockSetUserInGroup).not.toHaveBeenCalled();
    expect(mockNotifyAdmins).not.toHaveBeenCalled();
  });
});

describe('handleCommonChatMemberUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCommonAccessInGroup.mockResolvedValue(undefined);
    mockNotifyAdmins.mockResolvedValue(undefined);
  });

  it('join (kicked -> member) sets CommonAccess.inGroup=true and notifies admins via commonBot', async () => {
    const ctx = buildContext(config.COMMON_GROUP_ID, 'kicked', 'member');

    await handleCommonChatMemberUpdate(ctx);

    expect(mockSetCommonAccessInGroup).toHaveBeenCalledWith(555n, true);
    expect(mockSetUserInGroup).not.toHaveBeenCalled();
    expect(mockNotifyAdmins).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdmins.mock.calls[0]?.[0]).toBe(commonBot);
    expect(mockNotifyAdmins.mock.calls[0]?.[1]).toContain('общую группу');
  });

  it('kicked sets CommonAccess.inGroup=false without notifying', async () => {
    const ctx = buildContext(config.COMMON_GROUP_ID, 'member', 'kicked');

    await handleCommonChatMemberUpdate(ctx);

    expect(mockSetCommonAccessInGroup).toHaveBeenCalledWith(555n, false);
    expect(mockNotifyAdmins).not.toHaveBeenCalled();
  });

  it('restricted status is ignored entirely (inGroup untouched)', async () => {
    const ctx = buildContext(config.COMMON_GROUP_ID, 'member', 'restricted');

    await handleCommonChatMemberUpdate(ctx);

    expect(mockSetCommonAccessInGroup).not.toHaveBeenCalled();
    expect(mockNotifyAdmins).not.toHaveBeenCalled();
  });

  it('ignores updates for GROUP_ID (that chat belongs to the other bot)', async () => {
    const ctx = buildContext(config.GROUP_ID, 'kicked', 'member');

    await expect(handleCommonChatMemberUpdate(ctx)).resolves.toBeUndefined();

    expect(mockSetCommonAccessInGroup).not.toHaveBeenCalled();
    expect(mockNotifyAdmins).not.toHaveBeenCalled();
  });

  it('ignores an unknown chat.id without throwing', async () => {
    const ctx = buildContext(999999n, 'kicked', 'member');

    await expect(handleCommonChatMemberUpdate(ctx)).resolves.toBeUndefined();

    expect(mockSetCommonAccessInGroup).not.toHaveBeenCalled();
    expect(mockNotifyAdmins).not.toHaveBeenCalled();
  });
});
