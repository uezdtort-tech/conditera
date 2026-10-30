/**
 * GET  /api/admin/users — реальный список пользователей платформы.
 * PATCH /api/admin/users — блокировка/разблокировка пользователя (серверная проверка прав).
 * DELETE /api/admin/users?userId=... — мягкое удаление (deleted_at), без потери заказов.
 *
 * Auth: только ADMIN / SUPER_ADMIN (requireAnyRole).
 *
 * Соответствует таблицам: profiles, user_roles, orders.
 * Заменяет ранее захардкоженный мок-список в админ-панели (запрещён мастер-промптом §17.1/§22).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const MAX_LIMIT = 100;

interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  city: string | null;
  phone: string | null;
  is_blocked: boolean;
  blocked_reason: string | null;
  is_verified: boolean;
  account_type: string;
  created_at: string;
  deleted_at: string | null;
  roles: string[];
  orders_count: number;
}

/** Проверка прав + возврат либо NextResponse-ошибки, либо userId админа. */
async function requireAdmin(request: NextRequest): Promise<{ userId: string } | NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
  if (guard) {
    return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });
  }
  return { userId: user.id };
}

/** Активные роли пользователя из user_roles. */
async function loadRolesMap(userIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (userIds.length === 0) return map;
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role, is_active")
    .in("user_id", userIds)
    .eq("is_active", true);
  if (error) {
    console.warn("[admin/users] roles load failed:", error.message);
    return map;
  }
  for (const r of (data || []) as Array<{ user_id: string; role: string }>) {
    const list = map.get(r.user_id) || [];
    list.push(r.role);
    map.set(r.user_id, list);
  }
  return map;
}

/** Количество заказов по user_id (один запрос, агрегация в JS — объёмы малы). */
async function loadOrderCounts(userIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (userIds.length === 0) return counts;
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("user_id")
    .in("user_id", userIds);
  if (error) {
    console.warn("[admin/users] orders load failed:", error.message);
    return counts;
  }
  for (const o of (data || []) as Array<{ user_id: string | null }>) {
    if (!o.user_id) continue;
    counts.set(o.user_id, (counts.get(o.user_id) || 0) + 1);
  }
  return counts;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const url = new URL(request.url);
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, MAX_LIMIT);

    let query = supabaseAdmin
      .from("profiles")
      .select(
        "id, email, name, city, phone, is_blocked, blocked_reason, is_verified, account_type, created_at, deleted_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (search) {
      // PostgREST or-фильтр: email/имя/телефон
      query = query.or(
        `email.ilike.%${search}%,name.ilike.%${search}%,phone.ilike.%${search}%`
      );
    }

    const { data: profiles, error } = await query;
    if (error) {
      console.error("[admin/users] list failed:", error.message);
      return NextResponse.json({ error: "Ошибка загрузки пользователей" }, { status: 500 });
    }

    const rows = (profiles || []) as Array<Omit<AdminUserRow, "roles" | "orders_count">>;
    const ids = rows.map((r) => r.id);
    const [rolesMap, ordersMap] = await Promise.all([loadRolesMap(ids), loadOrderCounts(ids)]);

    const users: AdminUserRow[] = rows.map((r) => ({
      ...r,
      roles: rolesMap.get(r.id) || [],
      orders_count: ordersMap.get(r.id) || 0,
    }));

    return NextResponse.json({ users, total: users.length, stub: false });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("GET /api/admin/users error:", msg);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;
    const adminId = auth.userId;

    const body = (await request.json()) as {
      userId?: string;
      action?: "block" | "unblock";
      reason?: string;
    };
    const { userId, action } = body;
    if (!userId || !action || !["block", "unblock"].includes(action)) {
      return NextResponse.json(
        { error: "Нужны userId и action (block|unblock)" },
        { status: 400 }
      );
    }
    if (userId === adminId) {
      return NextResponse.json(
        { error: "Нельзя заблокировать собственную учётную запись" },
        { status: 400 }
      );
    }

    // Цель должна существовать
    const { data: target, error: targetErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, name, is_blocked, deleted_at")
      .eq("id", userId)
      .maybeSingle();
    if (targetErr || !target) {
      return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    }

    // SUPER_ADMIN нельзя блокировать из-под ADMIN
    const { data: adminRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", adminId)
      .eq("is_active", true);
    const adminIsSuper = (adminRoles || []).some(
      (r: { role: string }) => r.role === "SUPER_ADMIN"
    );

    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("is_active", true);
    const targetIsSuper = (targetRoles || []).some(
      (r: { role: string }) => r.role === "SUPER_ADMIN"
    );
    if (targetIsSuper && !adminIsSuper) {
      return NextResponse.json(
        { error: "Блокировка SUPER_ADMIN доступна только SUPER_ADMIN" },
        { status: 403 }
      );
    }

    if (action === "block") {
      const reason = (body.reason || "").trim() || "Заблокирован администратором";
      const { error: updErr } = await supabaseAdmin
        .from("profiles")
        .update({ is_blocked: true, blocked_reason: reason, blocked_at: new Date().toISOString() })
        .eq("id", userId);
      if (updErr) {
        console.error("[admin/users] block failed:", updErr.message);
        return NextResponse.json({ error: "Не удалось заблокировать" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, blocked: true, reason });
    }

    const { error: updErr } = await supabaseAdmin
      .from("profiles")
      .update({ is_blocked: false, blocked_reason: null, blocked_at: null })
      .eq("id", userId);
    if (updErr) {
      console.error("[admin/users] unblock failed:", updErr.message);
      return NextResponse.json({ error: "Не удалось разблокировать" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, blocked: false });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("PATCH /api/admin/users error:", msg);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;
    const adminId = auth.userId;

    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "Нужен userId" }, { status: 400 });
    }
    if (userId === adminId) {
      return NextResponse.json({ error: "Нельзя удалить себя" }, { status: 400 });
    }

    const { data: target, error: targetErr } = await supabaseAdmin
      .from("profiles")
      .select("id, deleted_at")
      .eq("id", userId)
      .maybeSingle();
    if (targetErr || !target) {
      return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    }
    if (target.deleted_at) {
      return NextResponse.json({ error: "Пользователь уже удалён" }, { status: 409 });
    }

    // Мягкое удаление: заказы и финансы сохраняются (FK-целостность не нарушается)
    const { error: updErr } = await supabaseAdmin
      .from("profiles")
      .update({ deleted_at: new Date().toISOString(), is_blocked: true })
      .eq("id", userId);
    if (updErr) {
      console.error("[admin/users] soft delete failed:", updErr.message);
      return NextResponse.json({ error: "Не удалось удалить" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, softDeleted: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("DELETE /api/admin/users error:", msg);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
