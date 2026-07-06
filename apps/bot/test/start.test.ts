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

type KeyboardReplyOptions = {
  reply_markup?: { keyboard: { text: string }[][] };
};

type SubscriptionPaymentLink = { paymentUrl: string; amount: string; periodDays: string };

const {
  mockUserUpsert,
  mockCommonAccessFindUnique,
  mockSettingFindUnique,
  mockPaymentCreate,
  mockResendCommonAccessInviteLink,
  mockCreateSubscriptionPaymentLink,
  mockAdminFindUnique,
} = vi.hoisted(() => ({
  mockUserUpsert: vi.fn<(args: UserUpsertArgs) => Promise<unknown>>(),
  mockCommonAccessFindUnique:
    vi.fn<
      (args: { where: { userId: bigint } }) => Promise<{ userId: bigint; inGroup: boolean } | null>
    >(),
  mockSettingFindUnique: vi.fn<(args: SettingFindArgs) => Promise<{ value: string } | null>>(),
  mockPaymentCreate: vi.fn<(args: PaymentCreateArgs) => Promise<{ id: number }>>(),
  mockResendCommonAccessInviteLink: vi.fn<(userId: bigint) => Promise<void>>(),
  mockCreateSubscriptionPaymentLink:
    vi.fn<(userId: bigint) => Promise<SubscriptionPaymentLink | null>>(),
  mockAdminFindUnique:
    vi.fn<(args: { where: { telegramId: bigint } }) => Promise<{ telegramId: bigint } | null>>(),
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
    admin: {
      findUnique: mockAdminFindUnique,
    },
  },
}));

vi.mock('../src/services/subscription.js', () => ({
  resendCommonAccessInviteLink: mockResendCommonAccessInviteLink,
  createSubscriptionPaymentLink: mockCreateSubscriptionPaymentLink,
}));

vi.mock('../src/config.js', () => ({
  config: { ADMIN_PANEL_URL: 'https://admin.example.com' },
}));

vi.mock('../src/jobs/dailyCheck.js', () => ({
  runDailyCheck: vi.fn(),
}));

import {
  handleCommonAccessCallback,
  handleCommonStart,
  handleResendAccessCallback,
  handleSubscribeCallback,
  handleSubscriptionStart,
} from '../src/bot/handlers/start.js';
import {
  COMMON_ACCESS_CALLBACK,
  RESEND_ACCESS_CALLBACK,
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

describe('handleSubscriptionStart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserUpsert.mockResolvedValue({});
    mockAdminFindUnique.mockResolvedValue(null);
  });

  it('shows only the subscribe button', async () => {
    const { ctx, reply } = createMockContext();

    await handleSubscriptionStart(ctx);

    expect(mockUserUpsert).toHaveBeenCalledOnce();
    expect(mockCommonAccessFindUnique).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      'Добро пожаловать! Оформите подписку на закрытую группу.',
      expect.any(Object),
    );

    const buttons = getInlineKeyboardButtons(reply);
    expect(buttons).toEqual([
      { text: 'Закрытая группа (подписка)', callback_data: SUBSCRIBE_CALLBACK },
    ]);
  });

  it('handles deep-link /start paid without database calls', async () => {
    const { ctx, reply } = createMockContext({ match: 'paid' });

    await handleSubscriptionStart(ctx);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Оплата прошла успешно'));
    expect(mockUserUpsert).not.toHaveBeenCalled();
  });

  it('handles deep-link /start fail without database calls', async () => {
    const { ctx, reply } = createMockContext({ match: 'fail' });

    await handleSubscriptionStart(ctx);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Оплата не была завершена'));
    expect(mockUserUpsert).not.toHaveBeenCalled();
  });

  it('shows the admin menu instead of the subscribe button when the user is a bot admin', async () => {
    mockAdminFindUnique.mockResolvedValue({ telegramId: TEST_USER_ID_BIGINT });
    const { ctx, reply } = createMockContext();

    await handleSubscriptionStart(ctx);

    expect(mockAdminFindUnique).toHaveBeenCalledWith({
      where: { telegramId: TEST_USER_ID_BIGINT },
    });
    expect(reply).toHaveBeenCalledWith(
      'Админ-панель бота: выберите действие.',
      expect.any(Object),
    );

    const buttons = getInlineKeyboardButtons(reply);
    expect(buttons).toEqual([
      { text: '🔄 Проверить подписки', callback_data: 'admin_check' },
      { text: '📊 Сводка', callback_data: 'admin_summary' },
      { text: '🔗 Панель', url: 'https://admin.example.com' },
    ]);
  });

  it('always sends the persistent "Меню" keyboard before the welcome message', async () => {
    const { ctx, reply } = createMockContext();

    await handleSubscriptionStart(ctx);

    const [, options] = reply.mock.calls[0] as unknown as [string, KeyboardReplyOptions];
    expect(options.reply_markup?.keyboard).toEqual([[{ text: '☰ Меню' }]]);
  });
});

describe('handleCommonStart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserUpsert.mockResolvedValue({});
    mockCommonAccessFindUnique.mockResolvedValue(null);
  });

  it('shows the common access button when CommonAccess is absent', async () => {
    const { ctx, reply } = createMockContext();

    await handleCommonStart(ctx);

    expect(mockUserUpsert).toHaveBeenCalledOnce();
    expect(mockCommonAccessFindUnique).toHaveBeenCalledWith({
      where: { userId: TEST_USER_ID_BIGINT },
    });
    expect(reply).toHaveBeenCalledWith(
      'Добро пожаловать! Оформите доступ в группу KORDON Transfer.',
      expect.any(Object),
    );

    const buttons = getInlineKeyboardButtons(reply);
    expect(buttons).toEqual([
      { text: 'Группа KORDON Transfer (разовый доступ)', callback_data: COMMON_ACCESS_CALLBACK },
    ]);
  });

  it('hides the button and shows paid message when CommonAccess exists in group', async () => {
    mockCommonAccessFindUnique.mockResolvedValue({
      userId: TEST_USER_ID_BIGINT,
      inGroup: true,
    });
    const { ctx, reply } = createMockContext();

    await handleCommonStart(ctx);

    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('Доступ в общую группу уже оплачен.'),
      undefined,
    );
  });

  it('shows resend access button when CommonAccess exists but user is not in group', async () => {
    mockCommonAccessFindUnique.mockResolvedValue({
      userId: TEST_USER_ID_BIGINT,
      inGroup: false,
    });
    const { ctx, reply } = createMockContext();

    await handleCommonStart(ctx);

    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('Доступ в общую группу уже оплачен.'),
      expect.any(Object),
    );

    const buttons = getInlineKeyboardButtons(reply);
    expect(buttons).toEqual([{ text: 'Получить ссылку снова', callback_data: RESEND_ACCESS_CALLBACK }]);
  });

  it('handles deep-link /start paid without database calls', async () => {
    const { ctx, reply } = createMockContext({ match: 'paid' });

    await handleCommonStart(ctx);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Оплата прошла успешно'));
    expect(mockUserUpsert).not.toHaveBeenCalled();
    expect(mockCommonAccessFindUnique).not.toHaveBeenCalled();
  });

  it('handles deep-link /start fail without database calls', async () => {
    const { ctx, reply } = createMockContext({ match: 'fail' });

    await handleCommonStart(ctx);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Оплата не была завершена'));
    expect(mockUserUpsert).not.toHaveBeenCalled();
    expect(mockCommonAccessFindUnique).not.toHaveBeenCalled();
  });

  it('always sends the persistent "Меню" keyboard before the welcome message', async () => {
    const { ctx, reply } = createMockContext();

    await handleCommonStart(ctx);

    const [, options] = reply.mock.calls[0] as unknown as [string, KeyboardReplyOptions];
    expect(options.reply_markup?.keyboard).toEqual([[{ text: '☰ Меню' }]]);
  });
});

describe('handleSubscribeCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSubscriptionPaymentLink.mockResolvedValue({
      paymentUrl:
        'https://auth.robokassa.ru/Merchant/Index.aspx?Description=' +
        encodeURIComponent('Подписка на 30 дней'),
      amount: '990.00',
      periodDays: '30',
    });
  });

  it('creates SUBSCRIPTION payment link via the shared helper and shows it', async () => {
    const { ctx, editMessageText, answerCallbackQuery } = createMockContext();

    await handleSubscribeCallback(ctx);

    expect(answerCallbackQuery).toHaveBeenCalledOnce();
    expect(mockCreateSubscriptionPaymentLink).toHaveBeenCalledWith(TEST_USER_ID_BIGINT);
    expect(editMessageText).toHaveBeenCalledOnce();

    const [text] = editMessageText.mock.calls[0] ?? [];
    expect(text).toContain('990.00');

    const url = getPaymentUrl(editMessageText);
    expect(url).toContain('auth.robokassa.ru');
    expect(url).toContain('Description=' + encodeURIComponent('Подписка на 30 дней'));
  });

  it('replies with unavailable message when the helper returns null (invalid price settings)', async () => {
    mockCreateSubscriptionPaymentLink.mockResolvedValue(null);
    const { ctx, reply } = createMockContext();

    await handleSubscribeCallback(ctx);

    expect(reply).toHaveBeenCalledWith(
      'Стоимость подписки временно недоступна. Попробуйте позже.',
    );
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
    mockCommonAccessFindUnique.mockResolvedValue({
      userId: TEST_USER_ID_BIGINT,
      inGroup: true,
    });
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

describe('handleResendAccessCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommonAccessFindUnique.mockResolvedValue(null);
    mockResendCommonAccessInviteLink.mockResolvedValue(undefined);
  });

  it('replies "already active" and does not call the service when CommonAccess is absent', async () => {
    const { ctx, reply, answerCallbackQuery } = createMockContext();

    await handleResendAccessCallback(ctx);

    expect(answerCallbackQuery).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledWith('Доступ в общую группу уже активен.');
    expect(mockResendCommonAccessInviteLink).not.toHaveBeenCalled();
  });

  it('replies "already active" and does not call the service when inGroup=true', async () => {
    mockCommonAccessFindUnique.mockResolvedValue({
      userId: TEST_USER_ID_BIGINT,
      inGroup: true,
    });
    const { ctx, reply } = createMockContext();

    await handleResendAccessCallback(ctx);

    expect(reply).toHaveBeenCalledWith('Доступ в общую группу уже активен.');
    expect(mockResendCommonAccessInviteLink).not.toHaveBeenCalled();
  });

  it('calls resendCommonAccessInviteLink and does not create a Payment when inGroup=false', async () => {
    mockCommonAccessFindUnique.mockResolvedValue({
      userId: TEST_USER_ID_BIGINT,
      inGroup: false,
    });
    const { ctx, reply } = createMockContext();

    await handleResendAccessCallback(ctx);

    expect(mockResendCommonAccessInviteLink).toHaveBeenCalledWith(TEST_USER_ID_BIGINT);
    expect(mockPaymentCreate).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('replies with an error message and does not throw when the service fails', async () => {
    mockCommonAccessFindUnique.mockResolvedValue({
      userId: TEST_USER_ID_BIGINT,
      inGroup: false,
    });
    mockResendCommonAccessInviteLink.mockRejectedValue(new Error('telegram error'));
    const { ctx, reply } = createMockContext();

    await expect(handleResendAccessCallback(ctx)).resolves.toBeUndefined();

    expect(reply).toHaveBeenCalledWith(
      'Не удалось создать ссылку для вступления. Попробуйте позже или обратитесь к администратору.',
    );
  });
});
