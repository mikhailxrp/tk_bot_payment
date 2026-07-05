import { UserStatus } from '@tg-bot/db';
import { describe, expect, it } from 'vitest';

import { calculateNewExpiresAt } from '../src/services/subscription.js';

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
