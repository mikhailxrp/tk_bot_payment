import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSettingFindUnique, mockUserCount, mockPaymentGroupBy } = vi.hoisted(() => ({
  mockSettingFindUnique: vi.fn<(args: { where: { key: string } }) => Promise<{ value: string } | null>>(),
  mockUserCount: vi.fn<() => Promise<number>>(),
  mockPaymentGroupBy: vi.fn<(args: unknown) => Promise<unknown[]>>(),
}));

vi.mock('@tg-bot/db', () => ({
  UserStatus: { NEW: 'NEW', ACTIVE: 'ACTIVE', MUTED: 'MUTED', LEFT: 'LEFT' },
  PaymentStatus: { PENDING: 'PENDING', PAID: 'PAID', FAILED: 'FAILED' },
  ProductType: { SUBSCRIPTION: 'SUBSCRIPTION', LIFETIME: 'LIFETIME' },
  prisma: {
    setting: { findUnique: mockSettingFindUnique },
    user: { count: mockUserCount },
    payment: { groupBy: mockPaymentGroupBy },
  },
}));

import { getMRR } from '../lib/dashboard/revenue.js';

describe('getMRR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('multiplies active subscriber count by price, normalized to a 30-day month', async () => {
    mockSettingFindUnique.mockImplementation(({ where }) => {
      if (where.key === 'price') return Promise.resolve({ value: '990' });
      if (where.key === 'period_days') return Promise.resolve({ value: '30' });
      return Promise.resolve(null);
    });
    mockUserCount.mockResolvedValue(10);

    const result = await getMRR();

    expect(result).toBe(9900);
  });

  it('normalizes a non-30-day period to its monthly equivalent', async () => {
    mockSettingFindUnique.mockImplementation(({ where }) => {
      if (where.key === 'price') return Promise.resolve({ value: '100' });
      if (where.key === 'period_days') return Promise.resolve({ value: '10' });
      return Promise.resolve(null);
    });
    mockUserCount.mockResolvedValue(5);

    // 5 users * 100 * (30/10) = 1500
    const result = await getMRR();

    expect(result).toBe(1500);
  });

  it('returns 0 when price or period_days settings are missing/invalid', async () => {
    mockSettingFindUnique.mockResolvedValue(null);
    mockUserCount.mockResolvedValue(10);

    const result = await getMRR();

    expect(result).toBe(0);
  });
});
