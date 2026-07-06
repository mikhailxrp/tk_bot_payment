import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FixtureUser = {
  id: bigint;
  username: string | null;
  status: string;
  expiresAt: Date | null;
  mutedAt: Date | null;
  reminderSentAt: Date | null;
  lastMutedRemindAt: Date | null;
};

type FieldCondition = { gt?: Date; lte?: Date } | Date | string | null;

type WhereClause = {
  OR?: WhereClause[];
  id?: bigint;
  status?: string;
  expiresAt?: FieldCondition;
  mutedAt?: FieldCondition;
  lastMutedRemindAt?: FieldCondition;
  reminderSentAt?: FieldCondition;
};

type FindManyArgs = { where: WhereClause; select: { id: true; username: true } };
type UpdateManyArgs = { where: WhereClause; data: Record<string, unknown> };

type SettingFindArgs = { where: { key: string } };

const {
  mockRestrictChatMember,
  mockSendMessage,
  mockNotifyAdmins,
  mockSettingFindUnique,
  mockPaymentCreate,
  mockLoggerWarn,
  mockLoggerError,
  mockLoggerInfo,
  fixtureState,
  fakeTx,
  mockTransaction,
} = vi.hoisted(() => {
  // In-memory fake standing in for the MySQL row set, so `lte`/atomic-guard semantics are
  // exercised for real instead of being asserted only on call args.
  const state: { users: FixtureUser[]; lockHeld: boolean; queryRawCalls: string[] } = {
    users: [],
    lockHeld: false,
    queryRawCalls: [],
  };

  function matchesField(value: Date | null, condition: FieldCondition | undefined): boolean {
    if (condition === undefined) {
      return true;
    }
    if (condition === null) {
      return value === null;
    }
    if (condition instanceof Date) {
      return value !== null && value.getTime() === condition.getTime();
    }
    if (typeof condition === 'object') {
      if (condition.gt && !(value !== null && value.getTime() > condition.gt.getTime())) {
        return false;
      }
      if (condition.lte && !(value !== null && value.getTime() <= condition.lte.getTime())) {
        return false;
      }
      return true;
    }
    return true;
  }

  function matchesWhere(user: FixtureUser, where: WhereClause): boolean {
    if (where.OR && !where.OR.some((clause) => matchesWhere(user, clause))) {
      return false;
    }
    if (where.id !== undefined && user.id !== where.id) {
      return false;
    }
    if (where.status !== undefined && user.status !== where.status) {
      return false;
    }
    if (!matchesField(user.expiresAt, where.expiresAt)) {
      return false;
    }
    if (!matchesField(user.mutedAt, where.mutedAt)) {
      return false;
    }
    if (!matchesField(user.lastMutedRemindAt, where.lastMutedRemindAt)) {
      return false;
    }
    if (!matchesField(user.reminderSentAt, where.reminderSentAt)) {
      return false;
    }
    return true;
  }

  function fakeFindMany(args: FindManyArgs) {
    const matches = state.users.filter((u) => matchesWhere(u, args.where));
    return Promise.resolve(matches.map((u) => ({ id: u.id, username: u.username })));
  }

  function fakeUpdateMany(args: UpdateManyArgs) {
    const user = state.users.find((u) => matchesWhere(u, args.where));

    if (!user) {
      return Promise.resolve({ count: 0 });
    }

    Object.assign(user, args.data);
    return Promise.resolve({ count: 1 });
  }

  function fakeQueryRaw(strings: TemplateStringsArray) {
    const sql = strings.join('?');
    state.queryRawCalls.push(sql);

    if (sql.includes('GET_LOCK')) {
      if (state.lockHeld) {
        return Promise.resolve([{ locked: 0 }]);
      }
      state.lockHeld = true;
      return Promise.resolve([{ locked: 1 }]);
    }

    if (sql.includes('RELEASE_LOCK')) {
      state.lockHeld = false;
      return Promise.resolve([{ locked: 1 }]);
    }

    throw new Error(`unexpected raw query in test: ${sql}`);
  }

  const tx = {
    user: {
      findMany: vi.fn(fakeFindMany),
      updateMany: vi.fn(fakeUpdateMany),
    },
    $queryRaw: vi.fn(fakeQueryRaw),
  };

  const transaction = vi.fn(
    async <T>(callback: (transactionClient: typeof tx) => Promise<T>): Promise<T> =>
      callback(tx),
  );

  return {
    mockRestrictChatMember:
      vi.fn<
        (
          chatId: string,
          userId: number,
          permissions: { can_send_messages: boolean },
        ) => Promise<unknown>
      >(),
    mockSendMessage:
      vi.fn<(chatId: string, text: string, options?: unknown) => Promise<unknown>>(),
    mockNotifyAdmins: vi.fn<(bot: unknown, text: string) => Promise<void>>(),
    mockSettingFindUnique: vi.fn<(args: SettingFindArgs) => Promise<{ value: string } | null>>(),
    mockPaymentCreate: vi.fn<(args: unknown) => Promise<{ id: number }>>(),
    mockLoggerWarn: vi.fn<(obj: unknown, msg?: string) => void>(),
    mockLoggerError: vi.fn<(obj: unknown, msg?: string) => void>(),
    mockLoggerInfo: vi.fn<(obj: unknown, msg?: string) => void>(),
    fixtureState: state,
    fakeTx: tx,
    mockTransaction: transaction,
  };
});

vi.mock('@tg-bot/db', () => ({
  UserStatus: { NEW: 'NEW', ACTIVE: 'ACTIVE', MUTED: 'MUTED', LEFT: 'LEFT' },
  PaymentStatus: { PENDING: 'PENDING', PAID: 'PAID', FAILED: 'FAILED' },
  prisma: {
    $transaction: mockTransaction,
    setting: { findUnique: mockSettingFindUnique },
    payment: { create: mockPaymentCreate },
  },
}));

vi.mock('../src/bot/bot.js', () => ({
  subscriptionBot: {
    api: {
      restrictChatMember: mockRestrictChatMember,
      sendMessage: mockSendMessage,
    },
  },
}));

vi.mock('../src/services/notify.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/notify.js')>();
  return {
    ...actual,
    notifyAdmins: mockNotifyAdmins,
    sendThrottledPersonalMessages: (
      bot: Parameters<typeof actual.sendThrottledPersonalMessages>[0],
      items: Parameters<typeof actual.sendThrottledPersonalMessages>[1],
      options?: Parameters<typeof actual.sendThrottledPersonalMessages>[2],
    ) =>
      actual.sendThrottledPersonalMessages(bot, items, {
        ...options,
        delay: () => Promise.resolve(),
      }),
  };
});

vi.mock('../src/logger.js', () => ({
  logger: { info: mockLoggerInfo, warn: mockLoggerWarn, error: mockLoggerError },
}));

import { runDailyCheck } from '../src/jobs/dailyCheck.js';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const REMIND_DAYS = 3;
const MUTED_REMIND_DAYS = 10;

function makeUser(overrides: Partial<FixtureUser> & { id: bigint }): FixtureUser {
  return {
    username: null,
    status: 'ACTIVE',
    expiresAt: null,
    mutedAt: null,
    reminderSentAt: null,
    lastMutedRemindAt: null,
    ...overrides,
  };
}

describe('runDailyCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    fixtureState.users = [];
    fixtureState.lockHeld = false;
    fixtureState.queryRawCalls.length = 0;

    mockRestrictChatMember.mockResolvedValue({});
    mockSendMessage.mockResolvedValue({});
    mockNotifyAdmins.mockResolvedValue(undefined);
    mockSettingFindUnique.mockImplementation(({ where }) => {
      if (where.key === 'price') {
        return Promise.resolve({ value: '990' });
      }
      if (where.key === 'period_days') {
        return Promise.resolve({ value: '30' });
      }
      if (where.key === 'remind_days') {
        return Promise.resolve({ value: String(REMIND_DAYS) });
      }
      if (where.key === 'muted_remind_days') {
        return Promise.resolve({ value: String(MUTED_REMIND_DAYS) });
      }
      return Promise.resolve(null);
    });
    mockPaymentCreate.mockResolvedValue({ id: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mutes an expired ACTIVE user, sets MUTED/mutedAt, sends a payment message, and notifies admins', async () => {
    const user = makeUser({
      id: BigInt(1),
      username: 'alice',
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    fixtureState.users = [user];

    const result = await runDailyCheck();

    expect(result).toEqual({ ranNow: true });
    expect(user.status).toBe('MUTED');
    expect(user.mutedAt?.getTime()).toBe(NOW.getTime());
    expect(mockRestrictChatMember).toHaveBeenCalledWith(
      expect.any(String),
      1,
      { can_send_messages: false },
    );
    expect(mockSendMessage).toHaveBeenCalledOnce();
    const [, , sendOptions] = mockSendMessage.mock.calls[0] ?? [];
    expect((sendOptions as { reply_markup?: unknown })?.reply_markup).toBeDefined();

    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    const [, summary] = mockNotifyAdmins.mock.calls[0] ?? [];
    expect(summary).toContain('замьючено 1');
    expect(summary).toContain('@alice');
  });

  it('mutes a user whose expiresAt is exactly now (inclusive boundary)', async () => {
    const user = makeUser({ id: BigInt(2), expiresAt: new Date(NOW.getTime()) });
    fixtureState.users = [user];

    await runDailyCheck();

    expect(user.status).toBe('MUTED');
  });

  it('does not touch a user whose expiresAt is 1 second in the future', async () => {
    const user = makeUser({ id: BigInt(3), expiresAt: new Date(NOW.getTime() + 1000) });
    fixtureState.users = [user];

    await runDailyCheck();

    expect(user.status).toBe('ACTIVE');
    expect(mockRestrictChatMember).not.toHaveBeenCalled();
  });

  it('never touches a user with no active SUBSCRIPTION (e.g. CommonAccess-only, status NEW)', async () => {
    const user = makeUser({
      id: BigInt(4),
      status: 'NEW',
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    fixtureState.users = [user];

    await runDailyCheck();

    expect(user.status).toBe('NEW');
    expect(mockRestrictChatMember).not.toHaveBeenCalled();
  });

  it('does not reprocess a user already MUTED (idempotent same-day rerun)', async () => {
    const user = makeUser({
      id: BigInt(5),
      status: 'MUTED',
      expiresAt: new Date(NOW.getTime() - 1000),
      mutedAt: new Date(NOW.getTime() - 500),
    });
    fixtureState.users = [user];

    await runDailyCheck();

    expect(mockRestrictChatMember).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('sends the admin summary with "замьючено 0" and does not early-return when nothing is expired', async () => {
    fixtureState.users = [];

    await runDailyCheck();

    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    const [, summary] = mockNotifyAdmins.mock.calls[0] ?? [];
    expect(summary).toContain('замьючено 0');
  });

  it('continues processing remaining users when restrictChatMember fails for one of them', async () => {
    const failing = makeUser({
      id: BigInt(6),
      username: 'bob',
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    const ok = makeUser({
      id: BigInt(7),
      username: 'carol',
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    fixtureState.users = [failing, ok];

    mockRestrictChatMember.mockImplementation((_chatId, userId) => {
      if (userId === 6) {
        return Promise.reject(new Error('telegram restrictChatMember failed'));
      }
      return Promise.resolve({});
    });

    await runDailyCheck();

    // Both users are muted in the DB (the guard already committed) even though the Telegram
    // enforcement call failed for one of them.
    expect(failing.status).toBe('MUTED');
    expect(ok.status).toBe('MUTED');
    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    const [, summary] = mockNotifyAdmins.mock.calls[0] ?? [];
    expect(summary).toContain('замьючено 2');
  });

  it('continues processing remaining users when sendMessage fails for one of them', async () => {
    const failing = makeUser({ id: BigInt(8), expiresAt: new Date(NOW.getTime() - 1000) });
    const ok = makeUser({ id: BigInt(9), expiresAt: new Date(NOW.getTime() - 1000) });
    fixtureState.users = [failing, ok];

    mockSendMessage.mockImplementation((chatId: string) => {
      if (chatId === '8') {
        return Promise.reject(new Error('telegram sendMessage failed'));
      }
      return Promise.resolve({});
    });

    await runDailyCheck();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: '8' }),
      'Failed to send throttled message',
    );
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    const [, summary] = mockNotifyAdmins.mock.calls[0] ?? [];
    expect(summary).toContain('замьючено 2');
  });

  it('skips processing and logs when GET_LOCK is not acquired (concurrent run)', async () => {
    const user = makeUser({ id: BigInt(10), expiresAt: new Date(NOW.getTime() - 1000) });
    fixtureState.users = [user];

    const [first, second] = await Promise.all([runDailyCheck(), runDailyCheck()]);

    expect(first).toEqual({ ranNow: true });
    expect(second).toEqual({ ranNow: false });
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ lockName: 'daily_check' }),
      expect.stringContaining('lock not acquired'),
    );
    // Only one run actually processed the candidate and notified admins.
    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    expect(user.status).toBe('MUTED');

    const getLockCalls = fixtureState.queryRawCalls.filter((sql) => sql.includes('GET_LOCK')).length;
    const releaseLockCalls = fixtureState.queryRawCalls.filter((sql) => sql.includes('RELEASE_LOCK')).length;
    expect(getLockCalls).toBe(2);
    // RELEASE_LOCK only runs for the run that actually acquired the lock.
    expect(releaseLockCalls).toBe(1);
  });

  it('still calls RELEASE_LOCK when an error is thrown while processing candidates', async () => {
    fakeTx.user.findMany.mockRejectedValueOnce(new Error('db exploded'));

    await expect(runDailyCheck()).rejects.toThrow('db exploded');

    const releaseLockCalls = fixtureState.queryRawCalls.filter((sql) => sql.includes('RELEASE_LOCK')).length;
    expect(releaseLockCalls).toBe(1);
    expect(fixtureState.lockHeld).toBe(false);
  });

  it('marks an active reminder and a muted reminder candidate in the same run', async () => {
    const activeCandidate = makeUser({
      id: BigInt(20),
      username: 'dave',
      expiresAt: new Date(NOW.getTime() + REMIND_DAYS * MS_PER_DAY),
    });
    const mutedCandidate = makeUser({
      id: BigInt(21),
      username: 'erin',
      status: 'MUTED',
      mutedAt: new Date(NOW.getTime() - MUTED_REMIND_DAYS * MS_PER_DAY),
    });
    fixtureState.users = [activeCandidate, mutedCandidate];

    await runDailyCheck();

    expect(activeCandidate.reminderSentAt?.getTime()).toBe(NOW.getTime());
    expect(mutedCandidate.lastMutedRemindAt?.getTime()).toBe(NOW.getTime());
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      { activeReminders: 1, mutedReminders: 1 },
      'daily check: reminder candidates selected',
    );
  });

  it('does not send a muted reminder to a user muted for the first time in this same run', async () => {
    // expiresAt in the past => gets muted by part 1 with mutedAt = NOW; the muted-reminder
    // window (mutedAt <= now - mutedRemindDays) must not match a mutedAt of exactly `now`.
    const freshlyMuted = makeUser({
      id: BigInt(22),
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    fixtureState.users = [freshlyMuted];

    await runDailyCheck();

    expect(freshlyMuted.status).toBe('MUTED');
    expect(freshlyMuted.mutedAt?.getTime()).toBe(NOW.getTime());
    expect(freshlyMuted.lastMutedRemindAt).toBeNull();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      { activeReminders: 0, mutedReminders: 0 },
      'daily check: reminder candidates selected',
    );
  });

  it('skips active reminders (but keeps mute + muted reminders working) when remind_days is invalid', async () => {
    mockSettingFindUnique.mockImplementation(({ where }) => {
      if (where.key === 'price') {
        return Promise.resolve({ value: '990' });
      }
      if (where.key === 'period_days') {
        return Promise.resolve({ value: '30' });
      }
      if (where.key === 'remind_days') {
        return Promise.resolve({ value: '0' });
      }
      if (where.key === 'muted_remind_days') {
        return Promise.resolve({ value: String(MUTED_REMIND_DAYS) });
      }
      return Promise.resolve(null);
    });

    const activeCandidate = makeUser({
      id: BigInt(23),
      expiresAt: new Date(NOW.getTime() + REMIND_DAYS * MS_PER_DAY),
    });
    const mutedCandidate = makeUser({
      id: BigInt(24),
      status: 'MUTED',
      mutedAt: new Date(NOW.getTime() - MUTED_REMIND_DAYS * MS_PER_DAY),
    });
    fixtureState.users = [activeCandidate, mutedCandidate];

    await runDailyCheck();

    expect(activeCandidate.reminderSentAt).toBeNull();
    expect(mutedCandidate.lastMutedRemindAt?.getTime()).toBe(NOW.getTime());
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      { key: 'remind_days' },
      'daily check: remind_days setting invalid/missing, skipping active reminders this run',
    );
  });

  it('skips muted reminders (but keeps mute + active reminders working) when muted_remind_days is missing', async () => {
    mockSettingFindUnique.mockImplementation(({ where }) => {
      if (where.key === 'price') {
        return Promise.resolve({ value: '990' });
      }
      if (where.key === 'period_days') {
        return Promise.resolve({ value: '30' });
      }
      if (where.key === 'remind_days') {
        return Promise.resolve({ value: String(REMIND_DAYS) });
      }
      return Promise.resolve(null);
    });

    const activeCandidate = makeUser({
      id: BigInt(25),
      expiresAt: new Date(NOW.getTime() + REMIND_DAYS * MS_PER_DAY),
    });
    const mutedCandidate = makeUser({
      id: BigInt(26),
      status: 'MUTED',
      mutedAt: new Date(NOW.getTime() - MUTED_REMIND_DAYS * MS_PER_DAY),
    });
    fixtureState.users = [activeCandidate, mutedCandidate];

    await runDailyCheck();

    expect(activeCandidate.reminderSentAt?.getTime()).toBe(NOW.getTime());
    expect(mutedCandidate.lastMutedRemindAt).toBeNull();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      { key: 'muted_remind_days' },
      'daily check: muted_remind_days setting invalid/missing, skipping muted reminders this run',
    );
  });

  it('never selects a CommonAccess-only user (status NEW) for either reminder type', async () => {
    const user = makeUser({
      id: BigInt(27),
      status: 'NEW',
      expiresAt: new Date(NOW.getTime() + REMIND_DAYS * MS_PER_DAY),
      mutedAt: new Date(NOW.getTime() - MUTED_REMIND_DAYS * MS_PER_DAY),
    });
    fixtureState.users = [user];

    await runDailyCheck();

    expect(user.reminderSentAt).toBeNull();
    expect(user.lastMutedRemindAt).toBeNull();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      { activeReminders: 0, mutedReminders: 0 },
      'daily check: reminder candidates selected',
    );
  });

  it('sends an active reminder with a payment-link keyboard and counts it in the summary', async () => {
    const activeCandidate = makeUser({
      id: BigInt(30),
      username: 'dave',
      expiresAt: new Date(NOW.getTime() + REMIND_DAYS * MS_PER_DAY),
    });
    fixtureState.users = [activeCandidate];

    await runDailyCheck();

    expect(activeCandidate.reminderSentAt?.getTime()).toBe(NOW.getTime());
    expect(mockSendMessage).toHaveBeenCalledOnce();
    const [chatId, text, sendOptions] = mockSendMessage.mock.calls[0] ?? [];
    expect(chatId).toBe('30');
    expect(text).toContain(String(REMIND_DAYS));
    expect((sendOptions as { reply_markup?: unknown })?.reply_markup).toBeDefined();

    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    const [, summary] = mockNotifyAdmins.mock.calls[0] ?? [];
    expect(summary).toContain('Напоминаний отправлено: активным 1, замьюченным 0');
  });

  it('sends a muted reminder with a payment-link keyboard and counts it in the summary', async () => {
    const mutedCandidate = makeUser({
      id: BigInt(31),
      username: 'erin',
      status: 'MUTED',
      mutedAt: new Date(NOW.getTime() - MUTED_REMIND_DAYS * MS_PER_DAY),
    });
    fixtureState.users = [mutedCandidate];

    await runDailyCheck();

    expect(mutedCandidate.lastMutedRemindAt?.getTime()).toBe(NOW.getTime());
    expect(mockSendMessage).toHaveBeenCalledOnce();
    const [chatId, , sendOptions] = mockSendMessage.mock.calls[0] ?? [];
    expect(chatId).toBe('31');
    expect((sendOptions as { reply_markup?: unknown })?.reply_markup).toBeDefined();

    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    const [, summary] = mockNotifyAdmins.mock.calls[0] ?? [];
    expect(summary).toContain('Напоминаний отправлено: активным 0, замьюченным 1');
  });

  it('summary contains zero reminder counters when nothing is selected', async () => {
    fixtureState.users = [];

    await runDailyCheck();

    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    const [, summary] = mockNotifyAdmins.mock.calls[0] ?? [];
    expect(summary).toContain('Напоминаний отправлено: активным 0, замьюченным 0');
  });

  it('does not send any message to a CommonAccess-only user (status NEW)', async () => {
    const user = makeUser({
      id: BigInt(32),
      status: 'NEW',
      expiresAt: new Date(NOW.getTime() + REMIND_DAYS * MS_PER_DAY),
      mutedAt: new Date(NOW.getTime() - MUTED_REMIND_DAYS * MS_PER_DAY),
    });
    fixtureState.users = [user];

    await runDailyCheck();

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('skips generating a reminder payment link failure without interrupting other candidates, and flags stay set', async () => {
    const activeCandidate = makeUser({
      id: BigInt(33),
      expiresAt: new Date(NOW.getTime() + REMIND_DAYS * MS_PER_DAY),
    });
    const mutedCandidate = makeUser({
      id: BigInt(34),
      status: 'MUTED',
      mutedAt: new Date(NOW.getTime() - MUTED_REMIND_DAYS * MS_PER_DAY),
    });
    fixtureState.users = [activeCandidate, mutedCandidate];

    mockSettingFindUnique.mockImplementation(({ where }) => {
      if (where.key === 'price') {
        return Promise.resolve(null);
      }
      if (where.key === 'period_days') {
        return Promise.resolve({ value: '30' });
      }
      if (where.key === 'remind_days') {
        return Promise.resolve({ value: String(REMIND_DAYS) });
      }
      if (where.key === 'muted_remind_days') {
        return Promise.resolve({ value: String(MUTED_REMIND_DAYS) });
      }
      return Promise.resolve(null);
    });

    await runDailyCheck();

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(activeCandidate.reminderSentAt?.getTime()).toBe(NOW.getTime());
    expect(mutedCandidate.lastMutedRemindAt?.getTime()).toBe(NOW.getTime());
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: '33' }),
      'daily check: subscription price/period settings unavailable, active reminder not sent',
    );
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: '34' }),
      'daily check: subscription price/period settings unavailable, muted reminder not sent',
    );

    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    const [, summary] = mockNotifyAdmins.mock.calls[0] ?? [];
    expect(summary).toContain('Напоминаний отправлено: активным 0, замьюченным 0');
  });

  it('continues sending reminders to remaining candidates when sendMessage fails for one', async () => {
    const activeCandidate = makeUser({
      id: BigInt(35),
      expiresAt: new Date(NOW.getTime() + REMIND_DAYS * MS_PER_DAY),
    });
    const mutedCandidate = makeUser({
      id: BigInt(36),
      status: 'MUTED',
      mutedAt: new Date(NOW.getTime() - MUTED_REMIND_DAYS * MS_PER_DAY),
    });
    fixtureState.users = [activeCandidate, mutedCandidate];

    mockSendMessage.mockImplementation((chatId: string) => {
      if (chatId === '35') {
        return Promise.reject(new Error('telegram sendMessage failed'));
      }
      return Promise.resolve({});
    });

    await runDailyCheck();

    // Flags stay set even though the send failed (best-effort, decision #D).
    expect(activeCandidate.reminderSentAt?.getTime()).toBe(NOW.getTime());
    expect(mutedCandidate.lastMutedRemindAt?.getTime()).toBe(NOW.getTime());

    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    const [, summary] = mockNotifyAdmins.mock.calls[0] ?? [];
    expect(summary).toContain('Напоминаний отправлено: активным 0, замьюченным 1');
  });
});
