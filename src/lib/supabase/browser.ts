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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Lazy warning — не падаем в build, только в runtime.
const _isStub = !supabaseUrl || !supabaseAnonKey;
if (_isStub) {
  if (process.env.NODE_ENV === "development") {
    console.warn(
      "[supabase/browser] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY not set. " +
      "Auth will not work. Using stub client."
    );
  } else if (process.env.NODE_ENV === "production") {
    console.warn(
      "[supabase/browser] Supabase env not set. Auth will fail at runtime."
    );
  }
}

export const supabaseBrowser = createBrowserClient(
  supabaseUrl || "http://localhost:8000",
  supabaseAnonKey || "stub-anon-key"
);

/**
 * Проверить, сконфигурирован ли browser-клиат.
 */
export function isBrowserConfigured(): boolean {
  return !_isStub;
}

// Types helper — использовать для типизации ответов
export type SupabaseBrowserClient = typeof supabaseBrowser;
