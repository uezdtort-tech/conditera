/**
 * admin.ts — Supabase клиент с SERVICE_ROLE_KEY (полный доступ).
 *
 * ВАЖНО: Использовать ТОЛЬКО на сервере (server components, route handlers).
 * Никогда не импортировать в client components — ключ раскроется!
 *
 * Используется для:
 *   - Администрирования пользователей (бан, удаление)
 *   - Прямого доступа к таблицам в обход RLS
 *   - Запуска Edge Functions programmatically
 *   - Создания storage buckets
 *
 * Usage:
 *   import { supabaseAdmin } from '@/lib/supabase/admin';
 *   await supabaseAdmin.from('user_roles').insert({ user_id, role: 'CONFECTIONER' });
 */

import { createClient } from "@supabase/supabase-js";
import { resolveSupabaseServerUrl } from "./url";
import { isPlaceholderSupabaseKey } from "./key-validation";

const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const isProduction = process.env.NODE_ENV === "production";
const configuredUrl =
  process.env.SUPABASE_INTERNAL_URL?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const configuredKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const isPlaceholderKey = isPlaceholderSupabaseKey(
  configuredKey,
  !isProduction
);
const _isStub = !configuredUrl || isPlaceholderKey;

if (_isStub && isProduction && !isBuildPhase) {
  throw new Error(
    "[supabase/admin] Production requires a real SUPABASE_INTERNAL_URL or " +
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Refusing to start."
  );
}

if (_isStub) {
  console.warn(
    "[supabase/admin] Supabase admin credentials are missing or placeholders. " +
    (isBuildPhase
      ? "A build-only client is used; runtime production will fail closed."
      : "Admin operations are unavailable in this development environment.")
  );
}

const supabaseUrl = configuredUrl || resolveSupabaseServerUrl();
const serviceRoleKey = _isStub ? "build-placeholder-service-role-key" : configuredKey!;

export const supabaseAdmin = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: "public",
    },
    global: {
      headers: {
        "X-Client-Info": "conditera-admin/1.0",
      },
    },
  }
);

/**
 * Проверить, сконфигурирован ли admin-клиент (есть ли env).
 * Если false — admin operations будут падать в runtime.
 * Используйте для guard в опасных операциях.
 */
export function isAdminConfigured(): boolean {
  return !_isStub;
}

// Types helper
export type SupabaseAdminClient = typeof supabaseAdmin;
