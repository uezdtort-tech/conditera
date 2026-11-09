/**
 * src/lib/recipes/access-resolver.ts — ЕДИНЫЙ серверный Access Resolver (RECIPE-03).
 *
 * Спецификация: RA.9 (RECIPE_01_AUDIT_AND_TARGET_ARCHITECTURE.md).
 * Единственная точка решения «можно ли читать содержание рецепта».
 * Никакой другой код (API-обработчики, RSC, UI) не решает это самостоятельно;
 * клиентские payment_id/orderId/флаги игнорируются (ликвидация D3).
 *
 * Правила (первое совпадение):
 *  1. рецепт не published и пользователь не автор/стафф → none/NOT_PUBLISHED
 *  2. автор → full/AUTHOR
 *  3. MODERATOR/ADMIN/SUPER_ADMIN → full/STAFF
 *  4. активного платного оффера нет (деривация ПР-1) → full/FREE_CONTENT
 *  5. есть активный entitlement и связанный платёж подтверждён сервером
 *     (payments.status IN succeeded/escrow/released; refund_amount < amount)
 *     → full/PURCHASED
 *  6. иначе при наличии оффера → preview/PAID_NOT_PURCHASED
 *  7. покупка есть, но платёж refunded → preview/REVOKED_REFUND
 *
 * Инварианты: проверка платежа только по серверным данным; кэша нет
 * (correctness first); RLS — вторая линия, пейволл — здесь (RA.9.7).
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

export type RecipeAccessLevel = "none" | "preview" | "full";
export type RecipeAccessReason =
  | "FREE_CONTENT"
  | "AUTHOR"
  | "STAFF"
  | "PURCHASED"
  | "PAID_NOT_PURCHASED"
  | "NOT_PUBLISHED"
  | "REVOKED_REFUND";

export interface RecipeAccess {
  level: RecipeAccessLevel;
  reason: RecipeAccessReason;
  recipeVersionId?: string | null;
}

const STAFF_ROLES = ["ADMIN", "SUPER_ADMIN", "MODERATOR"] as const;
const CONFIRMED_PAYMENT_STATUSES = new Set(["succeeded", "escrow", "released"]);

/** Платный активный оффер существует? (ПР-1: платность = наличие активного оффера с ценой) */
async function hasActivePaidOffer(recipeId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("recipe_marketplace")
    .select("id, base_price")
    .eq("recipe_id", recipeId)
    .eq("is_published", true)
    .gt("base_price", 0)
    .limit(1);
  if (error) return false;
  return Boolean(data && data.length > 0);
}

/** Пользователь — staff (роль через серверные user_roles, не из JWT-клиента). */
async function isStaff(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("is_active", true)
    .in("role", [...STAFF_ROLES])
    .limit(1);
  if (error) return false;
  return Boolean(data && data.length > 0);
}

/** Последняя зафиксированная версия рецепта (для entitlement без привязки к версии). */
async function latestVersionId(recipeId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("recipe_versions")
    .select("id")
    .eq("recipe_id", recipeId)
    .order("version_no", { ascending: false })
    .limit(1);
  return data?.[0]?.id ?? null;
}

export async function resolveRecipeAccess(
  user: { id: string } | null,
  recipe: { id: string; author_id: string; status: string }
): Promise<RecipeAccess> {
  // Правило 1: не опубликован и не автор/стафф
  const isAuthor = Boolean(user && recipe.author_id === user.id);
  const staff = user ? await isStaff(user.id) : false;
  if (recipe.status !== "published" && !isAuthor && !staff) {
    return { level: "none", reason: "NOT_PUBLISHED" };
  }

  // Правило 2: автор
  if (isAuthor) {
    return { level: "full", reason: "AUTHOR" };
  }

  // Правило 3: staff
  if (staff) {
    return { level: "full", reason: "STAFF" };
  }

  // Правило 4: нет активного платного оффера → бесплатный контент
  const paidOffer = await hasActivePaidOffer(recipe.id);
  if (!paidOffer) {
    return { level: "full", reason: "FREE_CONTENT" };
  }

  // Правила 5/7: entitlement + серверно подтверждённый платёж
  if (user) {
    const { data: purchase } = await supabaseAdmin
      .from("recipe_purchases")
      .select("id, is_active, expires_at, recipe_version_id, payment_id")
      .eq("recipe_id", recipe.id)
      .eq("buyer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1);

    const p = purchase?.[0];
    if (p) {
      // Проверка платежа — только серверные данные (RA.9.2)
      type ConfirmedPaymentRow = { status: string; amount: number; refund_amount: number | null };
      let payment: ConfirmedPaymentRow | null = null;
      if (p.payment_id) {
        const { data: pay } = await supabaseAdmin
          .from("payments")
          .select("status, amount, refund_amount")
          .eq("id", p.payment_id)
          .maybeSingle();
        payment = pay
          ? {
              status: String(pay.status),
              amount: Number(pay.amount),
              refund_amount:
                pay.refund_amount === null || pay.refund_amount === undefined
                  ? null
                  : Number(pay.refund_amount),
            }
          : null;
      }

      const paymentConfirmed =
        payment !== null &&
        CONFIRMED_PAYMENT_STATUSES.has(payment.status) &&
        (payment.refund_amount === null ||
          Number(payment.refund_amount) < Number(payment.amount));

      const notExpired = p.expires_at === null || new Date(p.expires_at) > new Date();

      if (p.is_active && notExpired && paymentConfirmed) {
        // Q-3.2 default: доступ на зафиксированную версию; без привязки — последняя
        const versionId = p.recipe_version_id ?? (await latestVersionId(recipe.id));
        return { level: "full", reason: "PURCHASED", recipeVersionId: versionId };
      }

      // Правило 7: платёж refunded или entitlement отозван → preview
      if (payment && payment.status === "refunded") {
        return { level: "preview", reason: "REVOKED_REFUND" };
      }
      if (!p.is_active) {
        return { level: "preview", reason: "REVOKED_REFUND" };
      }
    }
  }

  // Правило 6: платный, не куплен / платёж не подтверждён
  return { level: "preview", reason: "PAID_NOT_PURCHASED" };
}

/** Гейт контента: возвращает объект без состава при level != 'full'. */
export function gateRecipeContent<T extends Record<string, unknown>>(
  access: RecipeAccess,
  content: T
): T {
  if (access.level === "full") return content;
  const gated = { ...content };
  delete gated.steps;
  delete gated.ingredients;
  delete gated.steps_json;
  delete gated.ingredients_json;
  delete gated.recipe_steps;
  delete gated.recipe_ingredients;
  delete gated.recipe_ingredient_substitutes;
  delete gated.recipe_variants;
  delete gated.recipe_media;
  delete gated.content;
  return gated;
}
