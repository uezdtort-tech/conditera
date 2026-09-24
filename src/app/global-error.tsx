"use client";

import { useEffect } from "react";

/**
 * Global Error boundary — перехватывает ошибки ВНЕ основного layout
 * (например, ошибки в самом root layout).
 *
 * Документация: https://nextjs.org/docs/app/api-reference/file-conventions/global-error
 *
 * ВАЖНО: этот файл заменяет <html> и <body>, поэтому должен содержать
 * полноценную HTML-разметку.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Global Error Boundary]", error, {
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <html lang="ru">
      <body
        style={{
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          margin: 0,
          padding: "2rem",
          background: "#fef9f5",
          color: "#1a1a1a",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ maxWidth: "500px", textAlign: "center" }}>
          <div
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "50%",
              background: "#fee2e2",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1.5rem",
            }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#dc2626"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>

          <h1
            style={{
              fontSize: "1.875rem",
              fontWeight: 700,
              marginBottom: "0.75rem",
            }}
          >
            Критическая ошибка приложения
          </h1>

          <p
            style={{
              fontSize: "0.95rem",
              color: "#666",
              marginBottom: "2rem",
              lineHeight: 1.5,
            }}
          >
            Произошла непредвиденная ошибка, которая не позволяет отобразить страницу.
            Наша команда уже уведомлена. Попробуйте обновить страницу.
          </p>

          {process.env.NODE_ENV === "development" && (
            <pre
              style={{
                textAlign: "left",
                background: "#f3f4f6",
                padding: "1rem",
                borderRadius: "0.5rem",
                fontSize: "0.75rem",
                overflow: "auto",
                maxHeight: "200px",
                margin: "1rem 0",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {error.message}
              {error.digest && `\nDigest: ${error.digest}`}
              {error.stack && `\n\nStack:\n${error.stack}`}
            </pre>
          )}

          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
            <button
              onClick={reset}
              style={{
                padding: "0.6rem 1.25rem",
                background: "#1a1a1a",
                color: "white",
                border: "none",
                borderRadius: "0.375rem",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: 500,
              }}
            >
              Попробовать снова
            </button>
            <button
              onClick={() => (window.location.href = "/")}
              style={{
                padding: "0.6rem 1.25rem",
                background: "transparent",
                color: "#1a1a1a",
                border: "1px solid #d1d5db",
                borderRadius: "0.375rem",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: 500,
              }}
            >
              На главную
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
