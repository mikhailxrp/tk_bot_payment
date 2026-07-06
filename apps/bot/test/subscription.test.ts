import { ProductType, UserStatus } from '@tg-bot/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type SettingFindArgs = { where: { key: string } };
type SettingRecord = { value: string } | null;
type PaymentCreateArgs = { data: { userId: bigint; amount: string; status: string } };
type UserUpdateManyArgs = {
  where: { id: bigint; status: string; expiresAt: { lte: Date } };
  data: { status: string; mutedAt: Date };
};

const {
  mockCreateChatInviteLink,
  mockSendMessage,
  mockRestrictChatMember,
  mockNotifyAdmins,
  mockSettingFindUnique,
  mockPaymentCreate,
} = vi.hoisted(() => ({
  mockCreateChatInviteLink:
    vi.fn<(chatId: string, options: { member_limit: number }) => Promise<{ invite_link: string }>>(),
  mockSendMessage: vi.fn<(chatId: string, text: string) => Promise<unknown>>(),
  mockRestrictChatMember:
    vi.fn<
      (
        chatId: string,
        userId: number,
        permissions: { can_send_messages: boolean },
      ) => Promise<unknown>
    >(),
  mockNotifyAdmins: vi.fn<(bot: unknown, text: string) => Promise<void>>(),
  mockSettingFindUnique: vi.fn<(args: SettingFindArgs) => Promise<SettingRecord>>(),
  mockPaymentCreate: vi.fn<(args: PaymentCreateArgs) => Promise<{ id: number }>>(),
}));

vi.mock('../src/bot/bot.js', () => ({
  bot: {
    api: {
      createChatInviteLink: mockCreateChatInviteLink,
      sendMessage: mockSendMessage,
      restrictChatMember: mockRestrictChatMember,
    },
  },
}));

vi.mock('../src/services/notify.js', () => ({
  notifyAdmins: mockNotifyAdmins,
}));

vi.mock('../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@tg-bot/db', () => ({
  ProductType: { SUBSCRIPTION: 'SUBSCRIPTION', LIFETIME: 'LIFETIME' },
  PaymentStatus: { PENDING: 'PENDING', PAID: 'PAID', FAILED: 'FAILED' },
  UserStatus: { NEW: 'NEW', ACTIVE: 'ACTIVE', MUTED: 'MUTED', LEFT: 'LEFT' },
  prisma: {
    setting: { findUnique: mockSettingFindUnique },
    payment: { create: mockPaymentCreate },
  },
}));

import { config } from '../src/config.js';
import {
  calculateNewExpiresAt,
  createSubscriptionPaymentLink,
  grantAccessAfterPayment,
  muteExpiredUser,
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

describe('createSubscriptionPaymentLink', () => {
  const TEST_USER_ID = BigInt(555666777);

  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingFindUnique.mockImplementation(({ where }) => {
      if (where.key === 'price') {
        return Promise.resolve({ value: '990' });
      }
      if (where.key === 'period_days') {
        return Promise.resolve({ value: '30' });
      }
      return Promise.resolve(null);
    });
    mockPaymentCreate.mockResolvedValue({ id: 42 });
  });

  it('creates a PENDING SUBSCRIPTION payment and returns a Robokassa link', async () => {
    const result = await createSubscriptionPaymentLink(TEST_USER_ID);

    expect(mockPaymentCreate).toHaveBeenCalledWith({
      data: {
        userId: TEST_USER_ID,
        amount: '990.00',
        status: 'PENDING',
      },
    });
    expect(result).not.toBeNull();
    expect(result?.amount).toBe('990.00');
    expect(result?.periodDays).toBe('30');
    expect(result?.paymentUrl).toContain('auth.robokassa.ru');
    expect(result?.paymentUrl).toContain('Description=' + encodeURIComponent('Подписка на 30 дней'));
  });

  it('returns null and does not create a payment when price is missing', async () => {
    mockSettingFindUnique.mockResolvedValue(null);

    const result = await createSubscriptionPaymentLink(TEST_USER_ID);

    expect(result).toBeNull();
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it('returns null when period_days is not a positive integer', async () => {
    mockSettingFindUnique.mockImplementation(({ where }) => {
      if (where.key === 'price') {
        return Promise.resolve({ value: '990' });
      }
      if (where.key === 'period_days') {
        return Promise.resolve({ value: '0' });
      }
      return Promise.resolve(null);
    });

    const result = await createSubscriptionPaymentLink(TEST_USER_ID);

    expect(result).toBeNull();
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });
});

describe('muteExpiredUser', () => {
  const TEST_USER_ID = BigInt(111222333);
  const now = new Date('2026-01-15T12:00:00.000Z');

  function createTx(updateManyCount: number) {
    const updateMany = vi.fn<(args: UserUpdateManyArgs) => Promise<{ count: number }>>();
    updateMany.mockResolvedValue({ count: updateManyCount });
    return { user: { updateMany } };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRestrictChatMember.mockResolvedValue({});
  });

  it('mutes via restrictChatMember and returns true when the atomic guard matches exactly one row', async () => {
    const tx = createTx(1);

    const result = await muteExpiredUser(
      tx as unknown as Parameters<typeof muteExpiredUser>[0],
      TEST_USER_ID,
      now,
    );

    expect(result).toBe(true);
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: TEST_USER_ID, status: 'ACTIVE', expiresAt: { lte: now } },
      data: { status: 'MUTED', mutedAt: now },
    });
    expect(mockRestrictChatMember).toHaveBeenCalledWith(
      config.GROUP_ID.toString(),
      Number(TEST_USER_ID),
      { can_send_messages: false },
    );
  });

  it('returns false and does not call restrictChatMember when the guard matches no row', async () => {
    const tx = createTx(0);

    const result = await muteExpiredUser(
      tx as unknown as Parameters<typeof muteExpiredUser>[0],
      TEST_USER_ID,
      now,
    );

    expect(result).toBe(false);
    expect(mockRestrictChatMember).not.toHaveBeenCalled();
  });

  it('still returns true when restrictChatMember fails, since the DB guard already committed', async () => {
    const tx = createTx(1);
    mockRestrictChatMember.mockRejectedValue(new Error('telegram restrictChatMember failed'));

    const result = await muteExpiredUser(
      tx as unknown as Parameters<typeof muteExpiredUser>[0],
      TEST_USER_ID,
      now,
    );

    expect(result).toBe(true);
  });
});
