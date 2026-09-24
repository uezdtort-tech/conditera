/**
 * GET /api/confectioner/recipe-acceptances — список рецептов, которые кондитер
 * подтвердил готовность испечь.
 *
 * Auth: CONFECTIONER
 *
 * Соответствует таблице: recipe_acceptances (связь кондитера с рецептами)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

/**
 * GET /api/confectioner/recipe-acceptances — получить список подтверждённых рецептов.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    // Проверка роли — только CONFECTIONER
    const guard = await requireRole(user.id, "CONFECTIONER");
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    try {
      const { data: acceptances, error } = await supabaseAdmin
        .from("recipe_acceptances")
        .select("*")
        .eq("confectioner_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("[confectioner/recipe-acceptances] query error:", error.message);
        return NextResponse.json({ acceptances: [], total: 0 });
      }

      return NextResponse.json({
        acceptances: acceptances || [],
        total: (acceptances || []).length,
      });
    } catch (e: any) {
      console.warn("[confectioner/recipe-acceptances] failed:", e?.message);
      return NextResponse.json({ acceptances: [], total: 0 });
    }
  } catch (error: any) {
    console.error("GET /api/confectioner/recipe-acceptances error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
