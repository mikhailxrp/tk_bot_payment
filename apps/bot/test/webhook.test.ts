import { createHash } from 'node:crypto';
import formbody from '@fastify/formbody';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type UpdateManyResult = { count: number };
type PaymentRecord = { id: number; status: string };
type PaymentWithUser = { id: number; userId: bigint; product: string };
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
    findUniqueOrThrow: (args: unknown) => Promise<UserRecord>;
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
} = vi.hoisted(() => ({
  mockTransaction:
    vi.fn<(callback: (tx: MockTxClient) => Promise<unknown>) => Promise<unknown>>(),
  mockUpdateMany: vi.fn<(args: unknown) => Promise<UpdateManyResult>>(),
  mockFindUnique: vi.fn<(args: unknown) => Promise<PaymentRecord | null>>(),
  mockFindUniqueOrThrow: vi.fn<(args: unknown) => Promise<PaymentWithUser>>(),
  mockSettingFindUnique: vi.fn<(args: unknown) => Promise<SettingRecord>>(),
  mockUserFindUniqueOrThrow: vi.fn<(args: unknown) => Promise<UserRecord>>(),
  mockUserUpdate: vi.fn<(args: unknown) => Promise<unknown>>(),
  mockCommonAccessUpsert: vi.fn<(args: unknown) => Promise<unknown>>(),
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
    ACTIVE: 'ACTIVE',
    EXPIRED: 'EXPIRED',
    MUTED: 'MUTED',
  },
  prisma: {
    $transaction: mockTransaction,
  },
}));

import { config } from '../src/config.js';
import { registerRobokassaWebhook } from '../src/payments/webhook.js';

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
    });
    mockSettingFindUnique.mockResolvedValue({ value: '30' });
    mockUserFindUniqueOrThrow.mockResolvedValue({
      status: 'ACTIVE',
      expiresAt: null,
    });
    mockUserUpdate.mockResolvedValue({});
    mockCommonAccessUpsert.mockResolvedValue({});

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

    await app.close();
  });

  it('processes LIFETIME payment with CommonAccess upsert without touching user', async () => {
    mockFindUniqueOrThrow.mockResolvedValue({
      id: 42,
      userId: BigInt(99),
      product: 'LIFETIME',
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

    await app.close();
  });
});
