import type { Context } from 'grammy';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type UpsertArgs = {
  where: { userId_date: { userId: bigint; date: Date } };
  create: { userId: bigint; date: Date; messageCount: number };
  update: { messageCount: { increment: number } };
};

const { mockGroupActivityUpsert, mockLoggerError } = vi.hoisted(() => ({
  mockGroupActivityUpsert: vi.fn<(args: UpsertArgs) => Promise<unknown>>(),
  mockLoggerError: vi.fn<(obj: unknown, msg?: string) => void>(),
}));

vi.mock('@tg-bot/db', () => ({
  prisma: {
    groupActivity: { upsert: mockGroupActivityUpsert },
  },
}));

vi.mock('../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mockLoggerError },
}));

import { config } from '../src/config.js';
import { handleGroupActivityMessage } from '../src/bot/handlers/groupActivity.js';

function buildContext(overrides: {
  chatId?: bigint;
  userId?: number;
  isBot?: boolean;
}): Context {
  const { chatId = config.GROUP_ID, userId = 555, isBot = false } = overrides;
  return {
    chat: { id: Number(chatId), type: 'supergroup' },
    from: { id: userId, is_bot: isBot, first_name: 'User' },
  } as unknown as Context;
}

describe('handleGroupActivityMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:00:00.000Z'));
    mockGroupActivityUpsert.mockResolvedValue({});
  });

  it('upserts a GroupActivity row for a message in the closed group', async () => {
    const ctx = buildContext({ userId: 777 });

    await handleGroupActivityMessage(ctx);

    expect(mockGroupActivityUpsert).toHaveBeenCalledWith({
      where: { userId_date: { userId: BigInt(777), date: new Date('2026-01-15T00:00:00.000Z') } },
      create: { userId: BigInt(777), date: new Date('2026-01-15T00:00:00.000Z'), messageCount: 1 },
      update: { messageCount: { increment: 1 } },
    });
  });

  it('ignores messages from bots', async () => {
    const ctx = buildContext({ isBot: true });

    await handleGroupActivityMessage(ctx);

    expect(mockGroupActivityUpsert).not.toHaveBeenCalled();
  });

  it('ignores messages outside the closed group', async () => {
    const ctx = buildContext({ chatId: BigInt(999999) });

    await handleGroupActivityMessage(ctx);

    expect(mockGroupActivityUpsert).not.toHaveBeenCalled();
  });

  it('logs and does not throw when the upsert fails', async () => {
    mockGroupActivityUpsert.mockRejectedValue(new Error('db unavailable'));
    const ctx = buildContext({ userId: 42 });

    await expect(handleGroupActivityMessage(ctx)).resolves.toBeUndefined();

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ userId: '42' }),
      expect.stringContaining('failed to record message'),
    );
  });

  it('buckets the message under the Moscow calendar day, not the UTC day', async () => {
    // 23:30 UTC on 2026-01-15 is already 02:30 MSK on 2026-01-16.
    vi.setSystemTime(new Date('2026-01-15T23:30:00.000Z'));
    const ctx = buildContext({ userId: 1 });

    await handleGroupActivityMessage(ctx);

    const call = mockGroupActivityUpsert.mock.calls[0]?.[0] as UpsertArgs;
    expect(call.create.date).toEqual(new Date('2026-01-16T00:00:00.000Z'));
  });
});
