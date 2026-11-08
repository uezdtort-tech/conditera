/**
 * GET /api/suppliers — публичный список одобренных и активных поставщиков.
 *
 * Видимость (серверная): verificationStatus='approved' AND isActive=true.
 * Приватные данные (email, телефон, контактное лицо, ИНН, адрес) НЕ отдаются —
 * только публичная витрина.
 *
 * Auth: любой аутентифицированный пользователь.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const region = searchParams.get("region")?.trim();
    const category = searchParams.get("category")?.trim();
    const q = searchParams.get("q")?.trim();

    let query = supabaseAdmin
      .from("supplier_profiles")
      .select(
        `id, userId, companyName, description, specialization, productCategories,
         region, deliveryGeography, deliveryTerms, minOrderAmount, pickupAvailable,
         deliveryAvailable, rating, workSchedule, isActive`
      )
      .eq("verificationStatus", "approved")
      .eq("isActive", true)
      .order("rating", { ascending: false })
      .limit(100);

    if (region) query = query.ilike("region", `%${region}%`);

    const { data: suppliers, error } = await query;
    if (error) {
      console.error("[suppliers] GET error:", error.message);
      return NextResponse.json({ error: "Ошибка чтения поставщиков" }, { status: 500 });
    }

    let items = suppliers ?? [];

    if (category) {
      items = items.filter((s: Record<string, unknown>) => {
        const cats = Array.isArray(s.productCategories) ? (s.productCategories as string[]) : [];
        const spec = Array.isArray(s.specialization) ? (s.specialization as string[]) : [];
        return cats.includes(category) || spec.includes(category);
      });
    }
    if (q) {
      const needle = q.toLowerCase();
      items = items.filter((s: Record<string, unknown>) =>
        String(s.companyName ?? "").toLowerCase().includes(needle) ||
        String(s.description ?? "").toLowerCase().includes(needle)
      );
    }

    // Публичный счётчик опубликованных товаров каждого поставщика.
    const pool = getPool();
    const res = await pool.query(
      `SELECT supplier_id, count(*)::int AS cnt
         FROM supplier_products
        WHERE status = 'published' AND is_active = true
        GROUP BY supplier_id`
    );
    const counts: Record<string, number> = Object.fromEntries(
      res.rows.map((r: any) => [r.supplier_id, r.cnt])
    );

    return NextResponse.json({
      items: items.map((s: Record<string, unknown>) => ({
        ...s,
        publishedProducts: counts[String(s.userId)] ?? 0,
      })),
    });
  } catch (e: any) {
    console.error("[suppliers] GET:", e?.message);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
