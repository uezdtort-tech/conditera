/**
 * server.ts — Supabase клиент для сервера (Server Components, Route Handlers).
 *
 * Использует @supabase/ssr с cookies API Next.js 16.
 * Автоматически читает/записывает access и refresh tokens в httpOnly cookies.
 *
 * Usage:
 *   import { createSupabaseServerClient } from '@/lib/supabase/server';
 *   const supabase = await createSupabaseServerClient();
 *   const { data: { user } } = await supabase.auth.getUser();
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { resolveSupabaseServerUrl, SUPABASE_COOKIE_NAME } from "./url";

const supabaseUrl = resolveSupabaseServerUrl();
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const _isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const _isStubAnonKey = !supabaseAnonKey || /^(CHANGE_ME|stub_|fallback-|dev-|dev_|placeholder|example|dummy|test[_-])/i.test(supabaseAnonKey);
if (_isStubAnonKey && process.env.NODE_ENV === "production" && !_isBuildPhase) {
  throw new Error(
    "[supabase/server] NEXT_PUBLIC_SUPABASE_ANON_KEY is required in production."
  );
}
if (_isStubAnonKey) {
  console.warn("[supabase/server] NEXT_PUBLIC_SUPABASE_ANON_KEY not set. Auth will not work.");
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    supabaseUrl,
    supabaseAnonKey || "build-only-stub-anon-key",
    {
      cookieOptions: { name: SUPABASE_COOKIE_NAME },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // Это нормально — middleware обновит сессию.
          }
        },
      },
    }
  );
}

// Singleton для использования в server components
let cachedClient: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;

export async function getSupabaseServer(): Promise<Awaited<ReturnType<typeof createSupabaseServerClient>>> {
  if (!cachedClient) {
    cachedClient = await createSupabaseServerClient();
  }
  return cachedClient;
}
