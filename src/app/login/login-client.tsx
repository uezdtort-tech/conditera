"use client";

import * as React from "react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { AuthModal } from "@/components/layout/auth-modal";
import { useAppStore } from "@/lib/store";
import { toast } from "sonner";

/**
 * LoginClient — клиентский компонент для /login страницы.
 *
 * Монтирует ЕДИНУЮ модалку авторизации (AuthModal → POST /api/auth/login),
 * как на главной странице. Поток:
 *   • открыта сразу (нельзя закрыть без входа);
 *   • успешный вход/регистрация → редирект на /dashboard;
 *   • закрытие модалки без входа (крестик/Escape/overlay) → редирект на /.
 */
export default function LoginClient({ returnTo = "/dashboard", oauthError }: { returnTo?: string; oauthError?: string }): React.JSX.Element {
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);
  const authModalOpen = useAppStore((s) => s.authModalOpen);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  // Открыть модалку при монтировании
  React.useEffect(() => {
    setAuthModalOpen(true);
    if (oauthError) toast.error(oauthError);
  }, [setAuthModalOpen, oauthError]);

  // Редиректы: модалка закрылась → /dashboard (вошли) или / (закрыли без входа)
  const openedRef = React.useRef(false);
  const redirectDoneRef = React.useRef(false);
  React.useEffect(() => {
    if (redirectDoneRef.current) return;
    if (authModalOpen) {
      openedRef.current = true;
      return;
    }
    // Первый рендер до открытия — ещё не считаем «закрытием»
    if (!openedRef.current) return;
    redirectDoneRef.current = true;
    window.location.href = isAuthenticated ? returnTo : "/";
  }, [authModalOpen, isAuthenticated, returnTo]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl">
          <AuthModal />
        </div>
      </main>
      <Footer />
    </div>
  );
}
