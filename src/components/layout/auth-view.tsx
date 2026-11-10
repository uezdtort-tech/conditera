"use client";

/**
 * AuthView — SPA-view входа/регистрации для renderView ("auth").
 *
 * Z-v20 (UX D2): раньше ViewKey "auth" не имел case в renderView — ссылки
 * «Курьерам» в футере и navigate("auth") молча открывали главную.
 * Аутентификация канонична через AuthModal (единственная реализация),
 * поэтому view по монту открывает модалку и рисует понятную подложку.
 */

import { useEffect } from "react";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";

export function AuthView() {
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);
  const authModalOpen = useAppStore((s) => s.authModalOpen);

  useEffect(() => {
    setAuthModalOpen(true);
  }, [setAuthModalOpen]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <LogIn className="h-8 w-8 text-primary" aria-hidden="true" />
        </div>
        <h1 className="font-display text-2xl font-bold">Вход и регистрация</h1>
        <p className="text-sm text-muted-foreground">
          Форма входа открыта рядом. Если вы её закрыли — нажмите кнопку ниже.
          После входа вы попадёте в свой кабинет.
        </p>
        {!authModalOpen && (
          <Button onClick={() => setAuthModalOpen(true)}>Открыть форму входа</Button>
        )}
      </div>
    </div>
  );
}
