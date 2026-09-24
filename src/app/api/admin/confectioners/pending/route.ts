/**
 * GET /api/admin/confectioners/pending — список кондитеров на модерации.
 *
 * Query params:
 *  - status: pending|rejected|needs_revision|approved|all (default: pending)
 *  - limit: 10..100 (default: 50)
 *
 * Возвращает массив confectioners с данными пользователя и summary по статусам.
 *
 * Auth: ADMIN или SUPER_ADMIN
 *
 * Schema: public.confectioners (migration 0017, camelCase columns).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

interface ConfectionerWithUser {
  id: string;
  businessName: string;
  slug: string;
  description: string | null;
  avatar: string | null;
  city: string | null;
  verified: boolean;
  verificationStatus: string;
  rejectionReason: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
  legalInfo: Record<string, unknown> | null;
  taxMode: string | null;
  specialization: string[] | null;
  portfolioImages: string[] | null;
  userId: string;
  user?: { name: string | null; email: string; phone: string | null; created_at: string };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";
    const limit = Math.min(
      MAX_LIMIT,
      parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10)
    );

    // Schema 0017: camelCase columns
    let query = supabaseAdmin
      .from("confectioners")
      .select(
        `
        id, businessName, slug, description, avatar, city, verified,
        verificationStatus, rejectionReason, verifiedBy, verifiedAt,
        createdAt, legalInfo, taxMode, specialization, portfolioImages,
        userId
      `
      )
      .order("createdAt", { ascending: true })
      .limit(limit);

    if (status !== "all") {
      query = query.eq("verificationStatus", status);
    }

    const { data: confectioners, error } = await query;

    if (error) {
      console.error("[admin/confectioners/pending] query error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    // Данные пользователей
    const userIds = (confectioners || []).map((c: any) => c.userId).filter(Boolean);
    const userMap = new Map<string, any>();
    if (userIds.length > 0) {
      const { data: users } = await supabaseAdmin
        .from("profiles")
        .select("id, name, email, phone, created_at")
        .in("id", userIds);
      for (const u of users || []) {
        userMap.set(u.id, u);
      }
    }

    const result: ConfectionerWithUser[] = (confectioners || []).map((c: any) => ({
      id: c.id,
      businessName: c.businessName,
      slug: c.slug,
      description: c.description,
      avatar: c.avatar,
      city: c.city,
      verified: c.verified,
      verificationStatus: c.verificationStatus,
      rejectionReason: c.rejectionReason,
      verifiedBy: c.verifiedBy,
      verifiedAt: c.verifiedAt,
      createdAt: c.createdAt,
      legalInfo: c.legalInfo,
      taxMode: c.taxMode,
      specialization: c.specialization,
      portfolioImages: c.portfolioImages,
      userId: c.userId,
      user: userMap.get(c.userId) || undefined,
    }));

    // Summary по статусам
    const [pendingResult, approvedResult, rejectedResult, needsRevisionResult, totalResult] =
      await Promise.all([
        supabaseAdmin.from("confectioners").select("*", { count: "exact", head: true }).eq("verificationStatus", "pending"),
        supabaseAdmin.from("confectioners").select("*", { count: "exact", head: true }).eq("verificationStatus", "approved"),
        supabaseAdmin.from("confectioners").select("*", { count: "exact", head: true }).eq("verificationStatus", "rejected"),
        supabaseAdmin.from("confectioners").select("*", { count: "exact", head: true }).eq("verificationStatus", "needs_revision"),
        supabaseAdmin.from("confectioners").select("*", { count: "exact", head: true }),
      ]);

    const summary = {
      pending: pendingResult.count || 0,
      approved: approvedResult.count || 0,
      rejected: rejectedResult.count || 0,
      needs_revision: needsRevisionResult.count || 0,
      total: totalResult.count || 0,
    };

    return NextResponse.json({
      confectioners: result,
      summary,
      filter: status,
    });
  } catch (error: any) {
    console.error("GET /api/admin/confectioners/pending error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
