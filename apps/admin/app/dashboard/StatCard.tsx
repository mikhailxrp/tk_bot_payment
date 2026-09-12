export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}
    >
      <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
