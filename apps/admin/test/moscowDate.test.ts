import { describe, expect, it } from 'vitest';

import {
  getMoscowCalendarDate,
  getMoscowCalendarDateKey,
  getMoscowDayBounds,
  getMoscowMonthBounds,
  lastNMoscowDateKeys,
} from '../lib/moscowDate.js';

describe('getMoscowCalendarDate', () => {
  it('returns the Moscow calendar date for a UTC instant already past MSK midnight', () => {
    // 23:30 UTC on Jan 15 is 02:30 MSK on Jan 16.
    expect(getMoscowCalendarDate(new Date('2026-01-15T23:30:00.000Z'))).toBe('2026-01-16');
  });

  it('returns the previous day for a UTC instant before MSK midnight', () => {
    expect(getMoscowCalendarDate(new Date('2026-01-15T20:30:00.000Z'))).toBe('2026-01-15');
  });
});

describe('getMoscowCalendarDateKey', () => {
  it('returns UTC midnight of the Moscow calendar date, not the real Moscow-midnight instant', () => {
    const key = getMoscowCalendarDateKey(new Date('2026-01-15T23:30:00.000Z'));
    expect(key).toEqual(new Date('2026-01-16T00:00:00.000Z'));
  });
});

describe('getMoscowDayBounds', () => {
  it('returns start/end spanning exactly the Moscow calendar day', () => {
    const { start, end } = getMoscowDayBounds(new Date('2026-01-15T12:00:00.000Z'));

    expect(start.toISOString()).toBe('2026-01-14T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-15T20:59:59.999Z');
  });
});

describe('getMoscowMonthBounds', () => {
  it('returns the first and last instant of the Moscow calendar month', () => {
    const { start, end } = getMoscowMonthBounds(new Date('2026-02-15T12:00:00.000Z'));

    expect(start.toISOString()).toBe('2026-01-31T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-02-28T20:59:59.999Z');
  });

  it('rolls over the year for December', () => {
    const { end } = getMoscowMonthBounds(new Date('2026-12-15T12:00:00.000Z'));

    expect(end.toISOString()).toBe('2026-12-31T20:59:59.999Z');
  });
});

describe('lastNMoscowDateKeys', () => {
  it('returns N consecutive calendar-day keys, oldest first, ending on the reference day', () => {
    const keys = lastNMoscowDateKeys(3, new Date('2026-01-15T10:00:00.000Z'));

    expect(keys).toEqual([
      new Date('2026-01-13T00:00:00.000Z'),
      new Date('2026-01-14T00:00:00.000Z'),
      new Date('2026-01-15T00:00:00.000Z'),
    ]);
  });
});
