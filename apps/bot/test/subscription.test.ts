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
  mockGetChat,
  mockRestrictChatMember,
  mockNotifyAdmins,
  mockSettingFindUnique,
  mockPaymentCreate,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockCreateChatInviteLink:
    vi.fn<(chatId: string, options: { member_limit: number }) => Promise<{ invite_link: string }>>(),
  mockSendMessage: vi.fn<(chatId: string, text: string) => Promise<unknown>>(),
  mockGetChat:
    vi.fn<
      (chatId: string) => Promise<{ permissions: Record<string, boolean> }>
    >(),
  mockRestrictChatMember:
    vi.fn<
      (
        chatId: string,
        userId: number,
        permissions: Record<string, boolean>,
      ) => Promise<unknown>
    >(),
  mockNotifyAdmins: vi.fn<(bot: unknown, text: string) => Promise<void>>(),
  mockSettingFindUnique: vi.fn<(args: SettingFindArgs) => Promise<SettingRecord>>(),
  mockPaymentCreate: vi.fn<(args: PaymentCreateArgs) => Promise<{ id: number }>>(),
  mockLoggerError: vi.fn<(obj: unknown, msg?: string) => void>(),
}));

vi.mock('../src/bot/bot.js', () => ({
  bot: {
    api: {
      createChatInviteLink: mockCreateChatInviteLink,
      sendMessage: mockSendMessage,
      getChat: mockGetChat,
      restrictChatMember: mockRestrictChatMember,
    },
  },
}));

vi.mock('../src/services/notify.js', () => ({
  notifyAdmins: mockNotifyAdmins,
}));

vi.mock('../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mockLoggerError },
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
  applyPayment,
  calculateNewExpiresAt,
  createSubscriptionPaymentLink,
  grantAccessAfterPayment,
  muteExpiredUser,
  resendCommonAccessInviteLink,
  unmuteUserAfterPayment,
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
      wasMuted: false,
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
      wasMuted: false,
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

describe('applyPayment', () => {
  const now = new Date('2026-01-15T12:00:00.000Z');
  const TEST_USER_ID = BigInt(444555666);
  const payment = {
    id: 1,
    userId: TEST_USER_ID,
    amount: '990.00',
    status: 'PENDING',
    product: ProductType.SUBSCRIPTION,
  };

  function createTx(user: { status: string; expiresAt: Date | null }) {
    const findUniqueOrThrow = vi.fn().mockResolvedValue(user);
    const update = vi.fn().mockResolvedValue({});
    return {
      user: { findUniqueOrThrow, update },
    };
  }

  it('returns wasMuted=true when user status was MUTED before update', async () => {
    const tx = createTx({ status: UserStatus.MUTED, expiresAt: new Date('2026-01-01T12:00:00.000Z') });

    const result = await applyPayment(
      tx as unknown as Parameters<typeof applyPayment>[0],
      payment as Parameters<typeof applyPayment>[1],
      now,
      PERIOD_DAYS,
    );

    expect(result.wasMuted).toBe(true);
    expect(result.expiresAt.getTime()).toBe(now.getTime() + PERIOD_DAYS * MS_PER_DAY);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: TEST_USER_ID },
      data: {
        expiresAt: result.expiresAt,
        status: UserStatus.ACTIVE,
        reminderSentAt: null,
        lastMutedRemindAt: null,
      },
    });
  });

  it('returns wasMuted=false when user status was ACTIVE before update', async () => {
    const tx = createTx({ status: UserStatus.ACTIVE, expiresAt: null });

    const result = await applyPayment(
      tx as unknown as Parameters<typeof applyPayment>[0],
      payment as Parameters<typeof applyPayment>[1],
      now,
      PERIOD_DAYS,
    );

    expect(result.wasMuted).toBe(false);
  });

  it('returns wasMuted=false when user status was NEW before update', async () => {
    const tx = createTx({ status: UserStatus.NEW, expiresAt: null });

    const result = await applyPayment(
      tx as unknown as Parameters<typeof applyPayment>[0],
      payment as Parameters<typeof applyPayment>[1],
      now,
      PERIOD_DAYS,
    );

    expect(result.wasMuted).toBe(false);
  });
});

describe('unmuteUserAfterPayment', () => {
  const TEST_USER_ID = BigInt(777888999);
  const groupPermissions = {
    can_send_messages: true,
    can_send_audios: true,
    can_send_documents: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetChat.mockResolvedValue({ permissions: groupPermissions });
    mockRestrictChatMember.mockResolvedValue({});
  });

  it('calls getChat and restrictChatMember with group permissions', async () => {
    const result = await unmuteUserAfterPayment(TEST_USER_ID);

    expect(result).toBe(true);
    expect(mockGetChat).toHaveBeenCalledWith(config.GROUP_ID.toString());
    expect(mockRestrictChatMember).toHaveBeenCalledWith(
      config.GROUP_ID.toString(),
      Number(TEST_USER_ID),
      groupPermissions,
    );
  });

  it('logs error and returns false when restrictChatMember fails', async () => {
    mockRestrictChatMember.mockRejectedValue(new Error('telegram restrictChatMember failed'));

    const result = await unmuteUserAfterPayment(TEST_USER_ID);

    expect(result).toBe(false);
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ userId: TEST_USER_ID.toString() }),
      'payment: failed to unmute user after payment',
    );
  });
});
