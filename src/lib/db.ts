/**
 * db.ts — Compatibility shim (v2.0).
 *
 * ВАЖНО: Этот файл больше НЕ использует Prisma!
 * Все API routes, которые импортировали `db` из `@/lib/db`,
 * теперь используют Supabase admin client под капотом.
 *
 * Prisma была полностью удалена из проекта (ТЗ: ❌ ЗАПРЕЩЕНО).
 *
 * Старые v1.0 API routes, которые используют `db.model.findMany()` синтаксис,
 * были постепенно мигрированы на supabase-js.
 *
 * Новые v2.0 routes должны напрямую использовать:
 *   import { supabaseAdmin } from '@/lib/supabase/admin';
 *   await supabaseAdmin.from('profiles').select('*');
 */

// Реэкспортируем supabase admin client как `db`
// чтобы старые импорты `import { db } from '@/lib/db'` продолжали работать
export { supabaseAdmin as db } from "@/lib/supabase/admin";
export { supabaseAdmin } from "@/lib/supabase/admin";
export { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * getDb() — async helper для обратной совместимости со старым кодом,
 * который использовал `const db = await getDb()` (Prisma-стиль).
 * В v2.0 возвращает тот же supabaseAdmin client.
 *
 * Usage:
 *   import { getDb } from '@/lib/db';
 *   const supabase = await getDb();
 *   await supabase.from('orders').select('*');
 */
export async function getDb() {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  return supabaseAdmin;
}

/**
 * initDb() — no-op для обратной совместимости.
 * В Prisma-версии инициализировал соединение с БД.
 * В v2.0 Supabase-клиент инициализируется при импорте, так что ничего не делаем.
 */
export async function initDb() {
  // no-op — supabaseAdmin создаётся при импорте admin.ts
  return;
}

// Заглушка для PrismaClient — чтобы TypeScript не падал на старых импортах
// ВАЖНО: Это НЕ Prisma! Это просто тип для совместимости.
export type PrismaClient = typeof import("@/lib/supabase/admin").supabaseAdmin;
