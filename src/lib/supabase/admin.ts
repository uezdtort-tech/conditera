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

const supabaseUrl = resolveSupabaseServerUrl();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// На этапе сборки допускается временный ключ для пререндера. В production
// runtime отсутствие URL/service-role key — фатальная ошибка, а не отложенный
// сбой отдельных административных запросов.
const _isStub = !process.env.NEXT_PUBLIC_SUPABASE_URL || !serviceRoleKey || /^(CHANGE_ME|stub_|fallback-|dev-|dev_|placeholder|example|dummy|test[_-])/i.test(serviceRoleKey);
const _isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
if (_isStub && process.env.NODE_ENV === "production" && !_isBuildPhase) {
  throw new Error(
    "[supabase/admin] NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY обязательны в production."
  );
}
if (_isStub) {
  console.warn("[supabase/admin] Supabase admin credentials are not configured for this build/runtime.");
}

export const supabaseAdmin = createClient(
  supabaseUrl,
  serviceRoleKey || "stub_build_only_service_role_key",
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
