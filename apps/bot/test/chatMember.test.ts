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
  bot: { api: {} },
}));

import { config } from '../src/config.js';
import { handleChatMemberUpdate } from '../src/bot/handlers/chatMember.js';

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

describe('handleChatMemberUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetUserInGroup.mockResolvedValue(undefined);
    mockSetCommonAccessInGroup.mockResolvedValue(undefined);
    mockNotifyAdmins.mockResolvedValue(undefined);
  });

  it('join in GROUP_ID (left -> member) sets User.inGroup=true and notifies admins', async () => {
    const ctx = buildContext(config.GROUP_ID, 'left', 'member');

    await handleChatMemberUpdate(ctx);

    expect(mockSetUserInGroup).toHaveBeenCalledWith(555n, true);
    expect(mockSetCommonAccessInGroup).not.toHaveBeenCalled();
    expect(mockNotifyAdmins).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdmins.mock.calls[0]?.[1]).toContain('закрытую группу');
  });

  it('join in COMMON_GROUP_ID (kicked -> member) sets CommonAccess.inGroup=true and notifies admins', async () => {
    const ctx = buildContext(config.COMMON_GROUP_ID, 'kicked', 'member');

    await handleChatMemberUpdate(ctx);

    expect(mockSetCommonAccessInGroup).toHaveBeenCalledWith(555n, true);
    expect(mockSetUserInGroup).not.toHaveBeenCalled();
    expect(mockNotifyAdmins).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdmins.mock.calls[0]?.[1]).toContain('общую группу');
  });

  it('transition to member without prior left/kicked (e.g. restricted -> member) updates inGroup but does not notify', async () => {
    const ctx = buildContext(config.GROUP_ID, 'restricted', 'member');

    await handleChatMemberUpdate(ctx);

    expect(mockSetUserInGroup).toHaveBeenCalledWith(555n, true);
    expect(mockNotifyAdmins).not.toHaveBeenCalled();
  });

  it('left in GROUP_ID sets User.inGroup=false without notifying', async () => {
    const ctx = buildContext(config.GROUP_ID, 'member', 'left');

    await handleChatMemberUpdate(ctx);

    expect(mockSetUserInGroup).toHaveBeenCalledWith(555n, false);
    expect(mockNotifyAdmins).not.toHaveBeenCalled();
  });

  it('kicked in COMMON_GROUP_ID sets CommonAccess.inGroup=false without notifying', async () => {
    const ctx = buildContext(config.COMMON_GROUP_ID, 'member', 'kicked');

    await handleChatMemberUpdate(ctx);

    expect(mockSetCommonAccessInGroup).toHaveBeenCalledWith(555n, false);
    expect(mockNotifyAdmins).not.toHaveBeenCalled();
  });

  it('restricted status is ignored entirely (inGroup untouched)', async () => {
    const ctx = buildContext(config.GROUP_ID, 'member', 'restricted');

    await handleChatMemberUpdate(ctx);

    expect(mockSetUserInGroup).not.toHaveBeenCalled();
    expect(mockSetCommonAccessInGroup).not.toHaveBeenCalled();
    expect(mockNotifyAdmins).not.toHaveBeenCalled();
  });

  it('unknown chat.id is ignored without throwing', async () => {
    const ctx = buildContext(999999n, 'left', 'member');

    await expect(handleChatMemberUpdate(ctx)).resolves.toBeUndefined();

    expect(mockSetUserInGroup).not.toHaveBeenCalled();
    expect(mockSetCommonAccessInGroup).not.toHaveBeenCalled();
    expect(mockNotifyAdmins).not.toHaveBeenCalled();
  });
});
