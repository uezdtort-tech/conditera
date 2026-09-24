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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Lazy warning — не падаем в build (next build запускается в production-mode,
// но env могут отсутствовать в build-окружении). Runtime-проверка
// делается в запросах, использующих admin operations.
const _isStub = !supabaseUrl || !serviceRoleKey;
if (_isStub) {
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[supabase/admin] SUPABASE_SERVICE_ROLE_KEY not set. " +
      "Admin operations will fail at runtime. Set the env var before deploy."
    );
  } else {
    console.warn(
      "[supabase/admin] SUPABASE_SERVICE_ROLE_KEY not set. Admin operations will fail."
    );
  }
}

export const supabaseAdmin = createClient(
  supabaseUrl || "http://localhost:8000",
  serviceRoleKey || "stub-service-key",
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
