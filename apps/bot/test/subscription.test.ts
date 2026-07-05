import { ProductType, UserStatus } from '@tg-bot/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateChatInviteLink, mockSendMessage, mockNotifyAdmins } = vi.hoisted(() => ({
  mockCreateChatInviteLink:
    vi.fn<(chatId: string, options: { member_limit: number }) => Promise<{ invite_link: string }>>(),
  mockSendMessage: vi.fn<(chatId: string, text: string) => Promise<unknown>>(),
  mockNotifyAdmins: vi.fn<(bot: unknown, text: string) => Promise<void>>(),
}));

vi.mock('../src/bot/bot.js', () => ({
  bot: {
    api: {
      createChatInviteLink: mockCreateChatInviteLink,
      sendMessage: mockSendMessage,
    },
  },
}));

vi.mock('../src/services/notify.js', () => ({
  notifyAdmins: mockNotifyAdmins,
}));

import { config } from '../src/config.js';
import {
  calculateNewExpiresAt,
  grantAccessAfterPayment,
  resendCommonAccessInviteLink,
} from '../src/services/subscription.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PERIOD_DAYS = 30;

describe('calculateNewExpiresAt', () => {
  const now = new Date('2026-01-15T12:00:00.000Z');

  it('extends active subscription from expiresAt by period_days', () => {
    const expiresAt = new Date('2026-02-01T12:00:00.000Z');

    const result = calculateNewExpiresAt(
      { status: UserStatus.ACTIVE, expiresAt },
      now,
      PERIOD_DAYS,
    );

    expect(result.getTime()).toBe(expiresAt.getTime() + PERIOD_DAYS * MS_PER_DAY);
  });

  it('starts from now when subscription is expired', () => {
    const expiresAt = new Date('2026-01-01T12:00:00.000Z');

    const result = calculateNewExpiresAt(
      { status: UserStatus.ACTIVE, expiresAt },
      now,
      PERIOD_DAYS,
    );

    expect(result.getTime()).toBe(now.getTime() + PERIOD_DAYS * MS_PER_DAY);
  });

  it('starts from now when expiresAt is null', () => {
    const result = calculateNewExpiresAt(
      { status: UserStatus.ACTIVE, expiresAt: null },
      now,
      PERIOD_DAYS,
    );

    expect(result.getTime()).toBe(now.getTime() + PERIOD_DAYS * MS_PER_DAY);
  });

  it('starts from now when expiresAt equals now (boundary)', () => {
    const expiresAt = new Date(now);

    const result = calculateNewExpiresAt(
      { status: UserStatus.ACTIVE, expiresAt },
      now,
      PERIOD_DAYS,
    );

    expect(result.getTime()).toBe(now.getTime() + PERIOD_DAYS * MS_PER_DAY);
  });
});

describe('grantAccessAfterPayment', () => {
  const TEST_USER_ID = BigInt(123456789);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateChatInviteLink.mockResolvedValue({
      invite_link: 'https://t.me/joinchat/test-invite',
    });
    mockSendMessage.mockResolvedValue({});
    mockNotifyAdmins.mockResolvedValue(undefined);
  });

  it('grants SUBSCRIPTION access via GROUP_ID and notifies with expiration date', async () => {
    const expiresAt = new Date('2026-02-15T12:00:00.000Z');

    await grantAccessAfterPayment({
      userId: TEST_USER_ID,
      product: ProductType.SUBSCRIPTION,
      amount: '990.00',
      username: 'testuser',
      expiresAt,
    });

    expect(mockCreateChatInviteLink).toHaveBeenCalledWith(config.GROUP_ID.toString(), {
      member_limit: 1,
    });
    expect(mockSendMessage).toHaveBeenCalledWith(
      TEST_USER_ID.toString(),
      expect.stringContaining('закрытую группу'),
    );
    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    expect(mockNotifyAdmins.mock.calls[0]?.[1]).toContain('срок до');
  });

  it('grants LIFETIME access via COMMON_GROUP_ID and notifies about lifetime access', async () => {
    await grantAccessAfterPayment({
      userId: TEST_USER_ID,
      product: ProductType.LIFETIME,
      amount: '500.00',
      username: 'testuser',
    });

    expect(mockCreateChatInviteLink).toHaveBeenCalledWith(
      config.COMMON_GROUP_ID.toString(),
      { member_limit: 1 },
    );
    expect(mockSendMessage).toHaveBeenCalledWith(
      TEST_USER_ID.toString(),
      expect.stringContaining('общую группу'),
    );
    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    expect(mockNotifyAdmins.mock.calls[0]?.[1]).toContain('бессрочный доступ');
  });
});

describe('resendCommonAccessInviteLink', () => {
  const TEST_USER_ID = BigInt(987654321);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateChatInviteLink.mockResolvedValue({
      invite_link: 'https://t.me/joinchat/test-invite',
    });
    mockSendMessage.mockResolvedValue({});
  });

  it('always creates the invite link in COMMON_GROUP_ID', async () => {
    await resendCommonAccessInviteLink(TEST_USER_ID);

    expect(mockCreateChatInviteLink).toHaveBeenCalledWith(
      config.COMMON_GROUP_ID.toString(),
      { member_limit: 1 },
    );
  });

  it('sends a message that does not claim a fresh successful payment', async () => {
    await resendCommonAccessInviteLink(TEST_USER_ID);

    const [, text] = mockSendMessage.mock.calls[0] ?? [];
    expect(text).not.toContain('Оплата прошла успешно');
    expect(text).toContain('https://t.me/joinchat/test-invite');
  });
});
