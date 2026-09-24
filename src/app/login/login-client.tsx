"use client";

import * as React from "react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { SupabaseAuthModal } from "@/components/layout/supabase-auth-modal";

/**
 * LoginClient — клиентский компонент для /login страницы.
 *
 * Открывает AuthModal в fullscreen режиме (всегда открыт, нельзя закрыть без входа).
 */

export default function LoginClient(): React.JSX.Element {
  const [open, setOpen] = React.useState(true);

  const handleOpenChange = (next: boolean): void => {
    // Если закрывают — отправляем на главную
    if (!next) {
      window.location.href = "/";
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <SupabaseAuthModal open={open} onOpenChange={handleOpenChange} defaultMode="login" />
        </div>
      </main>
      <Footer />
    </div>
  );
}
