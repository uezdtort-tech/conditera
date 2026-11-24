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
import { isPlaceholderSupabaseKey } from "./key-validation";

const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const _isProduction = process.env.NODE_ENV === "production";
const _isStub = isPlaceholderSupabaseKey(supabaseAnonKey, !_isProduction);

// NEXT_PUBLIC_* values are embedded into the browser bundle at build time.
// A placeholder here cannot be repaired by injecting a runtime env later.
// Fail the production build instead of shipping a client that can never auth.
if (_isStub && _isProduction) {
  throw new Error(
    "[supabase/browser] Production build requires a real NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
    "A placeholder anon key cannot be replaced at runtime."
  );
}
if (_isStub) {
  console.warn(
    "[supabase/browser] NEXT_PUBLIC_SUPABASE_ANON_KEY is missing or a placeholder; " +
    "browser authentication is unavailable in this development environment."
  );
}

// Браузерный URL: для локального стека — same-origin (см. url.ts),
// для прода — env-домен как есть.
const supabaseUrl = resolveSupabaseBrowserUrl();

export const supabaseBrowser = createBrowserClient(
  supabaseUrl,
  supabaseAnonKey || "dev-only-stub-anon-key",
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
