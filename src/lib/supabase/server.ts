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
import { isPlaceholderSupabaseKey } from "./key-validation";

function getServerSupabaseConfig(): { url: string; anonKey: string } {
  const url =
    process.env.SUPABASE_INTERNAL_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  const isProduction = process.env.NODE_ENV === "production";
  const invalid = !url || isPlaceholderSupabaseKey(anonKey, !isProduction);

  if (invalid && isProduction && !isBuildPhase) {
    throw new Error(
      "[supabase/server] Production requires a real Supabase URL and " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY. Refusing to create an unauthenticated client."
    );
  }

  if (invalid) {
    console.warn(
      "[supabase/server] Supabase URL/anon key is missing or a placeholder; " +
      "the client is not suitable for authenticated requests."
    );
  }

  return {
    url: url || resolveSupabaseServerUrl(),
    anonKey: invalid ? "build-placeholder-anon-key" : anonKey!,
  };
}

export async function createSupabaseServerClient() {
  const { url, anonKey } = getServerSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient(
    url,
    anonKey,
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

/**
 * Не кэшируем SSR-клиент между запросами: он замыкает cookieStore конкретного
 * запроса. Глобальный singleton способен повторно использовать cookies
 * первого пользователя в другом запросе.
 */
export async function getSupabaseServer(): Promise<Awaited<ReturnType<typeof createSupabaseServerClient>>> {
  return createSupabaseServerClient();
}
