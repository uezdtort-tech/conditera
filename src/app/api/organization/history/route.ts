/**
 * GET /api/organization/history — история верификаций организаций (ADMIN).
 *
 * Ответ: { verifications: [...], history: [...], total: number }
 *   • verifications — camelCase-маппинг под AdminOrganizationVerificationTab;
 *   • history — сырые snake_case-строки (обратная совместимость);
 *   • total — полное количество записей в таблице.
 *
 * Поля camelCase-объекта: id, userId, confectionerId, inn, ogrn, kpp,
 * companyName, fullName, opfShort, status, managementName, legalAddress,
 * registeredAt, liquidatedAt, trigger, success, errorMessage, actionTaken,
 * createdAt, user?, confectioner?.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

interface RawVerificationRow {
  id: string;
  user_id: string | null;
  confectioner_id: string | null;
  inn: string;
  ogrn: string | null;
  kpp: string | null;
  company_name: string | null;
  full_name: string | null;
  opf_short: string | null;
  status: string | null;
  management_name: string | null;
  legal_address: string | null;
  registered_at: string | null;
  liquidated_at: string | null;
  trigger: string | null;
  success: boolean | null;
  error_message: string | null;
  action_taken: string | null;
  created_at: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);

    const { data, error } = await supabaseAdmin
      .from("organization_verifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) console.warn("[organization/history] GET error:", error.message);

    const rows = (data || []) as unknown as RawVerificationRow[];

    // Обогащение: имена пользователей и кондитеров для колонок «кто».
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
    const confIds = [...new Set(rows.map((r) => r.confectioner_id).filter(Boolean))] as string[];

    const usersById = new Map<string, { id: string; name: string; email: string }>();
    const confById = new Map<string, { id: string; businessName: string; city: string }>();

    if (userIds.length > 0) {
      const { data: users } = await supabaseAdmin
        .from("profiles")
        .select("id, name, email")
        .in("id", userIds);
      for (const u of (users || []) as Array<{ id: string; name: string | null; email: string | null }>) {
        usersById.set(u.id, { id: u.id, name: u.name || "—", email: u.email || "—" });
      }
    }
    if (confIds.length > 0) {
      const { data: confs } = await supabaseAdmin
        .from("confectioners")
        .select("id, businessName, city")
        .in("id", confIds);
      for (const c of (confs || []) as Array<{ id: string; businessName: string | null; city: string | null }>) {
        confById.set(c.id, { id: c.id, businessName: c.businessName || "—", city: c.city || "—" });
      }
    }

    const verifications = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      confectionerId: r.confectioner_id,
      inn: r.inn,
      ogrn: r.ogrn,
      kpp: r.kpp,
      companyName: r.company_name || "",
      fullName: r.full_name,
      opfShort: r.opf_short,
      status: (r.status || "UNKNOWN").toUpperCase(),
      managementName: r.management_name,
      legalAddress: r.legal_address,
      registeredAt: r.registered_at,
      liquidatedAt: r.liquidated_at,
      trigger: (r.trigger || "REGISTRATION").toUpperCase(),
      success: r.success !== false,
      errorMessage: r.error_message,
      actionTaken: r.action_taken,
      createdAt: r.created_at,
      user: r.user_id ? usersById.get(r.user_id) || null : null,
      confectioner: r.confectioner_id ? confById.get(r.confectioner_id) || null : null,
    }));

    return NextResponse.json({
      verifications,
      history: rows,
      total: verifications.length,
    });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Ошибка", detail }, { status: 500 });
  }
}
