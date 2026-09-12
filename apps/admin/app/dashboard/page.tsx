import { prisma, UserStatus } from '@tg-bot/db';

import { auth } from '@/auth';

export default async function DashboardPage() {
  const session = await auth();
  const activeCount = await prisma.user.count({ where: { status: UserStatus.ACTIVE } });

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">Дашборд</h1>
      <p className="mt-2 text-sm opacity-80">Вы вошли как {session?.user?.name ?? 'админ'}.</p>
      <p className="mt-4 text-sm">
        Активных подписок: {activeCount}
        <br />
        Полная аналитика — Фаза 10.
      </p>
    </main>
  );
}
