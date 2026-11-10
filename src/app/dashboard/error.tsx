"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";
import { reportClientError } from "@/lib/diagnostics/client-report";

/**
 * Segment error boundary для /dashboard (Z-v20 UX-пакет).
 *
 * Ошибка в кабинете больше не проваливается в корневой error.tsx:
 * пользователь видит понятный экран с повтором попытки.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Dashboard Error Boundary]", error, { digest: error.digest });
    reportClientError(error, {
      errorCode: "react_error_boundary",
      route: "/dashboard",
      correlationId: error.digest,
    });
  }, [error]);

  return (
    <main className="min-h-[60vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full text-center space-y-4" role="alert">
        <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
        </div>
        <h1 className="font-display text-2xl font-bold">Кабинет временно недоступен</h1>
        <p className="text-sm text-muted-foreground">
          Произошла ошибка при загрузке личного кабинета. Попробуйте повторить —
          ваши данные не затронуты.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Button onClick={reset}>
            <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
            Повторить
          </Button>
          <Button variant="outline" asChild>
            <a href="/">На главную</a>
          </Button>
        </div>
      </div>
    </main>
  );
}
