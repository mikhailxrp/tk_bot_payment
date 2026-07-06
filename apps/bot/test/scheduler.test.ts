import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSettingFindUnique, mockRunDailyCheck, mockLoggerWarn, mockLoggerError } = vi.hoisted(
  () => ({
    mockSettingFindUnique:
      vi.fn<(args: { where: { key: string } }) => Promise<{ value: string } | null>>(),
    mockRunDailyCheck: vi.fn<() => Promise<{ ranNow: boolean }>>(),
    mockLoggerWarn: vi.fn<(obj: unknown, msg?: string) => void>(),
    mockLoggerError: vi.fn<(obj: unknown, msg?: string) => void>(),
  }),
);

vi.mock('@tg-bot/db', () => ({
  prisma: {
    setting: {
      findUnique: mockSettingFindUnique,
    },
  },
}));

vi.mock('../src/jobs/dailyCheck.js', () => ({
  runDailyCheck: mockRunDailyCheck,
}));

vi.mock('../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: mockLoggerWarn, error: mockLoggerError },
}));

import {
  resetSchedulerDayGuardForTests,
  schedulerTick,
} from '../src/jobs/scheduler.js';
import {
  cronTimeMatchesNow,
  getMoscowCalendarDate,
  getMoscowDayBounds,
  getMoscowTimeHHmm,
} from '../src/util/moscowDate.js';

describe('moscowDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses Moscow calendar date at midnight boundary (UTC 21:00 previous day = next MSK day)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-14T21:00:00.000Z'));

    expect(getMoscowCalendarDate()).toBe('2026-01-15');
    expect(getMoscowTimeHHmm()).toBe('00:00');
  });

  it('computes Moscow day bounds for payments today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:00:00.000Z'));

    const { start, end } = getMoscowDayBounds();
    expect(start.toISOString()).toBe('2026-01-14T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-15T20:59:59.999Z');
  });
});

describe('schedulerTick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetSchedulerDayGuardForTests();
    mockRunDailyCheck.mockResolvedValue({ ranNow: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs daily check once when current Moscow HH:mm matches cron_time', async () => {
    vi.setSystemTime(new Date('2026-01-15T06:00:00.000Z'));
    mockSettingFindUnique.mockResolvedValue({ value: '09:00' });

    await schedulerTick();
    await schedulerTick();

    expect(mockRunDailyCheck).toHaveBeenCalledOnce();
  });

  it('does not run again on repeated ticks in the same Moscow day', async () => {
    vi.setSystemTime(new Date('2026-01-15T06:00:00.000Z'));
    mockSettingFindUnique.mockResolvedValue({ value: '09:00' });

    await schedulerTick();
    vi.setSystemTime(new Date('2026-01-15T06:01:00.000Z'));
    await schedulerTick();

    expect(mockRunDailyCheck).toHaveBeenCalledOnce();
  });

  it('picks up cron_time changes between ticks without restart', async () => {
    vi.setSystemTime(new Date('2026-01-15T07:00:00.000Z'));
    mockSettingFindUnique.mockResolvedValue({ value: '09:00' });
    await schedulerTick();
    expect(mockRunDailyCheck).not.toHaveBeenCalled();

    mockSettingFindUnique.mockResolvedValue({ value: '10:00' });
    await schedulerTick();
    expect(mockRunDailyCheck).toHaveBeenCalledOnce();
  });

  it('logs warn and skips tick for malformed cron_time without throwing', async () => {
    vi.setSystemTime(new Date('2026-01-15T06:00:00.000Z'));
    mockSettingFindUnique.mockResolvedValue({ value: '9:00' });

    await expect(schedulerTick()).resolves.toBeUndefined();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      { cronTime: '9:00' },
      expect.stringContaining('malformed cron_time'),
    );
    expect(mockRunDailyCheck).not.toHaveBeenCalled();
  });

  it('allows a new run after Moscow midnight even if cron_time matches again', async () => {
    vi.setSystemTime(new Date('2026-01-15T06:00:00.000Z'));
    mockSettingFindUnique.mockResolvedValue({ value: '09:00' });
    await schedulerTick();
    expect(mockRunDailyCheck).toHaveBeenCalledOnce();

    resetSchedulerDayGuardForTests();
    vi.setSystemTime(new Date('2026-01-16T06:00:00.000Z'));
    await schedulerTick();
    expect(mockRunDailyCheck).toHaveBeenCalledTimes(2);
  });

  it('does not run when Moscow time does not match cron_time', async () => {
    vi.setSystemTime(new Date('2026-01-15T07:00:00.000Z'));
    mockSettingFindUnique.mockResolvedValue({ value: '09:00' });

    await schedulerTick();

    expect(mockRunDailyCheck).not.toHaveBeenCalled();
  });
});

describe('cronTimeMatchesNow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('matches HH:mm in Europe/Moscow', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T06:00:00.000Z'));
    expect(cronTimeMatchesNow('09:00')).toBe(true);
    expect(cronTimeMatchesNow('08:59')).toBe(false);
  });
});
