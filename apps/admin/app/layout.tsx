import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Админ-панель',
  description: 'Управление подпиской и аналитика',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
