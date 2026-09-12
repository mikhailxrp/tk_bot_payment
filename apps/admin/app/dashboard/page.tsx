import { auth } from '@/auth';

import { getDAU, getMessagesSeries, getSilentActiveShare, getTopActiveUsers, getWAU } from '../../lib/dashboard/activity';
import { getMRR, getPaymentsSeries, getRevenueThisMonth, getRevenueToday } from '../../lib/dashboard/revenue';
import { getNewSubscribersCount, getStartToPaymentConversion, getStatusCounts, getWinBackRate } from '../../lib/dashboard/subscribers';
import { getMoscowMonthBounds } from '../../lib/moscowDate';
import { StatCard } from './StatCard';
import { TimeSeriesChart } from './TimeSeriesChart';
import { TopActiveUsersTable } from './TopActiveUsersTable';

const currencyFormat = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

const percentFormat = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0 });

export default async function DashboardPage() {
  const session = await auth();
  const now = new Date();
  const { start: monthStart, end: monthEnd } = getMoscowMonthBounds(now);

  const [
    revenueToday,
    revenueMonth,
    mrr,
    statusCounts,
    newSubscribers,
    conversion,
    winBack,
    dau,
    wau,
    silentShare,
    paymentsSeries,
    messagesSeries,
    topActiveUsers,
  ] = await Promise.all([
    getRevenueToday(now),
    getRevenueThisMonth(now),
    getMRR(),
    getStatusCounts(),
    getNewSubscribersCount(monthStart, monthEnd),
    getStartToPaymentConversion(monthStart, monthEnd),
    getWinBackRate(monthStart, monthEnd),
    getDAU(now),
    getWAU(now),
    getSilentActiveShare(now),
    getPaymentsSeries(30, now),
    getMessagesSeries(30, now),
    getTopActiveUsers(10, 30, now),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Дашборд</h1>
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {session?.user?.name ? `Админ ${session.user.name}` : ''}
        </span>
      </div>

      <section className="mt-6">
        <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          Деньги
        </h2>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Выручка сегодня" value={currencyFormat.format(revenueToday.total)} />
          <StatCard
            label="Выручка за месяц"
            value={currencyFormat.format(revenueMonth.total)}
            hint={`Подписка ${currencyFormat.format(revenueMonth.subscription)} · Разовый ${currencyFormat.format(revenueMonth.lifetime)}`}
          />
          <StatCard label="MRR" value={currencyFormat.format(mrr)} hint="Нормализовано к 30 дням" />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          Подписчики
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Активные" value={String(statusCounts.active)} />
          <StatCard label="Удалённые" value={String(statusCounts.muted)} />
          <StatCard label="Новые за месяц" value={String(newSubscribers)} />
          <StatCard
            label="Конверсия /start→оплата"
            value={percentFormat.format(conversion.rate)}
            hint={`${conversion.usersPaid} из ${conversion.usersCreated}`}
          />
          <StatCard
            label="Win-back"
            value={percentFormat.format(winBack.rate)}
            hint={`${winBack.wonBack} из ${winBack.everMuted}`}
          />
          <StatCard
            label="Тихие подписчики"
            value={percentFormat.format(silentShare.rate)}
            hint="ACTIVE без сообщений 7 дней"
          />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          Активность в закрытой группе
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-2">
          <StatCard label="DAU" value={String(dau)} hint="Уникальных за сегодня" />
          <StatCard label="WAU" value={String(wau)} hint="Уникальных за 7 дней" />
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div
          className="rounded-lg p-4"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}
        >
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Платежи, 30 дней
          </h3>
          <TimeSeriesChart
            data={paymentsSeries.map((point) => ({ date: point.date, value: point.amount }))}
            color="var(--series-1)"
            valueLabel="Выручка"
            format="currency"
          />
        </div>
        <div
          className="rounded-lg p-4"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}
        >
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Сообщения в группе, 30 дней
          </h3>
          <TimeSeriesChart
            data={messagesSeries.map((point) => ({ date: point.date, value: point.count }))}
            color="var(--series-2)"
            valueLabel="Сообщений"
          />
        </div>
      </section>

      <section className="mt-6">
        <div
          className="rounded-lg p-4"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}
        >
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Топ активных участников, 30 дней
          </h3>
          <div className="mt-3">
            <TopActiveUsersTable users={topActiveUsers} />
          </div>
        </div>
      </section>
    </main>
  );
}
