/**
 * GET /api/recipes/purchases — мои права доступа (entitlements) покупателя
 * (RECIPE-03, RA.9/РЕШ-6).
 *
 * Единственный источник состояния доступа — recipe_purchases (0072:
 * UNIQUE(recipe_id,buyer_id)) + серверно подтверждённый платёж (та же
 * семантика, что Resolver: payments.status IN succeeded/escrow/released,
 * refund_amount < amount). Клиентские флаги/статусы игнорируются.
 *
 * Ответ: 200 { data: Array<{
 *   id, recipe_id, offer_id, recipe_title, recipe_slug, recipe_image,
 *   price_paid, is_active, payment_status, refund_amount,
 *   recipe_version_id, purchased_at, access: "full"|"revoked_refund"|"pending"
 * }> }
 * offer_id — id активного оффера (мост 0068): детальный маршрут
 * /api/recipes/marketplace/[id] адресуется id оффера, не корня recipes.
 * access: full = активный entitlement + подтверждённый платёж;
 *         revoked_refund = возврат средств (Resolver → preview);
 *         pending = оплата ещё не подтверждена (чекаут не завершён).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

const CONFIRMED_PAYMENT_STATUSES = new Set(["succeeded", "escrow", "released"]);

interface PurchaseRow {
  id: string;
  recipe_id: string;
  is_active: boolean | null;
  price_paid: number | null;
  payment_id: string | null;
  recipe_version_id: string | null;
  created_at: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const blocked = await enforceRateLimit(
      request,
      "recipes-purchases",
      RATE_LIMITS.api.limit,
      RATE_LIMITS.api.windowMs
    );
    if (blocked) return blocked as unknown as NextResponse;

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Необходима аутентификация" }, { status: 401 });
    }

    const { data: entitlements, error } = await supabaseAdmin
      .from("recipe_purchases")
      .select(
        "id, recipe_id, is_active, price_paid, payment_id, recipe_version_id, created_at"
      )
      .eq("buyer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("[recipes/purchases] read failed:", error.message);
      return NextResponse.json({ error: "Ошибка чтения покупок" }, { status: 500 });
    }

    const rows = (entitlements ?? []) as PurchaseRow[];
    if (rows.length === 0) return NextResponse.json({ data: [] });

    const recipeIds = [...new Set(rows.map((r) => r.recipe_id))];
    const paymentIds = [...new Set(rows.map((r) => r.payment_id).filter(Boolean))] as string[];

    // Мост 0068: активный оффер — цель навигации UI (детальный маршрут
    // /api/recipes/marketplace/[id] адресуется id оффера, не корня recipes)
    const [recipesRes, paymentsRes, offersRes] = await Promise.all([
      supabaseAdmin
        .from("recipes")
        .select("id, title, slug, image_url, status")
        .in("id", recipeIds),
      paymentIds.length > 0
        ? supabaseAdmin
            .from("payments")
            .select("id, status, refund_amount, amount")
            .in("id", paymentIds)
        : Promise.resolve({ data: [] as unknown[], error: null }),
      supabaseAdmin
        .from("recipe_marketplace")
        .select("id, recipe_id, is_published")
        .in("recipe_id", recipeIds),
    ]);

    const recipeById = new Map<string, Record<string, unknown>>();
    for (const r of (recipesRes.data ?? []) as Array<Record<string, unknown>>) {
      recipeById.set(String(r.id), r);
    }
    const paymentById = new Map<string, Record<string, unknown>>();
    for (const p of (paymentsRes.data ?? []) as Array<Record<string, unknown>>) {
      paymentById.set(String(p.id), p);
    }
    // Приоритет активному офферу (детерминизм при нескольких офферах)
    const offerByRecipe = new Map<string, string>();
    for (const o of (offersRes.data ?? []) as Array<{
      id: string;
      recipe_id: string;
      is_published: boolean | null;
    }>) {
      const prev = offerByRecipe.get(o.recipe_id);
      if (!prev || o.is_published) offerByRecipe.set(o.recipe_id, o.id);
    }

    const data = rows.map((row) => {
      const recipe = recipeById.get(row.recipe_id);
      const payment = row.payment_id ? paymentById.get(row.payment_id) : null;
      const paymentStatus = payment ? String(payment.status ?? "pending") : "pending";
      const refundAmount =
        payment && payment.refund_amount !== null && payment.refund_amount !== undefined
          ? Number(payment.refund_amount)
          : null;
      const amount =
        payment && payment.amount !== null && payment.amount !== undefined
          ? Number(payment.amount)
          : null;
      const fullyRefunded = refundAmount !== null && amount !== null && refundAmount >= amount;
      const confirmed = CONFIRMED_PAYMENT_STATUSES.has(paymentStatus) && !fullyRefunded;

      const access = !row.is_active ? "revoked_refund" : confirmed ? "full" : "pending";

      return {
        id: row.id,
        recipe_id: row.recipe_id,
        offer_id: offerByRecipe.get(row.recipe_id) ?? null,
        recipe_title: recipe ? String(recipe.title ?? "") : "",
        recipe_slug: recipe ? String(recipe.slug ?? "") : "",
        recipe_image: recipe ? ((recipe.image_url as string | null) ?? null) : null,
        price_paid: row.price_paid,
        is_active: row.is_active !== false,
        payment_status: paymentStatus,
        refund_amount: refundAmount,
        recipe_version_id: row.recipe_version_id,
        purchased_at: row.created_at,
        access,
      };
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/recipes/purchases",
      component: "recipes",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}
