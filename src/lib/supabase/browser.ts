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

// В production нельзя собирать клиентский bundle с фиктивным anon key:
// такой ключ будет встроен в JS и не исправится добавлением env при запуске.
const _isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const _isStub =
  !supabaseAnonKey ||
  /^(CHANGE_ME|stub_|fallback-|dev-|dev_|placeholder|example|dummy|test[_-])/i.test(supabaseAnonKey);

if (_isStub && process.env.NODE_ENV === "production" && !_isBuildPhase) {
  throw new Error(
    "[supabase/browser] NEXT_PUBLIC_SUPABASE_ANON_KEY отсутствует или содержит заглушку. " +
    "Нужен настоящий anon key уже на этапе production-сборки."
  );
}
if (_isStub) {
  console.warn(
    "[supabase/browser] NEXT_PUBLIC_SUPABASE_ANON_KEY не настроен; " +
    "клиентский Supabase Auth не будет работать."
  );
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
