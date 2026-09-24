"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw, Home } from "lucide-react";

/**
 * Error boundary для роутов Next.js App Router.
 * Срабатывает когда runtime-ошибка возникает в server- или client-компоненте.
 *
 * Документация: https://nextjs.org/docs/app/api-reference/file-conventions/error
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Логируем ошибку (в production — в Sentry/другую систему)
    console.error("[App Error Boundary]", error, {
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
          <AlertCircle className="h-8 w-8 text-destructive" />
        </div>
        <div>
          <h2 className="font-display text-2xl font-bold mb-2">
            Что-то пошло не так
          </h2>
          <p className="text-sm text-muted-foreground">
            Произошла непредвиденная ошибка. Попробуйте обновить страницу или вернуться на главную.
          </p>
        </div>

        {process.env.NODE_ENV === "development" && (
          <details className="text-left text-xs p-3 bg-muted rounded-lg">
            <summary className="cursor-pointer font-medium">
              Детали ошибки (dev only)
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-all text-muted-foreground">
              {error.message}
              {error.digest && `\nDigest: ${error.digest}`}
            </pre>
          </details>
        )}

        <div className="flex gap-2 justify-center">
          <Button onClick={reset} variant="default">
            <RefreshCw className="h-4 w-4 mr-1" />
            Попробовать снова
          </Button>
          <Button
            onClick={() => (window.location.href = "/")}
            variant="outline"
          >
            <Home className="h-4 w-4 mr-1" />
            На главную
          </Button>
        </div>
      </div>
    </div>
  );
}
