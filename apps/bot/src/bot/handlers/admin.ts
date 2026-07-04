import type { Context } from 'grammy';

const ADMIN_STUB_MESSAGE =
  'Админ-панель бота: функциональность появится в следующих фазах.';

export async function handleAdmin(ctx: Context): Promise<void> {
  await ctx.reply(ADMIN_STUB_MESSAGE);
}
