import { InlineKeyboard } from 'grammy';

export const SUBSCRIBE_CALLBACK = 'subscribe';

const PAYMENT_PLACEHOLDER_URL = 'https://example.com/payment-placeholder';

export function subscribeKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Оформить подписку', SUBSCRIBE_CALLBACK);
}

export function paymentKeyboard(_amount: string): InlineKeyboard {
  return new InlineKeyboard().url('Оплатить', PAYMENT_PLACEHOLDER_URL);
}
