import { InlineKeyboard } from 'grammy';

export const SUBSCRIBE_CALLBACK = 'subscribe';

export function subscribeKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Оформить подписку', SUBSCRIBE_CALLBACK);
}

export function paymentKeyboard(url: string): InlineKeyboard {
  return new InlineKeyboard().url('Оплатить', url);
}
