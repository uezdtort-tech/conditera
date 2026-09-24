"use client";

/**
 * /oauth/finish — финал OAuth-флоу.
 *
 * Читает одноразовый handoff-cookie через /api/auth/oauth/handoff и
 * устанавливает GoTrue-сессию в браузере (setSession). После этого
 * приложение находится ровно в том же состоянии, что после обычного
 * входа: useAuth подхватит пользователя, роли загрузятся через RLS.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function OAuthFinishPage() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error");
    if (urlError) {
      setError(urlError);
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/auth/oauth/handoff");
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          session?: { access_token: string; refresh_token: string; expires_at?: number };
        };
        if (!res.ok || !data.session) {
          throw new Error(data.error || "Не удалось завершить вход");
        }
        const { error: setErr } = await supabaseBrowser.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        if (setErr) throw new Error(setErr.message);
        setDone(true);
        // Перезагрузка: useAuth/onAuthStateChange подхватит сессию,
        // роутер отрисует дашборд покупателя.
        window.location.href = "/";
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка входа");
      }
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-3 p-8">
        {error ? (
          <>
            <h1 className="text-xl font-bold text-destructive">Не удалось войти</h1>
            <p className="text-sm text-muted-foreground max-w-sm">{error}</p>
            <a href="/" className="text-sm underline text-primary">
              Вернуться на главную
            </a>
          </>
        ) : done ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground">Вход выполнен, переходим…</p>
          </>
        ) : (
          <>
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground">Завершаем вход через соцсеть…</p>
          </>
        )}
      </div>
    </div>
  );
}
