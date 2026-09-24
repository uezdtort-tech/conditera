/**
 * Хелпер для обработки 429 (rate limit) ответов API.
 *
 * Использование:
 *   import { fetchWithFraudHandling } from "@/lib/api-client";
 *
 *   const res = await fetchWithFraudHandling("/api/orders", { ... });
 *   if (res.rateLimited) {
 *     toast.error(res.rateLimitMessage);
 *     return;
 *   }
 *
 * Или с throw:
 *   const data = await fetchWithFraudHandling("/api/orders", { ... }).then(r => r.jsonOrThrow());
 */

import { toast } from "sonner";

export interface RateLimitInfo {
  rateLimited: boolean;
  retryAfter?: number; // секунды
  message?: string;
}

export interface ApiResponse<T = any> extends RateLimitInfo {
  data?: T;
  error?: string;
  status: number;
}

/**
 * Format retry seconds to human-readable string.
 */
export function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `${seconds} сек`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} мин`;
  return `${Math.ceil(seconds / 3600)} ч`;
}

/**
 * Fetch with automatic handling of 429 responses.
 * On 429: shows toast with rate-limit message, returns { rateLimited: true }.
 */
export async function fetchWithFraudHandling<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const res = await fetch(url, options);

  // 429 — Too Many Requests (anti-fraud triggered)
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "60", 10);
    let message = "Слишком много запросов. Попробуйте позже.";
    try {
      const body = await res.json();
      message = body.error || message;
    } catch {}

    const humanMessage = `${message} (через ${formatRetryAfter(retryAfter)})`;
    toast.error(humanMessage, {
      duration: 5000,
      description: "Это защита от автоматических действий. Если вы не робот — просто подождите.",
    });

    return {
      rateLimited: true,
      retryAfter,
      message: humanMessage,
      status: 429,
    };
  }

  // Other error statuses
  if (!res.ok) {
    let error = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      error = body.error || error;
    } catch {}
    return {
      rateLimited: false,
      error,
      status: res.status,
    };
  }

  // Success
  try {
    const data = await res.json();
    return {
      rateLimited: false,
      data,
      status: res.status,
    };
  } catch {
    return {
      rateLimited: false,
      status: res.status,
    };
  }
}

/**
 * Специальный toast для 2FA-требования.
 * Показывается когда payout endpoint вернул 403 с tfaRequired: true.
 */
export function showTfaRequiredToast(message: string) {
  toast.error(message, {
    duration: 8000,
    description: "Введите 6-значный код из приложения-аутентификатора или backup-код.",
    action: {
      label: "Настроить 2FA",
      onClick: () => {
        // Navigate to settings
        window.location.hash = "#dashboard-confectioner/settings";
      },
    },
  });
}
