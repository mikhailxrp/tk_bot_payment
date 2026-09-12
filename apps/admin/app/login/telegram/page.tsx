'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Suspense, useEffect, useState } from 'react';

function TelegramLoginInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setError('Ссылка недействительна.');
      return;
    }

    void signIn('credentials', { token, redirect: false }).then((result) => {
      if (!result || result.error) {
        setError('Ссылка истекла или недействительна. Запросите новую через /admin в боте.');
        return;
      }
      router.replace('/dashboard');
    });
  }, [params, router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <p className="text-sm">{error ?? 'Выполняется вход…'}</p>
    </main>
  );
}

export default function TelegramLoginPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center p-6">Загрузка…</main>}>
      <TelegramLoginInner />
    </Suspense>
  );
}
