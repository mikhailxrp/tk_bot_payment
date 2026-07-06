import { createHash } from 'node:crypto';
import formbody from '@fastify/formbody';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type UpdateManyResult = { count: number };
type PaymentRecord = { id: number; status: string };
type PaymentWithUser = {
  id: number;
  userId: bigint;
  product: string;
  amount: { toString: () => string };
};
type UserUsernameRecord = { username: string | null };
type SettingRecord = { value: string } | null;
type UserRecord = { status: string; expiresAt: Date | null };

type MockTxClient = {
  payment: {
    updateMany: (args: unknown) => Promise<UpdateManyResult>;
    findUnique: (args: unknown) => Promise<PaymentRecord | null>;
    findUniqueOrThrow: (args: unknown) => Promise<PaymentWithUser>;
  };
  setting: {
    findUnique: (args: unknown) => Promise<SettingRecord>;
  };
  user: {
    findUniqueOrThrow: (args: unknown) => Promise<UserRecord | UserUsernameRecord>;
    update: (args: unknown) => Promise<unknown>;
  };
  commonAccess: {
    upsert: (args: unknown) => Promise<unknown>;
  };
};

const {
  mockTransaction,
  mockUpdateMany,
  mockFindUnique,
  mockFindUniqueOrThrow,
  mockSettingFindUnique,
  mockUserFindUniqueOrThrow,
  mockUserUpdate,
  mockCommonAccessUpsert,
  mockCreateChatInviteLink,
  mockSendMessage,
  mockGetChat,
  mockRestrictChatMember,
  mockNotifyAdmins,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockTransaction:
    vi.fn<(callback: (tx: MockTxClient) => Promise<unknown>) => Promise<unknown>>(),
  mockUpdateMany: vi.fn<(args: unknown) => Promise<UpdateManyResult>>(),
  mockFindUnique: vi.fn<(args: unknown) => Promise<PaymentRecord | null>>(),
  mockFindUniqueOrThrow: vi.fn<(args: unknown) => Promise<PaymentWithUser>>(),
  mockSettingFindUnique: vi.fn<(args: unknown) => Promise<SettingRecord>>(),
  mockUserFindUniqueOrThrow:
    vi.fn<(args: unknown) => Promise<UserRecord | UserUsernameRecord>>(),
  mockUserUpdate: vi.fn<(args: unknown) => Promise<unknown>>(),
  mockCommonAccessUpsert: vi.fn<(args: unknown) => Promise<unknown>>(),
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
  mockLoggerError: vi.fn<(obj: unknown, msg?: string) => void>(),
}));

vi.mock('@tg-bot/db', () => ({
  PaymentStatus: {
    PENDING: 'PENDING',
    PAID: 'PAID',
  },
  ProductType: {
    SUBSCRIPTION: 'SUBSCRIPTION',
    LIFETIME: 'LIFETIME',
  },
  UserStatus: {
    NEW: 'NEW',
    ACTIVE: 'ACTIVE',
    MUTED: 'MUTED',
  },
  prisma: {
    $transaction: mockTransaction,
  },
}));

vi.mock('../src/bot/bot.js', () => ({
  subscriptionBot: {
    api: {
      createChatInviteLink: mockCreateChatInviteLink,
      sendMessage: mockSendMessage,
      getChat: mockGetChat,
      restrictChatMember: mockRestrictChatMember,
    },
  },
  commonBot: {
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
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
  },
}));

import { commonBot, subscriptionBot } from '../src/bot/bot.js';
import { config } from '../src/config.js';
import { registerRobokassaWebhook } from '../src/payments/webhook.js';

const GROUP_PERMISSIONS = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
};

function buildValidSignature(outSum: string, invId: number): string {
  return createHash('md5')
    .update(`${outSum}:${invId}:${config.ROBO_PASS2}`)
    .digest('hex');
}

async function createTestApp() {
  const app = Fastify({ logger: false });
  await app.register(formbody);
  registerRobokassaWebhook(app);
  await app.ready();
  return app;
}

function postWebhook(
  app: Awaited<ReturnType<typeof createTestApp>>,
  payload: Record<string, string>,
) {
  const body = new URLSearchParams(payload).toString();
  return app.inject({
    method: 'POST',
    url: '/robokassa/result',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: body,
  });
}

describe('POST /robokassa/result', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindUnique.mockResolvedValue(null);
    mockFindUniqueOrThrow.mockResolvedValue({
      id: 42,
      userId: BigInt(1),
      product: 'SUBSCRIPTION',
      amount: { toString: () => '500.00' },
    });
    mockSettingFindUnique.mockResolvedValue({ value: '30' });
    mockUserFindUniqueOrThrow.mockImplementation((args: unknown) => {
      const select = (args as { select?: { username?: boolean; status?: boolean } }).select;
      if (select?.username !== undefined) {
        return Promise.resolve({ username: 'testuser' });
      }
      return Promise.resolve({
        status: 'ACTIVE',
        expiresAt: null,
      });
    });
    mockUserUpdate.mockResolvedValue({});
    mockCommonAccessUpsert.mockResolvedValue({});
    mockCreateChatInviteLink.mockResolvedValue({
      invite_link: 'https://t.me/joinchat/test-invite',
    });
    mockSendMessage.mockResolvedValue({});
    mockNotifyAdmins.mockResolvedValue(undefined);
    mockGetChat.mockResolvedValue({ permissions: GROUP_PERMISSIONS });
    mockRestrictChatMember.mockResolvedValue({});

    mockTransaction.mockImplementation((callback) =>
      callback({
        payment: {
          updateMany: mockUpdateMany,
          findUnique: mockFindUnique,
          findUniqueOrThrow: mockFindUniqueOrThrow,
        },
        setting: {
          findUnique: mockSettingFindUnique,
        },
        user: {
          findUniqueOrThrow: mockUserFindUniqueOrThrow,
          update: mockUserUpdate,
        },
        commonAccess: {
          upsert: mockCommonAccessUpsert,
        },
      }),
    );
  });

  it('processes valid webhook and returns OK{InvId}', async () => {
    const app = await createTestApp();
    const outSum = '500.00';
    const invId = 42;

    const response = await postWebhook(app, {
      OutSum: outSum,
      InvId: String(invId),
      SignatureValue: buildValidSignature(outSum, invId),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(`OK${invId}`);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: invId, status: 'PENDING' },
      data: { status: 'PAID', paidAt: expect.any(Date) as unknown },
    });
    expect(mockUserUpdate).toHaveBeenCalledOnce();
    expect(mockCreateChatInviteLink).toHaveBeenCalledOnce();
    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    expect(mockNotifyAdmins.mock.calls[0]?.[0]).toBe(subscriptionBot);

    await app.close();
  });

  it('returns 400 on invalid signature without touching the database', async () => {
    const app = await createTestApp();

    const response = await postWebhook(app, {
      OutSum: '500.00',
      InvId: '42',
      SignatureValue: 'invalid-signature',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toBe('Bad Request');
    expect(mockTransaction).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns OK for already PAID payment without extending subscription again', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockFindUnique.mockResolvedValue({ id: 42, status: 'PAID' });

    const app = await createTestApp();
    const outSum = '500.00';
    const invId = 42;

    const response = await postWebhook(app, {
      OutSum: outSum,
      InvId: String(invId),
      SignatureValue: buildValidSignature(outSum, invId),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(`OK${invId}`);
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockFindUniqueOrThrow).not.toHaveBeenCalled();
    expect(mockCreateChatInviteLink).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockNotifyAdmins).not.toHaveBeenCalled();

    await app.close();
  });

  it('processes LIFETIME payment with CommonAccess upsert without touching user', async () => {
    mockFindUniqueOrThrow.mockResolvedValue({
      id: 42,
      userId: BigInt(99),
      product: 'LIFETIME',
      amount: { toString: () => '500.00' },
    });

    const app = await createTestApp();
    const outSum = '500.00';
    const invId = 42;

    const response = await postWebhook(app, {
      OutSum: outSum,
      InvId: String(invId),
      SignatureValue: buildValidSignature(outSum, invId),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(`OK${invId}`);
    expect(mockCommonAccessUpsert).toHaveBeenCalledWith({
      where: { userId: BigInt(99) },
      create: { userId: BigInt(99), paidAt: expect.any(Date) as unknown },
      update: { paidAt: expect.any(Date) as unknown },
    });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockSettingFindUnique).not.toHaveBeenCalled();
    expect(mockCreateChatInviteLink).toHaveBeenCalledOnce();
    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    expect(mockNotifyAdmins.mock.calls[0]?.[0]).toBe(commonBot);

    await app.close();
  });

  it('returns OK for already PAID LIFETIME payment without upserting CommonAccess again', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockFindUnique.mockResolvedValue({ id: 42, status: 'PAID' });

    const app = await createTestApp();
    const outSum = '500.00';
    const invId = 42;

    const response = await postWebhook(app, {
      OutSum: outSum,
      InvId: String(invId),
      SignatureValue: buildValidSignature(outSum, invId),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(`OK${invId}`);
    expect(mockCommonAccessUpsert).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockFindUniqueOrThrow).not.toHaveBeenCalled();
    expect(mockCreateChatInviteLink).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockNotifyAdmins).not.toHaveBeenCalled();

    await app.close();
  });

  it('still returns OK{InvId} and alerts admins when createChatInviteLink fails after commit', async () => {
    mockCreateChatInviteLink.mockRejectedValue(new Error('telegram createChatInviteLink failed'));

    const app = await createTestApp();
    const outSum = '500.00';
    const invId = 42;

    const response = await postWebhook(app, {
      OutSum: outSum,
      InvId: String(invId),
      SignatureValue: buildValidSignature(outSum, invId),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(`OK${invId}`);
    expect(mockUserUpdate).toHaveBeenCalledOnce();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ invId }),
      'robokassa webhook: failed to grant access after payment',
    );
    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    const [, alertText] = mockNotifyAdmins.mock.calls[0] ?? [];
    expect(alertText).toContain('Ошибка выдачи доступа');
    expect(alertText).not.toContain('Оплата от');

    await app.close();
  });

  it('still returns OK{InvId} and alerts admins when sendMessage fails after the invite link was created', async () => {
    mockSendMessage.mockRejectedValue(new Error('telegram sendMessage failed'));

    const app = await createTestApp();
    const outSum = '500.00';
    const invId = 42;

    const response = await postWebhook(app, {
      OutSum: outSum,
      InvId: String(invId),
      SignatureValue: buildValidSignature(outSum, invId),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(`OK${invId}`);
    expect(mockCreateChatInviteLink).toHaveBeenCalledOnce();
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ invId }),
      'robokassa webhook: failed to grant access after payment',
    );
    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    const [, alertText] = mockNotifyAdmins.mock.calls[0] ?? [];
    expect(alertText).toContain('Ошибка выдачи доступа');
    expect(alertText).not.toContain('Оплата от');

    await app.close();
  });

  it('unmutes MUTED user after SUBSCRIPTION payment via getChat and restrictChatMember', async () => {
    mockUserFindUniqueOrThrow.mockImplementation((args: unknown) => {
      const select = (args as { select?: { username?: boolean; status?: boolean } }).select;
      if (select?.username !== undefined) {
        return Promise.resolve({ username: 'testuser' });
      }
      return Promise.resolve({
        status: 'MUTED',
        expiresAt: new Date('2026-01-01T12:00:00.000Z'),
      });
    });

    const app = await createTestApp();
    const outSum = '500.00';
    const invId = 42;

    const response = await postWebhook(app, {
      OutSum: outSum,
      InvId: String(invId),
      SignatureValue: buildValidSignature(outSum, invId),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(`OK${invId}`);
    expect(mockGetChat).toHaveBeenCalledWith(config.GROUP_ID.toString());
    expect(mockRestrictChatMember).toHaveBeenCalledWith(
      config.GROUP_ID.toString(),
      1,
      GROUP_PERMISSIONS,
    );

    await app.close();
  });

  it('does not unmute ACTIVE user after SUBSCRIPTION payment', async () => {
    const app = await createTestApp();
    const outSum = '500.00';
    const invId = 42;

    const response = await postWebhook(app, {
      OutSum: outSum,
      InvId: String(invId),
      SignatureValue: buildValidSignature(outSum, invId),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(`OK${invId}`);
    expect(mockGetChat).not.toHaveBeenCalled();
    expect(mockRestrictChatMember).not.toHaveBeenCalled();

    await app.close();
  });

  it('does not unmute NEW user after SUBSCRIPTION payment', async () => {
    mockUserFindUniqueOrThrow.mockImplementation((args: unknown) => {
      const select = (args as { select?: { username?: boolean; status?: boolean } }).select;
      if (select?.username !== undefined) {
        return Promise.resolve({ username: 'testuser' });
      }
      return Promise.resolve({
        status: 'NEW',
        expiresAt: null,
      });
    });

    const app = await createTestApp();
    const outSum = '500.00';
    const invId = 42;

    const response = await postWebhook(app, {
      OutSum: outSum,
      InvId: String(invId),
      SignatureValue: buildValidSignature(outSum, invId),
    });

    expect(response.statusCode).toBe(200);
    expect(mockGetChat).not.toHaveBeenCalled();
    expect(mockRestrictChatMember).not.toHaveBeenCalled();

    await app.close();
  });

  it('never unmutes on LIFETIME payment even if user was MUTED', async () => {
    mockFindUniqueOrThrow.mockResolvedValue({
      id: 42,
      userId: BigInt(99),
      product: 'LIFETIME',
      amount: { toString: () => '500.00' },
    });
    mockUserFindUniqueOrThrow.mockImplementation((args: unknown) => {
      const select = (args as { select?: { username?: boolean; status?: boolean } }).select;
      if (select?.username !== undefined) {
        return Promise.resolve({ username: 'testuser' });
      }
      return Promise.resolve({
        status: 'MUTED',
        expiresAt: new Date('2026-01-01T12:00:00.000Z'),
      });
    });

    const app = await createTestApp();
    const outSum = '500.00';
    const invId = 42;

    const response = await postWebhook(app, {
      OutSum: outSum,
      InvId: String(invId),
      SignatureValue: buildValidSignature(outSum, invId),
    });

    expect(response.statusCode).toBe(200);
    expect(mockGetChat).not.toHaveBeenCalled();
    expect(mockRestrictChatMember).not.toHaveBeenCalled();

    await app.close();
  });

  it('still returns OK{InvId} and alerts admins when unmute fails after commit', async () => {
    mockUserFindUniqueOrThrow.mockImplementation((args: unknown) => {
      const select = (args as { select?: { username?: boolean; status?: boolean } }).select;
      if (select?.username !== undefined) {
        return Promise.resolve({ username: 'testuser' });
      }
      return Promise.resolve({
        status: 'MUTED',
        expiresAt: new Date('2026-01-01T12:00:00.000Z'),
      });
    });
    mockGetChat.mockRejectedValue(new Error('telegram getChat failed'));

    const app = await createTestApp();
    const outSum = '500.00';
    const invId = 42;

    const response = await postWebhook(app, {
      OutSum: outSum,
      InvId: String(invId),
      SignatureValue: buildValidSignature(outSum, invId),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(`OK${invId}`);
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ userId: '1' }),
      'payment: failed to unmute user after payment',
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ invId }),
      'robokassa webhook: failed to unmute user after payment',
    );
    expect(mockNotifyAdmins).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Ошибка unmute после оплаты'),
    );

    await app.close();
  });
});
