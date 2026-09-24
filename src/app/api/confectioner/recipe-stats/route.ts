/**
 * GET /api/confectioner/recipe-stats
 *
 * Возвращает статистику по подтверждениям готовности для текущего кондитера:
 *   - total acceptances (active)
 *   - orders placed via recipe acceptances (with revenue)
 *   - top-accepted recipes by orders
 *   - recent recipe-driven orders
 *
 * Auth: CONFECTIONER role.
 *
 * Безопасность:
 *   • GET: требует роль CONFECTIONER.
 *   • BUG FIXED: раньше использовал payload.userId как confectioner_id напрямую,
 *     но confectioner_id ссылается на таблицу confectioners, не на profiles.
 *     Теперь сначала находим conf.id по user_id.
 *   • При сбое основного запроса — fallback на audit_logs.
 *   • Type-safe interfaces для всех возвращаемых данных.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

interface RecipeAcceptanceRow {
  id: string;
  recipe_id: string;
  confectioner_id: string;
  price_from: number | null;
  price_to: number | null;
  prep_days: number | null;
  status: string;
  created_at: string;
}

interface AuditLogRow {
  id: string;
  entity_id: string | null;
  metadata: unknown;
  created_at: string;
}

interface RecipeRow {
  id: string;
  title: string;
  cover_image: string | null;
  difficulty: string | null;
  prep_time: number | null;
  cook_time: number | null;
  category: string | null;
}

interface OrderRow {
  id: string;
  status: string | null;
  total: number;
  created_at: string;
  metadata: unknown;
}

interface ConfectionerRow {
  id: string;
}

interface AcceptanceLike {
  id: string;
  recipe_id: string;
  price_from: number | null;
  price_to: number | null;
  prep_days: number | null;
  status: string;
  created_at: string;
}

const REVENUE_STATUSES = ["completed", "delivered", "paid"];

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    if (!user.roles.includes("CONFECTIONER")) {
      throw new HttpError(403, "Только кондитер");
    }

    // Find confectioner profile (нельзя использовать user.userId как confectioner_id)
    const { data: conf, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("id")
      .eq("user_id", user.userId)
      .maybeSingle() as { data: ConfectionerRow | null; error: SupabaseError | null };

    if (confErr) {
      console.error("[confectioner/recipe-stats] conf lookup failed:", confErr.message);
      throw new HttpError(500, "Не удалось загрузить профиль кондитера");
    }
    if (!conf) {
      throw new HttpError(404, "Профиль кондитера не найден");
    }

    const confectionerId = conf.id;

    // 1. Все подтверждения кондитера (active)
    let acceptances: AcceptanceLike[] = [];
    try {
      const { data, error } = await supabaseAdmin
        .from("recipe_acceptances")
        .select("*")
        .eq("confectioner_id", confectionerId)
        .eq("status", "active")
        .order("created_at", { ascending: false }) as { data: RecipeAcceptanceRow[] | null; error: SupabaseError | null };

      if (error) throw error;
      acceptances = (data || []).map((a) => ({
        id: a.id,
        recipe_id: a.recipe_id,
        price_from: a.price_from,
        price_to: a.price_to,
        prep_days: a.prep_days,
        status: a.status,
        created_at: a.created_at,
      }));
    } catch (e) {
      // Fallback: используем audit_logs если recipe_acceptances недоступны
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[confectioner/recipe-stats] acceptances failed, fallback to audit_logs:", msg);
      try {
        const { data: logs, error: logErr } = await supabaseAdmin
          .from("audit_logs")
          .select("*")
          .eq("action", "recipe_acceptance")
          .eq("user_id", user.userId)
          .order("created_at", { ascending: false }) as { data: AuditLogRow[] | null; error: SupabaseError | null };

        if (logErr) throw logErr;
        acceptances = (logs || []).map((l) => {
          const meta = (l.metadata || {}) as Record<string, unknown>;
          return {
            id: l.id,
            recipe_id: (l.entity_id as string) || "",
            price_from: (meta.priceFrom as number) || 1500,
            price_to: (meta.priceTo as number) || null,
            prep_days: (meta.prepDays as number) || 3,
            status: (meta.status as string) || "active",
            created_at: l.created_at,
          };
        });
      } catch {
        acceptances = [];
      }
    }

    // 2. Загружаем детали рецептов
    const recipeIds = [...new Set(acceptances.map((a) => a.recipe_id))];
    let recipes: RecipeRow[] = [];
    if (recipeIds.length > 0) {
      try {
        const { data, error } = await supabaseAdmin
          .from("recipes")
          .select("id, title, cover_image, difficulty, prep_time, cook_time, category")
          .in("id", recipeIds) as { data: RecipeRow[] | null; error: SupabaseError | null };

        if (error) throw error;
        recipes = data || [];
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[confectioner/recipe-stats] recipes load failed:", msg);
        recipes = [];
      }
    }

    // 3. Считаем заказы, пришедшие через рецепты
    let ordersViaRecipes: OrderRow[] = [];
    let totalRevenueFromRecipes = 0;
    let totalOrdersCount = 0;

    try {
      const { data: allOrders, error } = await supabaseAdmin
        .from("orders")
        .select("id, status, total, created_at, metadata")
        .eq("confectioner_id", confectionerId)
        .order("created_at", { ascending: false })
        .limit(500) as { data: OrderRow[] | null; error: SupabaseError | null };

      if (error) throw error;

      const acceptanceIds = new Set(acceptances.map((a) => a.id));
      ordersViaRecipes = (allOrders || []).filter((o) => {
        const meta = (o.metadata || {}) as Record<string, unknown>;
        const acceptanceId = meta.recipeAcceptanceId as string | undefined;
        return acceptanceId && acceptanceIds.has(acceptanceId);
      });

      totalRevenueFromRecipes = ordersViaRecipes
        .filter((o) => REVENUE_STATUSES.includes((o.status || "").toLowerCase()))
        .reduce((sum, o) => sum + (Number(o.total) || 0), 0);
      totalOrdersCount = ordersViaRecipes.length;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[confectioner/recipe-stats] orders load failed:", msg);
      totalOrdersCount = 0;
      totalRevenueFromRecipes = 0;
    }

    // 4. Top-recipes по числу заказов
    const ordersPerRecipe: Record<string, number> = {};
    for (const o of ordersViaRecipes) {
      const meta = (o.metadata || {}) as Record<string, unknown>;
      const acc = acceptances.find((a) => a.id === meta.recipeAcceptanceId);
      if (acc) {
        const rid = acc.recipe_id;
        ordersPerRecipe[rid] = (ordersPerRecipe[rid] || 0) + 1;
      }
    }

    const topRecipes = Object.entries(ordersPerRecipe)
      .map(([recipeId, count]) => {
        const r = recipes.find((x) => x.id === recipeId);
        const acc = acceptances.find((a) => a.recipe_id === recipeId);
        return {
          recipeId,
          title: r?.title || "Рецепт удалён",
          coverImage: r?.cover_image || null,
          difficulty: r?.difficulty || "easy",
          category: r?.category || "",
          ordersCount: count,
          priceFrom: acc?.price_from || 0,
          prepDays: acc?.prep_days || 3,
        };
      })
      .sort((a, b) => b.ordersCount - a.ordersCount)
      .slice(0, 10);

    // 5. Recent orders (последние 5)
    const recentOrders = ordersViaRecipes.slice(0, 5).map((o) => {
      const meta = (o.metadata || {}) as Record<string, unknown>;
      const acc = acceptances.find((a) => a.id === meta.recipeAcceptanceId);
      const r = recipes.find((x) => x.id === acc?.recipe_id);
      return {
        orderId: o.id,
        status: o.status || "unknown",
        total: o.total,
        createdAt: o.created_at,
        recipeTitle: r?.title || "—",
        recipeId: acc?.recipe_id || null,
      };
    });

    // 6. Конверсия
    const conversionRate = acceptances.length > 0
      ? Math.round((totalOrdersCount / acceptances.length) * 100)
      : 0;

    // 7. Покрытие рецептов
    const acceptancesWithRecipes = acceptances.map((a) => {
      const r = recipes.find((x) => x.id === a.recipe_id);
      const orderCount = ordersPerRecipe[a.recipe_id] || 0;
      return {
        acceptanceId: a.id,
        recipeId: a.recipe_id,
        recipeTitle: r?.title || "Рецепт удалён",
        recipeCover: r?.cover_image || null,
        recipeDifficulty: r?.difficulty || "easy",
        recipeCategory: r?.category || "",
        prepTime: r?.prep_time || 0,
        cookTime: r?.cook_time || 0,
        priceFrom: a.price_from,
        priceTo: a.price_to,
        prepDays: a.prep_days,
        status: a.status,
        createdAt: a.created_at,
        ordersCount: orderCount,
      };
    });

    return NextResponse.json({
      summary: {
        totalAcceptances: acceptances.length,
        activeAcceptances: acceptances.filter((a) => a.status === "active").length,
        totalOrdersViaRecipes: totalOrdersCount,
        totalRevenueFromRecipes,
        conversionRate,
        avgCheck: totalOrdersCount > 0 ? Math.round(totalRevenueFromRecipes / totalOrdersCount) : 0,
      },
      topRecipes,
      recentOrders,
      acceptances: acceptancesWithRecipes,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
