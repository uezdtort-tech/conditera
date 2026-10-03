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
  // 401 → один refresh + один retry исходного запроса (см. fetchWithAuthRetry)
  const res = await fetchWithAuthRetry(url, options);

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

/**
 * Заголовки для клиентских запросов к Next API routes, требующим аутентификации:
 *   • Authorization: Bearer <access_token> — единый app-JWT (HS256, @/lib/auth).
 *     Источник: sessionStorage `cd_access_token` (кладут POST /api/auth/login,
 *     /api/auth/session, /api/auth/refresh). Fallback — легаси Supabase-сессия
 *     (GoTrue), пока она встречается у старых клиентов.
 *   • x-csrf-token — double-submit cookie для мутаций.
 *
 * Браузер в любом случае шлёт httpOnly cookie `cd_session` (credentials: include),
 * поэтому cookie остаётся каноничным каналом для браузера, Bearer — для
 * программных клиентов и восстановленных сессий.
 *
 * Использование:
 *   const headers = await getSessionAuthHeaders(await getCsrfToken());
 *   const res = await fetch("/api/services?mine=1", { headers });
 */
import { supabaseBrowser } from "@/lib/supabase/browser";

export const ACCESS_TOKEN_STORAGE_KEY = "cd_access_token";

/** Прочитать access-токен из sessionStorage (SSR-safe). */
export function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Сохранить/удалить access-токен в sessionStorage (SSR-safe). */
export function setStoredAccessToken(token: string | null | undefined): void {
  if (typeof window === "undefined") return;
  try {
    if (token) sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
    else sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    // приватный режим / переполненный quota — не критично
  }
}

export async function getSessionAuthHeaders(
  csrf?: string,
  opts?: { json?: boolean }
): Promise<Record<string, string>> {
  // json: false — для multipart/form-data (Content-Type выставит браузер с boundary)
  const headers: Record<string, string> =
    opts?.json === false ? {} : { "Content-Type": "application/json" };
  // 1. Каноничный источник — app-JWT из sessionStorage (единый auth-контракт)
  const stored = getStoredAccessToken();
  if (stored) {
    headers["Authorization"] = `Bearer ${stored}`;
  } else {
    // 2. Легаси-fallback: Supabase GoTrue-сессия (постепенная миграция)
    try {
      const { data } = await supabaseBrowser.auth.getSession();
      const token = data.session?.access_token;
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } catch {
      // нет сессии — запрос уйдёт анонимным (API вернёт 401, UI покажет «Войти»)
    }
  }
  if (csrf) headers["x-csrf-token"] = csrf;
  return headers;
}

/**
 * Обновление access-токена через POST /api/auth/refresh.
 * Refresh-токен берётся сервером из httpOnly cookie `cd_refresh` (credentials: include).
 * Возвращает новый accessToken и кладёт его в sessionStorage.
 */
export async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { accessToken?: string } | null;
    const token = data?.accessToken || null;
    if (token) setStoredAccessToken(token);
    return token;
  } catch {
    return null;
  }
}

// Модульный семафор: в одном «цепочке» вызовов refresh делается один раз
// (параллельные 401-обработчики ждут один и тот же промис → нет петель).
let refreshInFlight: Promise<string | null> | null = null;

/** Refresh не чаще одного раза за «волну» 401: все ожидающие получают один результат. */
function refreshOnce(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      // освобождаем семафор после того, как все текущие microtasks его прочитали
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    });
  }
  return refreshInFlight;
}

/**
 * Обёртка fetch с авто-retry при 401: один POST /api/auth/refresh
 * (credentials include) и один повтор исходного запроса с новым Bearer.
 * Используется в fetchWithFraudHandling; наружу — для программных клиентов.
 */
export async function fetchWithAuthRetry(url: string, options: RequestInit = {}): Promise<Response> {
  let res = await fetch(url, options);
  if (res.status !== 401) return res;
  const newToken = await refreshOnce();
  if (!newToken) return res;
  // Повторяем один раз: подменяем Authorization на свежий токен
  // (старый Bearer из sessionStorage мог протухнуть — refresh-токен обновил доступ).
  const headers = new Headers(options.headers || undefined);
  headers.set("Authorization", `Bearer ${newToken}`);
  res = await fetch(url, { ...options, headers });
  return res;
}

/**
 * CSRF double-submit cookie: токен выдаёт GET /api/csrf-token
 * (тот же токен кладётся в httpOnly cookie csrf_token).
 * Обязателен во всех мутациях: header x-csrf-token.
 */
export async function getCsrfToken(): Promise<string> {
  try {
    const res = await fetch("/api/csrf-token");
    if (!res.ok) return "";
    const data = (await res.json()) as { token?: string };
    return data.token || "";
  } catch {
    return "";
  }
}

/**
 * Полный серверный logout (единый контракт):
 *   1. POST /api/auth/logout (CSRF header + credentials) — сервер чистит
 *      httpOnly cookies cd_session/cd_refresh (+ легаси sb-*).
 *   2. Чистим sessionStorage cd_access_token (Bearer-канал).
 * Ошибки сети/сервера глотаются: локальное состояние всё равно будет сброшено
 * вызывающим кодом (store.logout() → router.refresh()/redirect).
 */
export async function serverLogout(): Promise<void> {
  try {
    const csrf = await getCsrfToken();
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: csrf ? { "x-csrf-token": csrf } : undefined,
    });
  } catch {
    // сервер недоступен — cookies останутся до истечения, но локальную сессию сбрасываем
  }
  setStoredAccessToken(null);
}
