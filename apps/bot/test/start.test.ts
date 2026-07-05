import type { Context } from 'grammy';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type UserUpsertArgs = {
  where: { id: bigint };
  update: unknown;
  create: unknown;
};

type PaymentCreateArgs = {
  data: {
    userId: bigint;
    amount: string;
    status: string;
    product?: string;
  };
};

type SettingFindArgs = { where: { key: string } };

type InlineButton = { text: string; callback_data?: string; url?: string };

type ReplyMarkup = {
  reply_markup?: { inline_keyboard: InlineButton[][] };
};

const {
  mockUserUpsert,
  mockCommonAccessFindUnique,
  mockSettingFindUnique,
  mockPaymentCreate,
} = vi.hoisted(() => ({
  mockUserUpsert: vi.fn<(args: UserUpsertArgs) => Promise<unknown>>(),
  mockCommonAccessFindUnique:
    vi.fn<(args: { where: { userId: bigint } }) => Promise<{ userId: bigint } | null>>(),
  mockSettingFindUnique: vi.fn<(args: SettingFindArgs) => Promise<{ value: string } | null>>(),
  mockPaymentCreate: vi.fn<(args: PaymentCreateArgs) => Promise<{ id: number }>>(),
}));

vi.mock('@tg-bot/db', () => ({
  PaymentStatus: {
    PENDING: 'PENDING',
    PAID: 'PAID',
  },
  ProductType: {
    SUBSCRIPTION: 'SUBSCRIPTION',
    LIFETIME: 'LIFETIME',
  },
  prisma: {
    user: {
      upsert: mockUserUpsert,
    },
    commonAccess: {
      findUnique: mockCommonAccessFindUnique,
    },
    setting: {
      findUnique: mockSettingFindUnique,
    },
    payment: {
      create: mockPaymentCreate,
    },
  },
}));

import {
  handleCommonAccessCallback,
  handleStart,
  handleSubscribeCallback,
} from '../src/bot/handlers/start.js';
import {
  COMMON_ACCESS_CALLBACK,
  SUBSCRIBE_CALLBACK,
} from '../src/bot/keyboards.js';

const TEST_USER_ID = 123456789;
const TEST_USER_ID_BIGINT = BigInt(TEST_USER_ID);

function createMockContext(overrides: Record<string, unknown> = {}) {
  const reply = vi.fn<(text: string, options?: ReplyMarkup) => Promise<unknown>>();
  const editMessageText = vi.fn<(text: string, options?: ReplyMarkup) => Promise<unknown>>();
  const answerCallbackQuery = vi.fn<() => Promise<unknown>>();

  const ctx = {
    from: {
      id: TEST_USER_ID,
      username: 'testuser',
      first_name: 'Test',
    },
    match: '',
    reply,
    editMessageText,
    answerCallbackQuery,
    callbackQuery: {
      message: { message_id: 1 },
    },
    ...overrides,
  } as unknown as Context;

  return { ctx, reply, editMessageText, answerCallbackQuery };
}

function getInlineKeyboardButtons(
  reply: ReturnType<typeof createMockContext>['reply'],
): InlineButton[] {
  const replyCall = reply.mock.calls.at(-1);
  return replyCall?.[1]?.reply_markup?.inline_keyboard.flat() ?? [];
}

function getPaymentUrl(
  editMessageText: ReturnType<typeof createMockContext>['editMessageText'],
): string {
  const editCall = editMessageText.mock.calls[0];
  const button = editCall?.[1]?.reply_markup?.inline_keyboard[0]?.[0];
  if (!button?.url) {
    throw new Error('Expected payment URL in inline keyboard');
  }
  return button.url;
}

describe('handleStart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserUpsert.mockResolvedValue({});
    mockCommonAccessFindUnique.mockResolvedValue(null);
  });

  it('shows both product buttons when CommonAccess is absent', async () => {
    const { ctx, reply } = createMockContext();

    await handleStart(ctx);

    expect(mockUserUpsert).toHaveBeenCalledOnce();
    expect(mockCommonAccessFindUnique).toHaveBeenCalledWith({
      where: { userId: TEST_USER_ID_BIGINT },
    });
    expect(reply).toHaveBeenCalledWith(
      'Добро пожаловать! Выберите группу для оформления доступа.',
      expect.any(Object),
    );

    const buttons = getInlineKeyboardButtons(reply);
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toMatchObject({
      text: 'Закрытая группа (подписка)',
      callback_data: SUBSCRIBE_CALLBACK,
    });
    expect(buttons[1]).toMatchObject({
      text: 'Общая группа (разовый доступ)',
      callback_data: COMMON_ACCESS_CALLBACK,
    });
  });

  it('hides common access button and shows paid message when CommonAccess exists', async () => {
    mockCommonAccessFindUnique.mockResolvedValue({ userId: TEST_USER_ID_BIGINT });
    const { ctx, reply } = createMockContext();

    await handleStart(ctx);

    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('Доступ в общую группу уже оплачен.'),
      expect.any(Object),
    );

    const buttons = getInlineKeyboardButtons(reply);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toMatchObject({
      text: 'Закрытая группа (подписка)',
      callback_data: SUBSCRIBE_CALLBACK,
    });
  });

  it('handles deep-link /start paid without database calls', async () => {
    const { ctx, reply } = createMockContext({ match: 'paid' });

    await handleStart(ctx);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Оплата прошла успешно'));
    expect(mockUserUpsert).not.toHaveBeenCalled();
    expect(mockCommonAccessFindUnique).not.toHaveBeenCalled();
  });

  it('handles deep-link /start fail without database calls', async () => {
    const { ctx, reply } = createMockContext({ match: 'fail' });

    await handleStart(ctx);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Оплата не была завершена'));
    expect(mockUserUpsert).not.toHaveBeenCalled();
    expect(mockCommonAccessFindUnique).not.toHaveBeenCalled();
  });
});

describe('handleSubscribeCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingFindUnique.mockImplementation(({ where }) => {
      if (where.key === 'price') {
        return Promise.resolve({ value: '990' });
      }
      if (where.key === 'period_days') {
        return Promise.resolve({ value: '30' });
      }
      return Promise.resolve(null);
    });
    mockPaymentCreate.mockResolvedValue({ id: 42 });
  });

  it('creates SUBSCRIPTION payment and shows Robokassa link', async () => {
    const { ctx, editMessageText, answerCallbackQuery } = createMockContext();

    await handleSubscribeCallback(ctx);

    expect(answerCallbackQuery).toHaveBeenCalledOnce();
    expect(mockPaymentCreate).toHaveBeenCalledWith({
      data: {
        userId: TEST_USER_ID_BIGINT,
        amount: '990.00',
        status: 'PENDING',
      },
    });
    expect(editMessageText).toHaveBeenCalledOnce();

    const [text] = editMessageText.mock.calls[0] ?? [];
    expect(text).toContain('990.00');

    const url = getPaymentUrl(editMessageText);
    expect(url).toContain('auth.robokassa.ru');
    expect(url).toContain('Description=' + encodeURIComponent('Подписка на 30 дней'));
  });

  it('replies with unavailable message when price settings are invalid', async () => {
    mockSettingFindUnique.mockResolvedValue(null);
    const { ctx, reply } = createMockContext();

    await handleSubscribeCallback(ctx);

    expect(reply).toHaveBeenCalledWith(
      'Стоимость подписки временно недоступна. Попробуйте позже.',
    );
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });
});

describe('handleCommonAccessCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommonAccessFindUnique.mockResolvedValue(null);
    mockSettingFindUnique.mockResolvedValue({ value: '500' });
    mockPaymentCreate.mockResolvedValue({ id: 99 });
  });

  it('creates LIFETIME payment with price_common and correct description', async () => {
    const { ctx, editMessageText, answerCallbackQuery } = createMockContext();

    await handleCommonAccessCallback(ctx);

    expect(answerCallbackQuery).toHaveBeenCalledOnce();
    expect(mockSettingFindUnique).toHaveBeenCalledWith({ where: { key: 'price_common' } });
    expect(mockPaymentCreate).toHaveBeenCalledWith({
      data: {
        userId: TEST_USER_ID_BIGINT,
        amount: '500.00',
        status: 'PENDING',
        product: 'LIFETIME',
      },
    });

    const url = getPaymentUrl(editMessageText);
    expect(url).toContain(
      'Description=' + encodeURIComponent('Разовый доступ в общую группу'),
    );
  });

  it('does not create payment when CommonAccess already exists', async () => {
    mockCommonAccessFindUnique.mockResolvedValue({ userId: TEST_USER_ID_BIGINT });
    const { ctx, reply } = createMockContext();

    await handleCommonAccessCallback(ctx);

    expect(reply).toHaveBeenCalledWith('Доступ в общую группу уже оплачен.');
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it('replies with unavailable message when price_common is invalid', async () => {
    mockSettingFindUnique.mockResolvedValue({ value: 'invalid' });
    const { ctx, reply } = createMockContext();

    await handleCommonAccessCallback(ctx);

    expect(reply).toHaveBeenCalledWith(
      'Стоимость доступа в общую группу временно недоступна. Попробуйте позже.',
    );
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });
});
