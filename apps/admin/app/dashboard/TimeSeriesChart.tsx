'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type TimeSeriesPoint = { date: string; value: number };

const CURRENCY_FORMAT = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

// `format` is a serializable prop (not a function) — page.tsx is a server component and cannot
// pass callbacks across the server/client boundary to this 'use client' component.
function formatPoint(value: number, format: 'currency' | 'number'): string {
  return format === 'currency' ? CURRENCY_FORMAT.format(value) : String(value);
}

export function TimeSeriesChart({
  data,
  color,
  valueLabel,
  format = 'number',
}: {
  data: TimeSeriesPoint[];
  color: string;
  valueLabel: string;
  format?: 'currency' | 'number';
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid-line)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
          axisLine={{ stroke: 'var(--axis-line)' }}
          tickLine={false}
          minTickGap={24}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: 'var(--text-secondary)' }}
          formatter={(value) => [formatPoint(Number(value), format), valueLabel]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={color}
          fillOpacity={0.1}
          dot={false}
          activeDot={{ r: 4, stroke: 'var(--surface-card)', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
