/**
 * url.ts — единая точка разрешения Supabase URL и имени session-cookie.
 *
 * Проблема, которую решает:
 *  - В sandbox/preview браузер пользователя НЕ может достучаться до
 *    http://localhost:8000 (это localhost самого пользователя, плюс CSP
 *    upgrade-insecure-requests превращает http в https). Поэтому браузерный
 *    клиент ходит по same-origin: /auth/v1/*, /rest/v1/*, /storage/v1/*
 *    проксируются через next.config.ts rewrites на локальный mini-kong (:8000).
 *  - Storage key GoTrue-сессии выводится из hostname URL
 *    (sb-<первый-label-hostname>-auth-token), поэтому браузер и сервер
 *    обязаны использовать ОДНО имя cookie — фиксируем через cookieOptions.name.
 *
 * Прод-поведение не меняется: если NEXT_PUBLIC_SUPABASE_URL указывает на
 * реальный домен (не localhost/127.0.0.1) — используется он как есть.
 */

const LOCAL_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/;

export function isLocalSupabaseUrl(url: string | undefined): boolean {
  return !url || LOCAL_PATTERN.test(url);
}

/** URL для серверных клиентов (SSR/middleware/admin): env или локальный mini-kong. */
export function resolveSupabaseServerUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (envUrl && !LOCAL_PATTERN.test(envUrl)) return envUrl;
  return envUrl || "http://127.0.0.1:8000";
}

/**
 * URL для браузерного клиента: для локального стека — same-origin (прокси
 * через Next.js rewrites), иначе env (прод-домен Supabase/Kong).
 */
export function resolveSupabaseBrowserUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (typeof window !== "undefined") {
    if (envUrl && !LOCAL_PATTERN.test(envUrl)) return envUrl;
    return window.location.origin;
  }
  // SSR-контекст (защита от случайного вызова на сервере)
  return resolveSupabaseServerUrl();
}

/**
 * Фиксированное имя session-cookie (storage key GoTrue). Одинаковое для
 * браузера и сервера — иначе getSession() на сервере не увидит cookie.
 */
export const SUPABASE_COOKIE_NAME = "sb-conditera-auth-token";
