import { InlineKeyboard } from 'grammy';

export const SUBSCRIBE_CALLBACK = 'subscribe';
export const COMMON_ACCESS_CALLBACK = 'common_access';
export const RESEND_ACCESS_CALLBACK = 'resend_access';
export const ADMIN_CHECK_CALLBACK = 'admin_check';
export const ADMIN_SUMMARY_CALLBACK = 'admin_summary';

export type CommonAccessUiState = 'none' | 'paid_in_group' | 'paid_not_in_group';

export function productChoiceKeyboard(commonAccessState: CommonAccessUiState): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(
    'Закрытая группа (подписка)',
    SUBSCRIBE_CALLBACK,
  );

  if (commonAccessState === 'none') {
    keyboard.row().text('Общая группа (разовый доступ)', COMMON_ACCESS_CALLBACK);
  } else if (commonAccessState === 'paid_not_in_group') {
    keyboard.row().text('Получить ссылку снова', RESEND_ACCESS_CALLBACK);
  }

  return keyboard;
}

export function paymentKeyboard(url: string): InlineKeyboard {
  return new InlineKeyboard().url('Оплатить', url);
}

export function adminKeyboard(panelUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔄 Проверить подписки', ADMIN_CHECK_CALLBACK)
    .row()
    .text('📊 Сводка', ADMIN_SUMMARY_CALLBACK)
    .row()
    .url('🔗 Панель', panelUrl);
}
