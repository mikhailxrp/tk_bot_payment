import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FixtureUser = {
  id: bigint;
  username: string | null;
  status: string;
  expiresAt: Date | null;
  mutedAt: Date | null;
};

type FindManyArgs = {
  where: { status: string; expiresAt: { lte: Date } };
  select: { id: true; username: true };
};

type UpdateManyArgs = {
  where: { id: bigint; status: string; expiresAt: { lte: Date } };
  data: { status: string; mutedAt: Date };
};

type SettingFindArgs = { where: { key: string } };

const {
  mockRestrictChatMember,
  mockSendMessage,
  mockNotifyAdmins,
  mockSettingFindUnique,
  mockPaymentCreate,
  mockLoggerWarn,
  mockLoggerError,
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

  function fakeFindMany(args: FindManyArgs) {
    const matches = state.users.filter(
      (u) =>
        u.status === args.where.status &&
        u.expiresAt !== null &&
        u.expiresAt.getTime() <= args.where.expiresAt.lte.getTime(),
    );
    return Promise.resolve(matches.map((u) => ({ id: u.id, username: u.username })));
  }

  function fakeUpdateMany(args: UpdateManyArgs) {
    const user = state.users.find(
      (u) =>
        u.id === args.where.id &&
        u.status === args.where.status &&
        u.expiresAt !== null &&
        u.expiresAt.getTime() <= args.where.expiresAt.lte.getTime(),
    );

    if (!user) {
      return Promise.resolve({ count: 0 });
    }

    user.status = args.data.status;
    user.mutedAt = args.data.mutedAt;
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
  bot: {
    api: {
      restrictChatMember: mockRestrictChatMember,
      sendMessage: mockSendMessage,
    },
  },
}));

vi.mock('../src/services/notify.js', () => ({
  notifyAdmins: mockNotifyAdmins,
}));

vi.mock('../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: mockLoggerWarn, error: mockLoggerError },
}));

import { runDailyCheck } from '../src/jobs/dailyCheck.js';

const NOW = new Date('2026-01-15T12:00:00.000Z');

function makeUser(overrides: Partial<FixtureUser> & { id: bigint }): FixtureUser {
  return {
    username: null,
    status: 'ACTIVE',
    expiresAt: null,
    mutedAt: null,
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

    await runDailyCheck();

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

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ userId: '8' }),
      expect.stringContaining('failed to send'),
    );
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockNotifyAdmins).toHaveBeenCalledOnce();
    const [, summary] = mockNotifyAdmins.mock.calls[0] ?? [];
    expect(summary).toContain('замьючено 2');
  });

  it('skips processing and logs when GET_LOCK is not acquired (concurrent run)', async () => {
    const user = makeUser({ id: BigInt(10), expiresAt: new Date(NOW.getTime() - 1000) });
    fixtureState.users = [user];

    const [, second] = await Promise.all([runDailyCheck(), runDailyCheck()]);

    expect(second).toBeUndefined();
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
});
