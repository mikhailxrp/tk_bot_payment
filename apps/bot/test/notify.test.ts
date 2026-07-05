import type { Bot } from 'grammy';
import { GrammyError, HttpError } from 'grammy';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAdminFindMany, mockSendMessage, mockLoggerWarn } = vi.hoisted(() => ({
  mockAdminFindMany:
    vi.fn<() => Promise<Array<{ telegramId: bigint }>>>(),
  mockSendMessage:
    vi.fn<(chatId: string, text: string) => Promise<unknown>>(),
  mockLoggerWarn: vi.fn<(obj: unknown, msg?: string) => void>(),
}));

vi.mock('@tg-bot/db', () => ({
  prisma: {
    admin: {
      findMany: mockAdminFindMany,
    },
  },
}));

vi.mock('../src/logger.js', () => ({
  logger: {
    warn: mockLoggerWarn,
  },
}));

import {
  notifyAdmins,
  sendThrottledTextMessages,
  THROTTLE_INTERVAL_MS,
} from '../src/services/notify.js';

function createMockBot(): Bot {
  return {
    api: {
      sendMessage: mockSendMessage,
    },
  } as unknown as Bot;
}

function createGrammyError(errorCode: number, description: string): GrammyError {
  return new GrammyError(
    'Call to sendMessage failed',
    {
      ok: false,
      error_code: errorCode,
      description,
      parameters: {},
    },
    'sendMessage',
    { chat_id: '111', text: 'alert' },
  );
}

describe('sendThrottledTextMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
  });

  it('sends text to each chatId as string without delay before the first message', async () => {
    const bot = createMockBot();
    const delays: number[] = [];
    const chatIds = [111n, 222n];

    await sendThrottledTextMessages(bot, chatIds, 'hello', {
      delay: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockSendMessage).toHaveBeenNthCalledWith(1, '111', 'hello');
    expect(mockSendMessage).toHaveBeenNthCalledWith(2, '222', 'hello');
    expect(delays).toEqual([THROTTLE_INTERVAL_MS]);
  });

  it('throttles at most 25 messages per second (26 recipients → 25 delays)', async () => {
    const bot = createMockBot();
    const delays: number[] = [];
    const chatIds = Array.from({ length: 26 }, (_, index) => BigInt(index + 1));

    await sendThrottledTextMessages(bot, chatIds, 'bulk', {
      delay: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(26);
    expect(delays).toHaveLength(25);
    expect(delays.every((ms) => ms === THROTTLE_INTERVAL_MS)).toBe(true);
  });

  it('does nothing for an empty chatId list', async () => {
    const bot = createMockBot();
    const delay = vi.fn<(ms: number) => Promise<void>>();

    await sendThrottledTextMessages(bot, [], 'noop', { delay });

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(delay).not.toHaveBeenCalled();
  });

  it('logs GrammyError 403 and continues sending to other recipients', async () => {
    const bot = createMockBot();
    const forbiddenError = createGrammyError(
      403,
      'Forbidden: bot was blocked by the user',
    );

    mockSendMessage
      .mockRejectedValueOnce(forbiddenError)
      .mockResolvedValueOnce(undefined);

    await sendThrottledTextMessages(bot, [111n, 222n], 'alert');

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      {
        chatId: '111',
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      },
      'Failed to send throttled message',
    );
  });

  it('logs other GrammyError and continues sending to other recipients', async () => {
    const bot = createMockBot();
    const badRequestError = createGrammyError(400, 'Bad Request: chat not found');

    mockSendMessage
      .mockRejectedValueOnce(badRequestError)
      .mockResolvedValueOnce(undefined);

    await sendThrottledTextMessages(bot, [111n, 222n], 'alert');

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      {
        chatId: '111',
        error_code: 400,
        description: 'Bad Request: chat not found',
      },
      'Failed to send throttled message',
    );
  });

  it('logs HttpError and continues sending to other recipients', async () => {
    const bot = createMockBot();
    const networkError = new HttpError(
      'Network request for sendMessage failed',
      new Error('ECONNRESET'),
    );

    mockSendMessage
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(undefined);

    await sendThrottledTextMessages(bot, [111n, 222n], 'alert');

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      {
        chatId: '111',
        message: 'Network request for sendMessage failed',
      },
      'Failed to send throttled message',
    );
  });
});

describe('notifyAdmins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
  });

  it('sends text to every Admin.telegramId from the database', async () => {
    mockAdminFindMany.mockResolvedValue([
      { telegramId: 100n },
      { telegramId: 200n },
    ]);

    await notifyAdmins(createMockBot(), 'payment received');

    expect(mockAdminFindMany).toHaveBeenCalledWith({
      select: { telegramId: true },
    });
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockSendMessage).toHaveBeenNthCalledWith(1, '100', 'payment received');
    expect(mockSendMessage).toHaveBeenNthCalledWith(2, '200', 'payment received');
  });

  it('does not fail when there are no admins', async () => {
    mockAdminFindMany.mockResolvedValue([]);

    await expect(notifyAdmins(createMockBot(), 'noop')).resolves.toBeUndefined();

    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
