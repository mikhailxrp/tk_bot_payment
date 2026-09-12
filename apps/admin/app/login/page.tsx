export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold">Вход в панель</h1>
        <p className="mt-3 text-sm opacity-80">
          Отправьте боту команду <code>/admin</code> в Telegram и перейдите по ссылке «🔗 Панель».
          Ссылка одноразовая и действует ограниченное время.
        </p>
      </div>
    </main>
  );
}
