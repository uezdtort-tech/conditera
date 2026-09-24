/**
 * GET /api/fillings/list — список начинок (для конструктора и каталога)
 *
 * Query: ?status=APPROVED|PENDING|REJECTED|all&flavor_group=&q=&limit=
 * Non-admins видят только APPROVED (плюс свои PENDING).
 *
 * Возвращает начинки из БД с полным описанием, цветовой маркировкой
 * и группировкой по вкусовым категориям.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "APPROVED";
    const flavorGroup = searchParams.get("flavor_group") || searchParams.get("category");
    const q = searchParams.get("q");
    const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);

    const payload = await getUserFromRequest(req);
    const roles = (payload?.roles as string[]) || [];
    const isAdmin = roles.includes("ADMIN") || roles.includes("SUPER_ADMIN");
    const userId = payload?.userId;

    let query = supabaseAdmin
      .from("fillings")
      .select("*")
      .order("status", { ascending: true })  // APPROVED сначала
      .order("usage_count", { ascending: false })  // популярные сначала
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .limit(limit);

    // Фильтр по статусу
    if (status !== "all") {
      if (status === "APPROVED") {
        // Non-admin видит только APPROVED
        if (isAdmin) {
          query = query.eq("status", "APPROVED");
        } else {
          query = query.eq("status", "APPROVED").eq("is_active", true);
        }
      } else if (status === "PENDING") {
        // PENDING видят только админы и создатель
        if (isAdmin) {
          query = query.eq("status", "PENDING");
        } else if (userId) {
          query = query.eq("status", "PENDING").eq("created_by", userId);
        } else {
          query = query.eq("status", "APPROVED"); // fallback
        }
      } else if (status === "REJECTED") {
        if (isAdmin) {
          query = query.eq("status", "REJECTED");
        } else if (userId) {
          query = query.eq("status", "REJECTED").eq("created_by", userId);
        } else {
          query = query.eq("status", "APPROVED"); // fallback
        }
      }
    } else {
      // status=all — админ видит всё, non-admin видит APPROVED + свои
      if (!isAdmin && userId) {
        query = query.or(`status.eq.APPROVED,created_by.eq.${userId}`);
      } else if (!isAdmin) {
        query = query.eq("status", "APPROVED").eq("is_active", true);
      }
    }

    if (flavorGroup) query = query.eq("flavor_group", flavorGroup);
    if (q) query = query.ilike("name", `%${q}%`);

    const { data: fillings, error } = await query;
    if (error) {
      console.warn("[fillings/list] GET error:", error.message);
    }

    return NextResponse.json({
      fillings: fillings || [],
      total: (fillings || []).length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
