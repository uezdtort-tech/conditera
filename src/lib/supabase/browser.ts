/**
 * browser.ts — Supabase клиент для браузера (client components).
 *
 * Использует @supabase/ssr для автоматического управления cookies
 * (access token + refresh token в httpOnly cookies).
 *
 * Usage:
 *   import { supabaseBrowser } from '@/lib/supabase/browser';
 *   const { data: { user } } = await supabaseBrowser.auth.getUser();
 */

import { createBrowserClient } from "@supabase/ssr";
import { resolveSupabaseBrowserUrl, SUPABASE_COOKIE_NAME } from "./url";

const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Lazy warning — не падаем в build, только в runtime.
const _isStub = !supabaseAnonKey;
if (_isStub) {
  if (process.env.NODE_ENV === "development") {
    console.warn(
      "[supabase/browser] NEXT_PUBLIC_SUPABASE_ANON_KEY not set. " +
      "Auth will not work. Using stub client."
    );
  } else if (process.env.NODE_ENV === "production") {
    console.warn(
      "[supabase/browser] Supabase env not set. Auth will fail at runtime."
    );
  }
}

// Браузерный URL: для локального стека — same-origin (см. url.ts),
// для прода — env-домен как есть.
const supabaseUrl = resolveSupabaseBrowserUrl();

export const supabaseBrowser = createBrowserClient(
  supabaseUrl,
  supabaseAnonKey || "stub-anon-key",
  { cookieOptions: { name: SUPABASE_COOKIE_NAME } }
);

/**
 * Проверить, сконфигурирован ли browser-клиат.
 */
export function isBrowserConfigured(): boolean {
  return !_isStub;
}

// Types helper — использовать для типизации ответов
export type SupabaseBrowserClient = typeof supabaseBrowser;
