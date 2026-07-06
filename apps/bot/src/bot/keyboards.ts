import { InlineKeyboard, Keyboard } from 'grammy';

export const SUBSCRIBE_CALLBACK = 'subscribe';
export const COMMON_ACCESS_CALLBACK = 'common_access';
export const RESEND_ACCESS_CALLBACK = 'resend_access';
export const ADMIN_CHECK_CALLBACK = 'admin_check';
export const ADMIN_SUMMARY_CALLBACK = 'admin_summary';
export const MENU_BUTTON_TEXT = '☰ Меню';

export function mainReplyKeyboard(): Keyboard {
  return new Keyboard().text(MENU_BUTTON_TEXT).resized();
}

export type CommonAccessUiState = 'none' | 'paid_in_group' | 'paid_not_in_group';

export function subscriptionKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Закрытая группа (подписка)', SUBSCRIBE_CALLBACK);
}

export function commonAccessKeyboard(
  commonAccessState: CommonAccessUiState,
): InlineKeyboard | undefined {
  if (commonAccessState === 'none') {
    return new InlineKeyboard().text(
      'Группа KORDON Transfer (разовый доступ)',
      COMMON_ACCESS_CALLBACK,
    );
  }

  if (commonAccessState === 'paid_not_in_group') {
    return new InlineKeyboard().text('Получить ссылку снова', RESEND_ACCESS_CALLBACK);
  }

  return undefined;
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
