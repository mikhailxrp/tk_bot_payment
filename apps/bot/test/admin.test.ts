import type { Context, NextFunction } from 'grammy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type InlineButton = { text: string; callback_data?: string; url?: string };

type ReplyMarkup = {
  reply_markup?: { inline_keyboard: InlineButton[][] };
};

const {
  mockAdminFindUnique,
  mockUserCount,
  mockPaymentCount,
  mockRunDailyCheck,
} = vi.hoisted(() => ({
  mockAdminFindUnique:
    vi.fn<(args: { where: { telegramId: bigint } }) => Promise<{ telegramId: bigint } | null>>(),
  mockUserCount: vi.fn<(args: { where: { status: string } }) => Promise<number>>(),
  mockPaymentCount:
    vi.fn<
      (args: {
        where: { status: string; paidAt: { gte: Date; lte: Date } };
      }) => Promise<number>
    >(),
  mockRunDailyCheck: vi.fn<() => Promise<{ ranNow: boolean }>>(),
}));

vi.mock('@tg-bot/db', () => ({
  UserStatus: { NEW: 'NEW', ACTIVE: 'ACTIVE', MUTED: 'MUTED', LEFT: 'LEFT' },
  PaymentStatus: { PENDING: 'PENDING', PAID: 'PAID', FAILED: 'FAILED' },
  prisma: {
    admin: { findUnique: mockAdminFindUnique },
    user: { count: mockUserCount },
    payment: { count: mockPaymentCount },
  },
}));

vi.mock('../src/jobs/dailyCheck.js', () => ({
  runDailyCheck: mockRunDailyCheck,
}));

vi.mock('../src/config.js', () => ({
  config: { ADMIN_PANEL_URL: 'https://admin.example.com' },
}));

import {
  handleAdmin,
  handleAdminCheckCallback,
  handleAdminSummaryCallback,
} from '../src/bot/handlers/admin.js';
import {
  ADMIN_CHECK_CALLBACK,
  ADMIN_SUMMARY_CALLBACK,
} from '../src/bot/keyboards.js';
import { isAdmin } from '../src/bot/middleware/isAdmin.js';

const ADMIN_TELEGRAM_ID = 111;
const NON_ADMIN_TELEGRAM_ID = 222;

function createMockContext(overrides: Record<string, unknown> = {}) {
  const reply = vi.fn<(text: string, options?: ReplyMarkup) => Promise<unknown>>();
  const answerCallbackQuery = vi.fn<() => Promise<unknown>>();
  const next = vi.fn<NextFunction>();

  const ctx = {
    from: {
      id: ADMIN_TELEGRAM_ID,
      username: 'adminuser',
      first_name: 'Admin',
    },
    reply,
    answerCallbackQuery,
    callbackQuery: {
      message: { message_id: 1 },
    },
    ...overrides,
  } as unknown as Context;

  return { ctx, reply, answerCallbackQuery, next };
}

function getInlineKeyboardButtons(
  reply: ReturnType<typeof createMockContext>['reply'],
): InlineButton[] {
  const [, options] = reply.mock.calls[0] ?? [];
  return options?.reply_markup?.inline_keyboard.flat() ?? [];
}

describe('/admin handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:00:00.000Z'));

    mockAdminFindUnique.mockImplementation(({ where }) =>
      where.telegramId === BigInt(ADMIN_TELEGRAM_ID)
        ? Promise.resolve({ telegramId: BigInt(ADMIN_TELEGRAM_ID) })
        : Promise.resolve(null),
    );
    mockRunDailyCheck.mockResolvedValue({ ranNow: true });
    mockUserCount.mockImplementation(({ where }) => {
      if (where.status === 'ACTIVE') return Promise.resolve(5);
      if (where.status === 'MUTED') return Promise.resolve(2);
      return Promise.resolve(0);
    });
    mockPaymentCount.mockResolvedValue(3);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handleAdmin sends keyboard with check, summary callbacks and panel url button', async () => {
    const { ctx, reply } = createMockContext();

    await handleAdmin(ctx);

    expect(reply).toHaveBeenCalledOnce();
    const buttons = getInlineKeyboardButtons(reply);
    expect(buttons).toEqual([
      { text: '🔄 Проверить подписки', callback_data: ADMIN_CHECK_CALLBACK },
      { text: '📊 Сводка', callback_data: ADMIN_SUMMARY_CALLBACK },
      { text: '🔗 Панель', url: 'https://admin.example.com' },
    ]);
  });

  it('handleAdminCheckCallback replies with success text when ranNow is true', async () => {
    const { ctx, reply, answerCallbackQuery } = createMockContext();
    mockRunDailyCheck.mockResolvedValue({ ranNow: true });

    await handleAdminCheckCallback(ctx);

    expect(answerCallbackQuery).toHaveBeenCalledOnce();
    expect(mockRunDailyCheck).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('выполнена'));
  });

  it('handleAdminCheckCallback replies with skip text when ranNow is false', async () => {
    const { ctx, reply } = createMockContext();
    mockRunDailyCheck.mockResolvedValue({ ranNow: false });

    await handleAdminCheckCallback(ctx);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('пропущен'));
    const successText = (reply.mock.calls[0]?.[0] as string) ?? '';
    expect(successText).not.toContain('выполнена');
  });

  it('handleAdminSummaryCallback counts active/muted/payments today using Moscow day bounds', async () => {
    const { ctx, reply } = createMockContext();

    await handleAdminSummaryCallback(ctx);

    expect(mockUserCount).toHaveBeenCalledWith({ where: { status: 'ACTIVE' } });
    expect(mockUserCount).toHaveBeenCalledWith({ where: { status: 'MUTED' } });
    expect(mockPaymentCount).toHaveBeenCalledOnce();

    const paymentArgs = mockPaymentCount.mock.calls[0]?.[0];
    expect(paymentArgs?.where.paidAt.gte.toISOString()).toBe('2026-01-14T21:00:00.000Z');
    expect(paymentArgs?.where.paidAt.lte.toISOString()).toBe('2026-01-15T20:59:59.999Z');

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Активных подписок: 5'));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Замьюченных: 2'));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Оплат за сегодня: 3'));
  });
});

describe('isAdmin on admin callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminFindUnique.mockImplementation(({ where }) =>
      where.telegramId === BigInt(ADMIN_TELEGRAM_ID)
        ? Promise.resolve({ telegramId: BigInt(ADMIN_TELEGRAM_ID) })
        : Promise.resolve(null),
    );
  });

  it('denies non-admin on admin check callback', async () => {
    const { ctx, reply, next } = createMockContext({
      from: { id: NON_ADMIN_TELEGRAM_ID, username: 'user', first_name: 'User' },
    });

    await isAdmin(ctx, next);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('нет прав'));
    expect(next).not.toHaveBeenCalled();
  });

  it('denies non-admin on admin summary callback', async () => {
    const { ctx, reply, next } = createMockContext({
      from: { id: NON_ADMIN_TELEGRAM_ID, username: 'user', first_name: 'User' },
    });

    await isAdmin(ctx, next);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('нет прав'));
    expect(next).not.toHaveBeenCalled();
  });

  it('allows admin through to next handler', async () => {
    const { ctx, reply, next } = createMockContext();

    await isAdmin(ctx, next);

    expect(next).toHaveBeenCalledOnce();
    expect(reply).not.toHaveBeenCalled();
  });
});
