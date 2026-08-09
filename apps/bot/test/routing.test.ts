import type { Update, UserFromGetMe } from 'grammy/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockHandleSubscriptionStart,
  mockHandleCommonStart,
  mockHandleSubscribeCallback,
  mockHandleCommonAccessCallback,
  mockHandleAdmin,
  mockHandleGroupChatMemberUpdate,
} = vi.hoisted(() => ({
  mockHandleSubscriptionStart: vi.fn(),
  mockHandleCommonStart: vi.fn(),
  mockHandleSubscribeCallback: vi.fn(),
  mockHandleCommonAccessCallback: vi.fn(),
  mockHandleAdmin: vi.fn(),
  mockHandleGroupChatMemberUpdate: vi.fn(),
}));

vi.mock('../src/bot/handlers/start.js', () => ({
  handleSubscriptionStart: mockHandleSubscriptionStart,
  handleCommonStart: mockHandleCommonStart,
  handleSubscribeCallback: mockHandleSubscribeCallback,
  handleCommonAccessCallback: mockHandleCommonAccessCallback,
}));

vi.mock('../src/bot/handlers/admin.js', () => ({
  handleAdmin: mockHandleAdmin,
  handleAdminCheckCallback: vi.fn(),
  handleAdminSummaryCallback: vi.fn(),
}));

vi.mock('../src/bot/handlers/chatMember.js', () => ({
  handleGroupChatMemberUpdate: mockHandleGroupChatMemberUpdate,
  handleCommonChatMemberUpdate: vi.fn(),
}));

vi.mock('../src/bot/middleware/isAdmin.js', () => ({
  isAdmin: (_ctx: unknown, next: () => Promise<void>) => next(),
  isBotAdmin: vi.fn(async () => true),
}));

const { commonBot, subscriptionBot } = await import('../src/bot/bot.js');

const SUBSCRIPTION_BOT_USERNAME = 'TK_admin_payment_bot';
const COMMON_BOT_USERNAME = 'TK_common_payment_bot';

function botInfo(username: string): UserFromGetMe {
  return {
    id: 1,
    is_bot: true,
    first_name: username,
    username,
    can_join_groups: true,
    can_read_all_group_messages: true,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  };
}

subscriptionBot.botInfo = botInfo(SUBSCRIPTION_BOT_USERNAME);
commonBot.botInfo = botInfo(COMMON_BOT_USERNAME);

const PRIVATE_CHAT = { id: 111, type: 'private', first_name: 'User' };
const GROUP_CHAT = { id: -1001234567890, type: 'supergroup', title: 'Monsters of the roads' };
const FROM = { id: 111, is_bot: false, first_name: 'User' };

function messageUpdate(chat: unknown, text: string): Update {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat,
      from: FROM,
      text,
      entities: text.startsWith('/')
        ? [{ type: 'bot_command', offset: 0, length: text.length }]
        : undefined,
    },
  } as unknown as Update;
}

function callbackUpdate(chat: unknown, data: string): Update {
  return {
    update_id: 2,
    callback_query: {
      id: 'cb-1',
      from: FROM,
      chat_instance: 'instance',
      data,
      message: { message_id: 2, date: 0, chat },
    },
  } as unknown as Update;
}

describe('bot routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles /start in a private chat', async () => {
    await subscriptionBot.handleUpdate(messageUpdate(PRIVATE_CHAT, '/start'));

    expect(mockHandleSubscriptionStart).toHaveBeenCalledTimes(1);
  });

  it('ignores /start addressed to the bot inside a group', async () => {
    await subscriptionBot.handleUpdate(
      messageUpdate(GROUP_CHAT, `/start@${SUBSCRIPTION_BOT_USERNAME}`),
    );
    await subscriptionBot.handleUpdate(messageUpdate(GROUP_CHAT, '/start'));

    expect(mockHandleSubscriptionStart).not.toHaveBeenCalled();
  });

  it('ignores /admin inside a group', async () => {
    await subscriptionBot.handleUpdate(
      messageUpdate(GROUP_CHAT, `/admin@${SUBSCRIPTION_BOT_USERNAME}`),
    );

    expect(mockHandleAdmin).not.toHaveBeenCalled();
  });

  it('ignores the menu button text inside a group', async () => {
    await subscriptionBot.handleUpdate(messageUpdate(GROUP_CHAT, '☰ Меню'));

    expect(mockHandleSubscriptionStart).not.toHaveBeenCalled();
  });

  it('ignores callback queries coming from a group message', async () => {
    await subscriptionBot.handleUpdate(callbackUpdate(GROUP_CHAT, 'subscribe'));

    expect(mockHandleSubscribeCallback).not.toHaveBeenCalled();

    await subscriptionBot.handleUpdate(callbackUpdate(PRIVATE_CHAT, 'subscribe'));

    expect(mockHandleSubscribeCallback).toHaveBeenCalledTimes(1);
  });

  it('still handles chat_member updates from the group', async () => {
    const update = {
      update_id: 3,
      chat_member: {
        chat: GROUP_CHAT,
        from: FROM,
        date: 0,
        old_chat_member: { status: 'left', user: FROM },
        new_chat_member: { status: 'member', user: FROM },
      },
    } as unknown as Update;

    await subscriptionBot.handleUpdate(update);

    expect(mockHandleGroupChatMemberUpdate).toHaveBeenCalledTimes(1);
  });

  it('ignores /start inside a group for the common bot', async () => {
    await commonBot.handleUpdate(messageUpdate(GROUP_CHAT, `/start@${COMMON_BOT_USERNAME}`));

    expect(mockHandleCommonStart).not.toHaveBeenCalled();

    await commonBot.handleUpdate(messageUpdate(PRIVATE_CHAT, '/start'));

    expect(mockHandleCommonStart).toHaveBeenCalledTimes(1);
  });
});
