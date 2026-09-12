import type { TopActiveUser } from '../../lib/dashboard/activity';

export function TopActiveUsersTable({ users }: { users: TopActiveUser[] }) {
  if (users.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Пока нет активности за этот период.
      </p>
    );
  }

  const max = Math.max(...users.map((user) => user.messageCount));

  return (
    <table className="w-full text-sm" style={{ color: 'var(--text-primary)' }}>
      <thead>
        <tr style={{ color: 'var(--text-muted)' }}>
          <th className="pb-2 text-left font-normal">#</th>
          <th className="pb-2 text-left font-normal">Пользователь</th>
          <th className="pb-2 text-right font-normal">Сообщений</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user, index) => (
          <tr key={user.userId} style={{ borderTop: '1px solid var(--border)' }}>
            <td className="py-2" style={{ color: 'var(--text-muted)' }}>
              {index + 1}
            </td>
            <td className="py-2">{user.username ? `@${user.username}` : `id:${user.userId}`}</td>
            <td className="py-2 text-right">
              <div className="flex items-center justify-end gap-2">
                <div
                  className="h-1.5 rounded-full"
                  style={{
                    width: `${Math.max(8, (user.messageCount / max) * 64)}px`,
                    background: 'var(--series-1)',
                    opacity: 0.6,
                  }}
                />
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{user.messageCount}</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
