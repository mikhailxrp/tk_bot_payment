import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUserCount,
  mockUserFindMany,
  mockPaymentGroupBy,
  mockPaymentFindMany,
} = vi.hoisted(() => ({
  mockUserCount: vi.fn<(args: { where: { status: string } }) => Promise<number>>(),
  mockUserFindMany: vi.fn<(args: unknown) => Promise<unknown[]>>(),
  mockPaymentGroupBy: vi.fn<(args: unknown) => Promise<unknown[]>>(),
  mockPaymentFindMany: vi.fn<(args: unknown) => Promise<unknown[]>>(),
}));

vi.mock('@tg-bot/db', () => ({
  UserStatus: { NEW: 'NEW', ACTIVE: 'ACTIVE', MUTED: 'MUTED', LEFT: 'LEFT' },
  PaymentStatus: { PENDING: 'PENDING', PAID: 'PAID', FAILED: 'FAILED' },
  ProductType: { SUBSCRIPTION: 'SUBSCRIPTION', LIFETIME: 'LIFETIME' },
  prisma: {
    user: { count: mockUserCount, findMany: mockUserFindMany },
    payment: { groupBy: mockPaymentGroupBy, findMany: mockPaymentFindMany },
  },
}));

import {
  getNewSubscribersCount,
  getStartToPaymentConversion,
  getStatusCounts,
  getWinBackRate,
} from '../lib/dashboard/subscribers.js';

describe('getStatusCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserCount.mockImplementation(({ where }: { where: { status: string } }) => {
      const counts: Record<string, number> = { ACTIVE: 5, MUTED: 2, LEFT: 1, NEW: 3 };
      return Promise.resolve(counts[where.status] ?? 0);
    });
  });

  it('returns counts for each status', async () => {
    const result = await getStatusCounts();

    expect(result).toEqual({ active: 5, muted: 2, left: 1, new: 3 });
  });
});

describe('getNewSubscribersCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const start = new Date('2026-01-01T00:00:00.000Z');
  const end = new Date('2026-01-31T23:59:59.999Z');

  it('counts users whose first-ever PAID subscription payment falls in the period', async () => {
    mockPaymentGroupBy.mockResolvedValue([
      { userId: BigInt(1), _min: { paidAt: new Date('2026-01-15T00:00:00.000Z') } }, // in period
      { userId: BigInt(2), _min: { paidAt: new Date('2025-12-31T00:00:00.000Z') } }, // before
      { userId: BigInt(3), _min: { paidAt: new Date('2026-02-01T00:00:00.000Z') } }, // after
      { userId: BigInt(4), _min: { paidAt: null } }, // no payment (shouldn't happen, but guard it)
    ]);

    const result = await getNewSubscribersCount(start, end);

    expect(result).toBe(1);
  });

  it('is inclusive of the exact boundary instants', async () => {
    mockPaymentGroupBy.mockResolvedValue([
      { userId: BigInt(1), _min: { paidAt: start } },
      { userId: BigInt(2), _min: { paidAt: end } },
    ]);

    const result = await getNewSubscribersCount(start, end);

    expect(result).toBe(2);
  });
});

describe('getStartToPaymentConversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns rate 0 without dividing by zero when no users were created', async () => {
    mockUserFindMany.mockResolvedValue([]);

    const result = await getStartToPaymentConversion(new Date(), new Date());

    expect(result).toEqual({ usersCreated: 0, usersPaid: 0, rate: 0 });
    expect(mockPaymentGroupBy).not.toHaveBeenCalled();
  });

  it('computes the share of created users who made at least one PAID payment', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: BigInt(1) },
      { id: BigInt(2) },
      { id: BigInt(3) },
      { id: BigInt(4) },
    ]);
    mockPaymentGroupBy.mockResolvedValue([{ userId: BigInt(1) }, { userId: BigInt(3) }]);

    const result = await getStartToPaymentConversion(new Date(), new Date());

    expect(result).toEqual({ usersCreated: 4, usersPaid: 2, rate: 0.5 });
  });
});

describe('getWinBackRate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns rate 0 without dividing by zero when nobody was muted in the period', async () => {
    mockUserFindMany.mockResolvedValue([]);

    const result = await getWinBackRate(new Date(), new Date());

    expect(result).toEqual({ everMuted: 0, wonBack: 0, rate: 0 });
    expect(mockPaymentFindMany).not.toHaveBeenCalled();
  });

  it('counts a muted user as won back only if a PAID payment happened after their mutedAt', async () => {
    const mutedAt1 = new Date('2026-01-10T00:00:00.000Z');
    const mutedAt2 = new Date('2026-01-12T00:00:00.000Z');
    mockUserFindMany.mockResolvedValue([
      { id: BigInt(1), mutedAt: mutedAt1 },
      { id: BigInt(2), mutedAt: mutedAt2 },
    ]);
    mockPaymentFindMany.mockResolvedValue([
      // user 1: paid AFTER being muted -> won back
      { userId: BigInt(1), paidAt: new Date('2026-01-11T00:00:00.000Z') },
      // user 2: paid BEFORE being muted this time (e.g. a stale payment) -> not won back
      { userId: BigInt(2), paidAt: new Date('2026-01-05T00:00:00.000Z') },
    ]);

    const result = await getWinBackRate(new Date(), new Date());

    expect(result).toEqual({ everMuted: 2, wonBack: 1, rate: 0.5 });
  });

  it('does not double-count a user with multiple qualifying payments', async () => {
    const mutedAt = new Date('2026-01-10T00:00:00.000Z');
    mockUserFindMany.mockResolvedValue([{ id: BigInt(1), mutedAt }]);
    mockPaymentFindMany.mockResolvedValue([
      { userId: BigInt(1), paidAt: new Date('2026-01-11T00:00:00.000Z') },
      { userId: BigInt(1), paidAt: new Date('2026-02-11T00:00:00.000Z') },
    ]);

    const result = await getWinBackRate(new Date(), new Date());

    expect(result).toEqual({ everMuted: 1, wonBack: 1, rate: 1 });
  });
});
