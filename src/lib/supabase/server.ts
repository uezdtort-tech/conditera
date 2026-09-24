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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[supabase/server] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY not set. " +
    "Auth will not work."
  );
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    supabaseUrl || "http://localhost:8000",
    supabaseAnonKey || "stub-anon-key",
    {
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
