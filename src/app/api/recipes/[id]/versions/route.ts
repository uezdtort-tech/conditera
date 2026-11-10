/**
 * GET /api/recipes/[id]/versions — список/снапшоты версий рецепта
 * (RECIPE-02, RB.14 «/api/recipes/[id]/versions», RA.8.1, RB.16).
 *
 * Доступ (серверно, supabaseAdmin — НЕ через RLS-надежду):
 *   • автор или ADMIN → полный список (version_no, changelog, origin,
 *     created_at, created_by) БЕЗ тяжёлого snapshot- payload;
 *   • покупатель с активным entitlement (recipe_purchases.is_active=true,
 *     expires_at не истёк, связанный платёж подтверждён сервером — та же
 *     семантика платежа, что в Resolver RA.9.5) → ТОЛЬКО СВОЯ зафиксированная
 *     версия (recipe_version_id покупки; NULL → последняя) с ПОЛНЫМ snapshot;
 *   • остальные → 403 (в том числе preview-пользователи и отозванные
 *     entitlement'ы — история версий не раскрывается).
 *
 * Иммутабельность: UPDATE/DELETE версий не существует ни на уровне API,
 * ни в RLS (политик мутации нет, RB.16) — снапшоты неизменяемы.
 *
 * Ответ: 200 {data: [...], meta?: {fixed_version: true}}.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import { handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Статусы платежа, подтверждающие покупку (тот же набор, что в Resolver). */
const CONFIRMED_PAYMENT_STATUSES = new Set(["succeeded", "escrow", "released"]);

interface PurchaseEntitlement {
  recipe_version_id: string | null;
  payment_id: string | null;
}

/** Активный + серверно подтверждённый платёж? (RA.9.5) */
async function findActivePurchase(
  recipeId: string,
  buyerId: string
): Promise<PurchaseEntitlement | null> {
  const { data, error } = await supabaseAdmin
    .from("recipe_purchases")
    .select("recipe_version_id, payment_id, is_active, expires_at")
    .eq("recipe_id", recipeId)
    .eq("buyer_id", buyerId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  const p = data[0] as {
    recipe_version_id: string | null;
    payment_id: string | null;
    is_active: boolean;
    expires_at: string | null;
  };

  if (!p.is_active) return null;
  if (p.expires_at && new Date(p.expires_at) <= new Date()) return null;

  // Платёж подтверждён ТОЛЬКО по серверным данным (RA.9.2; клиентские флаги
  // не принимаются никогда)
  if (!p.payment_id) return null;
  const { data: pay } = await supabaseAdmin
    .from("payments")
    .select("status, amount, refund_amount")
    .eq("id", p.payment_id)
    .maybeSingle();
  if (!pay) return null;

  const confirmed =
    CONFIRMED_PAYMENT_STATUSES.has(String(pay.status)) &&
    (pay.refund_amount === null ||
      Number(pay.refund_amount) < Number(pay.amount));
  if (!confirmed) return null;

  return { recipe_version_id: p.recipe_version_id, payment_id: p.payment_id };
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Необходима аутентификация" }, { status: 401 });
    }

    const { data: root, error: fetchErr } = await supabaseAdmin
      .from("recipes")
      .select("id, author_id, status")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !root) {
      return NextResponse.json({ error: "Рецепт не найден" }, { status: 404 });
    }
    const recipeId = String(root.id);

    // --- Автор / ADMIN: полный список (без snapshot-payload) ---
    const isAuthor = root.author_id === user.userId;
    const admin = await isAdmin(user.userId);
    if (isAuthor || admin) {
      const { data: versions, error } = await supabaseAdmin
        .from("recipe_versions")
        .select("id, version_no, changelog, origin, created_by, created_at")
        .eq("recipe_id", recipeId)
        .order("version_no", { ascending: false });

      if (error) {
        console.error("[recipes/versions] list error:", error.message);
        return NextResponse.json({ error: "Ошибка при получении версий" }, { status: 500 });
      }

      return NextResponse.json({
        data: versions ?? [],
        meta: { scope: "author", total: versions?.length ?? 0 },
      });
    }

    // --- Покупатель: только СВОЯ зафиксированная версия (полный snapshot) ---
    const purchase = await findActivePurchase(recipeId, user.userId);
    if (!purchase) {
      return NextResponse.json(
        { error: "Доступ к версиям рецепта есть у автора, администратора или покупателя" },
        { status: 403 }
      );
    }

    const fixedVersionId =
      purchase.recipe_version_id ??
      (
        await supabaseAdmin
          .from("recipe_versions")
          .select("id")
          .eq("recipe_id", recipeId)
          .order("version_no", { ascending: false })
          .limit(1)
      ).data?.[0]?.id;

    if (!fixedVersionId) {
      // Покупка без привязки и версий нет (теоретический кейс исторических строк)
      return NextResponse.json(
        { error: "Зафиксированная версия рецепта не найдена" },
        { status: 404 }
      );
    }

    const { data: version, error: verErr } = await supabaseAdmin
      .from("recipe_versions")
      .select("id, version_no, changelog, origin, created_by, created_at, snapshot")
      .eq("id", fixedVersionId)
      .eq("recipe_id", recipeId)
      .maybeSingle();

    if (verErr) {
      console.error("[recipes/versions] fixed version error:", verErr.message);
      return NextResponse.json({ error: "Ошибка при получении версии" }, { status: 500 });
    }
    if (!version) {
      return NextResponse.json(
        { error: "Зафиксированная версия рецепта не найдена" },
        { status: 404 }
      );
    }

    // Массив из одного элемента: единая shape-семантика со списком автора
    return NextResponse.json({
      data: [version],
      meta: { scope: "purchased", fixed_version: true },
    });
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/recipes/[id]/versions",
      component: "recipes",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}
