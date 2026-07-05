import { InlineKeyboard } from 'grammy';

export const SUBSCRIBE_CALLBACK = 'subscribe';
export const COMMON_ACCESS_CALLBACK = 'common_access';

export function productChoiceKeyboard(showCommonAccessButton: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(
    'Закрытая группа (подписка)',
    SUBSCRIBE_CALLBACK,
  );

  if (showCommonAccessButton) {
    keyboard.row().text('Общая группа (разовый доступ)', COMMON_ACCESS_CALLBACK);
  }

  return keyboard;
}

export function paymentKeyboard(url: string): InlineKeyboard {
  return new InlineKeyboard().url('Оплатить', url);
}
