/**
 * GET /api/admin/suppliers — очередь модерации поставщиков.
 *
 * Query: ?status=draft|submitted|under_review|changes_requested|approved|rejected|suspended|all
 * Серверная фильтрация (клиентский фильтр не является проверкой доступа).
 * Возвращает summary-счётчики по всем статусам.
 *
 * Auth: ADMIN | SUPER_ADMIN.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const VALID_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
  "rejected",
  "suspended",
] as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status") ?? "all";
    const limit = Math.min(Number(searchParams.get("limit") ?? 100) || 100, 200);

    // Summary по всем статусам (серверные счётчики).
    const { data: all, error: summaryErr } = await supabaseAdmin
      .from("supplier_profiles")
      .select("verificationStatus");

    if (summaryErr) {
      console.error("[admin/suppliers] summary error:", summaryErr.message);
      return NextResponse.json({ error: "Ошибка чтения очереди" }, { status: 500 });
    }
    const summary: Record<string, number> = {};
    for (const row of all ?? []) {
      const s = (row as { verificationStatus?: string }).verificationStatus ?? "draft";
      summary[s] = (summary[s] ?? 0) + 1;
    }

    // Список с серверным фильтром.
    let query = supabaseAdmin
      .from("supplier_profiles")
      .select(
        `id, userId, companyName, inn, legalForm, contactPerson, phone, email, address,
         region, description, specialization, productCategories, wholesaleTerms,
         minOrderAmount, workSchedule, deliveryGeography, deliveryTerms,
         pickupAvailable, deliveryAvailable, isActive, verificationStatus,
         submittedAt, reviewedBy, reviewedAt, reviewComment, suspendedAt, createdAt, updatedAt`
      )
      .order("updatedAt", { ascending: false })
      .limit(limit);

    if (VALID_STATUSES.includes(statusParam as (typeof VALID_STATUSES)[number])) {
      query = query.eq("verificationStatus", statusParam);
    }

    const { data: profiles, error } = await query;
    if (error) {
      console.error("[admin/suppliers] list error:", error.message);
      return NextResponse.json({ error: "Ошибка чтения списка" }, { status: 500 });
    }

    // Обогащение данными пользователей (имя/email владельца).
    const userIds = [...new Set((profiles ?? []).map((p: any) => p.userId))];
    const { data: users } = await supabaseAdmin
      .from("profiles")
      .select("id, name, email, phone")
      .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
    const usersById = new Map((users ?? []).map((u: any) => [u.id, u]));

    const items = (profiles ?? []).map((p: any) => ({
      ...p,
      owner: usersById.get(p.userId) ?? null,
    }));

    return NextResponse.json({ items, summary, total: items.length });
  } catch (e: any) {
    console.error("[admin/suppliers] GET:", e?.message);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
