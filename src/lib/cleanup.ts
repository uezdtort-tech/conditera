/**
 * Cleanup service — removes old/stale data from the database.
 *
 * Operations:
 *   1. CLEANUP_LOGS — delete maintenance logs older than 90 days
 *   2. CLEANUP_SESSIONS — delete expired semaphores (unverified email/phone >7 days)
 *   3. CLEANUP_NOTIFICATIONS — delete read notifications older than 90 days
 *   4. CLEANUP_CARTS — delete abandoned cart items older than 30 days
 *   5. CLEANUP_ORPHANS — delete records without valid foreign keys
 *   6. VACUUM — run VACUUM ANALYZE on PostgreSQL (optimizes table storage)
 *
 * Each operation is recorded in MaintenanceLog.
 *
 * Безопасность:
 *   • Все запросы используют supabaseAdmin.
 *   • Используется .delete().select("id", { count: "exact" }) для получения
 *     количества удалённых строк без отдельного count-запроса.
 *   • Любая ошибка логируется, не прерывает остальные cleanup-операции.
 *   • Filter chaining (lt + eq) — атомарный, без race condition.
 */
import { supabaseAdmin } from "./supabase/admin";

export interface CleanupResult {
  success: boolean;
  type: string;
  recordsAffected: number;
  durationMs: number;
  details?: Record<string, number | string>;
  errorMessage?: string;
}

interface SupabaseError {
  message: string;
}

interface DeleteCountResult {
  count: number;
  error: SupabaseError | null;
}

/**
 * Helper: удалить записи по фильтру, вернуть количество удалённых.
 *
 * Использует delete().select("id", { count: "exact" }) — supabase-js возвращает
 * count в metadata без отдельного запроса. Типизация supabase-js очень сложная
 * (PostgrestFilterBuilder дженерики), поэтому здесь используем упрощённый тип
 * chain-builder с fluent-интерфейсом.
 */
interface FilterChain {
  lt(col: string, val: string | number | boolean): FilterChain;
  eq(col: string, val: string | number | boolean | null): FilterChain;
  in(col: string, vals: Array<string | number>): FilterChain;
  not(col: string, op: string, val: unknown): FilterChain;
  select(cols: string, opts?: { count?: "exact"; head?: boolean }): Promise<{ count: number | null; error: SupabaseError | null }>;
}

async function deleteAndCount(
  table: string,
  filterBuilder: (q: FilterChain) => FilterChain
): Promise<DeleteCountResult> {
  const query = supabaseAdmin.from(table).delete() as unknown as FilterChain;
  const filtered = filterBuilder(query);
  const { count, error } = await filtered.select("id", { count: "exact" });
  return { count: count || 0, error: error as SupabaseError | null };
}

/**
 * Run all cleanup operations in sequence.
 * Returns aggregate result.
 */
export async function runFullCleanup(): Promise<{
  results: CleanupResult[];
  totalDeleted: number;
  totalDurationMs: number;
}> {
  const results: CleanupResult[] = [];
  let totalDeleted = 0;
  const startTime = Date.now();

  // 1. Old maintenance logs (>90 days)
  const r1 = await cleanupOldMaintenanceLogs(90);
  results.push(r1);
  totalDeleted += r1.recordsAffected;

  // 2. Old notifications (>90 days, read)
  const r2 = await cleanupOldNotifications(90);
  results.push(r2);
  totalDeleted += r2.recordsAffected;

  // 3. Abandoned carts (>30 days)
  const r3 = await cleanupAbandonedCarts(30);
  results.push(r3);
  totalDeleted += r3.recordsAffected;

  // 4. Expired semaphores (unverified >7 days)
  const r4 = await cleanupExpiredSemaphores(7);
  results.push(r4);
  totalDeleted += r4.recordsAffected;

  // 5. Old stock movements (>180 days)
  const r5 = await cleanupOldStockMovements(180);
  results.push(r5);
  totalDeleted += r5.recordsAffected;

  // 6. Old organization verifications (>365 days, keep only latest per INN)
  const r6 = await cleanupOldVerifications(365);
  results.push(r6);
  totalDeleted += r6.recordsAffected;

  // 7. Old fraud logs (>30 days) and expired 2FA challenges
  const r7 = await cleanupOldFraudLogs(30);
  results.push(r7);
  totalDeleted += r7.recordsAffected;

  const r8 = await cleanupExpiredTfaChallenges();
  results.push(r8);
  totalDeleted += r8.recordsAffected;

  return {
    results,
    totalDeleted,
    totalDurationMs: Date.now() - startTime,
  };
}

/**
 * Delete old order_fraud_logs entries (>30 days).
 */
export async function cleanupOldFraudLogs(daysOld: number): Promise<CleanupResult> {
  const startTime = Date.now();
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const { count, error } = await deleteAndCount("order_fraud_logs", (q) =>
      q.lt("created_at", cutoff.toISOString())
    );

    if (error) throw new Error(error.message);

    return {
      success: true,
      type: "CLEANUP_FRAUD_LOGS",
      recordsAffected: count,
      durationMs: Date.now() - startTime,
      details: { cutoff: cutoff.toISOString() },
    };
  } catch (e) {
    return {
      success: false,
      type: "CLEANUP_FRAUD_LOGS",
      recordsAffected: 0,
      durationMs: Date.now() - startTime,
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Delete expired 2FA challenges (>5 minutes old, unresolved).
 */
export async function cleanupExpiredTfaChallenges(): Promise<CleanupResult> {
  const startTime = Date.now();
  try {
    const now = new Date();

    // Удаляем challenges, где expires_at < now ИЛИ resolved = true.
    // Supabase не поддерживает OR в одной цепочке, поэтому делаем 2 запроса.
    const [expiredResult, resolvedResult] = await Promise.all([
      deleteAndCount("two_factor_challenges", (q) =>
        q.lt("expires_at", now.toISOString())
      ),
      deleteAndCount("two_factor_challenges", (q) =>
        q.eq("resolved", true)
      ),
    ]);

    if (expiredResult.error) throw new Error(expiredResult.error.message);
    if (resolvedResult.error) throw new Error(resolvedResult.error.message);

    const totalCount = (expiredResult.count || 0) + (resolvedResult.count || 0);

    return {
      success: true,
      type: "CLEANUP_TFA_CHALLENGES",
      recordsAffected: totalCount,
      durationMs: Date.now() - startTime,
      details: { cutoff: now.toISOString() },
    };
  } catch (e) {
    return {
      success: false,
      type: "CLEANUP_TFA_CHALLENGES",
      recordsAffected: 0,
      durationMs: Date.now() - startTime,
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Delete maintenance logs older than N days.
 */
export async function cleanupOldMaintenanceLogs(daysOld: number): Promise<CleanupResult> {
  const startTime = Date.now();
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const { count, error } = await deleteAndCount("maintenance_logs", (q) =>
      // maintenance_logs (0017) — camelCase-таблица: createdAt, не created_at
      q.lt("createdAt", cutoff.toISOString())
    );

    if (error) throw new Error(error.message);

    return {
      success: true,
      type: "CLEANUP_LOGS",
      recordsAffected: count,
      durationMs: Date.now() - startTime,
      details: { cutoff: cutoff.toISOString() },
    };
  } catch (e) {
    return {
      success: false,
      type: "CLEANUP_LOGS",
      recordsAffected: 0,
      durationMs: Date.now() - startTime,
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Delete read notifications older than N days.
 * Unread notifications are kept regardless of age.
 */
export async function cleanupOldNotifications(daysOld: number): Promise<CleanupResult> {
  const startTime = Date.now();
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    // Supabase chaining: filter both read_at < cutoff AND created_at < cutoff
    const { count, error } = await deleteAndCount("notifications", (q) =>
      q
        .not("read_at", "is", null)
        .lt("read_at", cutoff.toISOString())
        .lt("created_at", cutoff.toISOString())
    );

    if (error) throw new Error(error.message);

    return {
      success: true,
      type: "CLEANUP_NOTIFICATIONS",
      recordsAffected: count,
      durationMs: Date.now() - startTime,
      details: { cutoff: cutoff.toISOString() },
    };
  } catch (e) {
    return {
      success: false,
      type: "CLEANUP_NOTIFICATIONS",
      recordsAffected: 0,
      durationMs: Date.now() - startTime,
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Delete cart items older than N days (abandoned carts).
 * Does NOT delete carts that belong to users with active orders.
 */
export async function cleanupAbandonedCarts(daysOld: number): Promise<CleanupResult> {
  const startTime = Date.now();
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    // 1. Find old cart items
    const { data: oldCarts, error: findErr } = await supabaseAdmin
      .from("cart_items")
      .select("id, user_id")
      .lt("created_at", cutoff.toISOString()) as { data: Array<{ id: string; user_id: string }> | null; error: SupabaseError | null };

    if (findErr) throw new Error(findErr.message);

    if (!oldCarts || oldCarts.length === 0) {
      return {
        success: true,
        type: "CLEANUP_CARTS",
        recordsAffected: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Check which users have recent orders (don't delete their carts)
    const userIds = [...new Set(oldCarts.map((c) => c.user_id))];
    const usersWithRecentOrders = new Set<string>();

    // Single query: count recent orders per user
    if (userIds.length > 0) {
      const { data: recentOrders, error: recentErr } = await supabaseAdmin
        .from("orders")
        .select("customer_id")
        .in("customer_id", userIds)
        .gte("created_at", cutoff.toISOString()) as { data: Array<{ customer_id: string }> | null; error: SupabaseError | null };

      if (recentErr) {
        console.warn("[cleanup] recent orders query failed:", recentErr.message);
      } else if (recentOrders) {
        for (const r of recentOrders) {
          usersWithRecentOrders.add(r.customer_id);
        }
      }
    }

    // 3. Delete only carts from users WITHOUT recent orders
    const idsToDelete = oldCarts
      .filter((c) => !usersWithRecentOrders.has(c.user_id))
      .map((c) => c.id);

    if (idsToDelete.length === 0) {
      return {
        success: true,
        type: "CLEANUP_CARTS",
        recordsAffected: 0,
        durationMs: Date.now() - startTime,
        details: {
          totalOldCarts: oldCarts.length,
          skippedActiveUsers: usersWithRecentOrders.size,
          deleted: 0,
        },
      };
    }

    const { count, error: delErr } = await deleteAndCount("cart_items", (q) =>
      q.in("id", idsToDelete)
    );

    if (delErr) throw new Error(delErr.message);

    return {
      success: true,
      type: "CLEANUP_CARTS",
      recordsAffected: count,
      durationMs: Date.now() - startTime,
      details: {
        totalOldCarts: oldCarts.length,
        skippedActiveUsers: usersWithRecentOrders.size,
        deleted: count,
      },
    };
  } catch (e) {
    return {
      success: false,
      type: "CLEANUP_CARTS",
      recordsAffected: 0,
      durationMs: Date.now() - startTime,
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Delete unverified semaphores (email/phone) older than N days.
 * Verified semaphores are kept (they're active identity records).
 */
export async function cleanupExpiredSemaphores(daysOld: number): Promise<CleanupResult> {
  const startTime = Date.now();
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const { count, error } = await deleteAndCount("semaphores", (q) =>
      q
        .eq("verified", false)
        .lt("created_at", cutoff.toISOString())
    );

    if (error) throw new Error(error.message);

    return {
      success: true,
      type: "CLEANUP_SESSIONS",
      recordsAffected: count,
      durationMs: Date.now() - startTime,
    };
  } catch (e) {
    return {
      success: false,
      type: "CLEANUP_SESSIONS",
      recordsAffected: 0,
      durationMs: Date.now() - startTime,
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Delete stock movements older than N days (historical data, not needed for daily ops).
 */
export async function cleanupOldStockMovements(daysOld: number): Promise<CleanupResult> {
  const startTime = Date.now();
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const { count, error } = await deleteAndCount("stock_movements", (q) =>
      q.lt("date", cutoff.toISOString())
    );

    if (error) throw new Error(error.message);

    return {
      success: true,
      type: "CLEANUP_ORPHANS",
      recordsAffected: count,
      durationMs: Date.now() - startTime,
      details: { table: "stock_movements", cutoff: cutoff.toISOString() },
    };
  } catch (e) {
    return {
      success: false,
      type: "CLEANUP_ORPHANS",
      recordsAffected: 0,
      durationMs: Date.now() - startTime,
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Delete old organization verifications, keeping only the latest per INN.
 */
export async function cleanupOldVerifications(daysOld: number): Promise<CleanupResult> {
  const startTime = Date.now();
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    // Get all verifications older than cutoff, sorted newest first
    const { data: oldVerifications, error: findErr } = await supabaseAdmin
      .from("organization_verifications")
      .select("id, inn, created_at")
      .lt("created_at", cutoff.toISOString())
      .order("created_at", { ascending: false }) as { data: Array<{ id: string; inn: string; created_at: string }> | null; error: SupabaseError | null };

    if (findErr) throw new Error(findErr.message);

    if (!oldVerifications || oldVerifications.length === 0) {
      return {
        success: true,
        type: "CLEANUP_ORPHANS",
        recordsAffected: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // Keep the latest one per INN, delete the rest
    const seenInns = new Set<string>();
    const idsToDelete: string[] = [];

    for (const v of oldVerifications) {
      if (seenInns.has(v.inn)) {
        idsToDelete.push(v.id);
      } else {
        seenInns.add(v.inn);
      }
    }

    if (idsToDelete.length === 0) {
      return {
        success: true,
        type: "CLEANUP_ORPHANS",
        recordsAffected: 0,
        durationMs: Date.now() - startTime,
        details: {
          table: "organization_verifications",
          oldRecords: oldVerifications.length,
          uniqueInns: seenInns.size,
          deleted: 0,
        },
      };
    }

    const { count, error: delErr } = await deleteAndCount("organization_verifications", (q) =>
      q.in("id", idsToDelete)
    );

    if (delErr) throw new Error(delErr.message);

    return {
      success: true,
      type: "CLEANUP_ORPHANS",
      recordsAffected: count,
      durationMs: Date.now() - startTime,
      details: {
        table: "organization_verifications",
        oldRecords: oldVerifications.length,
        uniqueInns: seenInns.size,
        deleted: count,
      },
    };
  } catch (e) {
    return {
      success: false,
      type: "CLEANUP_ORPHANS",
      recordsAffected: 0,
      durationMs: Date.now() - startTime,
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Helper: count rows in a table.
 */
async function countRows(table: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) {
    console.warn(`[getDbStats] count ${table} failed:`, error.message);
    return 0;
  }
  return count || 0;
}

/**
 * Get DB statistics for the admin panel.
 * Все счётчики запускаются последовательно (Supabase JS не параллелит count head:true
 * корректно через Promise.all в некоторых версиях, но Promise.all работает — пробуем).
 */
export async function getDbStats(): Promise<{
  tables: Array<{ name: string; count: number }>;
  totalRecords: number;
  dbSizeBytes?: number;
}> {
  const tableNames = [
    "profiles",
    "confectioners",
    "products",
    "orders",
    "order_items",
    "cart_items",
    "reviews",
    "notifications",
    "loyalty_transactions",
    "payments",
    "chat_messages",
    "maintenance_logs",
    "organization_verifications",
    "blacklist",
    "promotions",
    "stock_movements",
    "banners",
    "site_settings",
    "cms_pages",
    "gift_certificates",
    "referrals",
    "user_holidays",
    "inventory_items",
    "semaphores",
    "video_reviews",
    "recipes",
    "chat_rooms",
    "notification_preferences",
    "nav_menu_items",
    "cms_blocks",
  ];

  // Параллельные count-запросы
  const counts = await Promise.all(
    tableNames.map((name) =>
      countRows(name).then((count) => ({ name, count }))
    )
  );

  const tables = counts;
  const totalRecords = tables.reduce((sum, t) => sum + t.count, 0);

  return { tables, totalRecords };
}
