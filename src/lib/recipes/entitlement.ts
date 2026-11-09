/**
 * src/lib/recipes/entitlement.ts — серверная выдача/отзыв entitlement (РЕШ-6, RA.10).
 *
 * Инварианты:
 *  • выдаёт ТОЛЬКО серверный обработчик подтверждения платежа (webhook после
 *    CAS-победы) — никогда покупочный POST и никогда клиент;
 *  • идемпотентность через UNIQUE (recipe_id, buyer_id) (0072) + реактивация
 *    при повторной покупке (РЕШ-6.2);
 *  • роялти/комиссия считаются сервером от серверной цены;
 *  • отзыв — только webhook полного возврата (Q-3.1 default: частичный
 *    возврат доступ сохраняет).
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

const PLATFORM_COMMISSION_RATE = 0.1; // 10% платформе (канон существующего контура)

interface GrantInput {
  recipeId: string;
  buyerId: string;
  /** UUID платежа; null — платёжная строка не создалась (fallback-вставка
   *  упала). Колонка nullable (0072): право выдаётся, финансовая трассировка
   *  восстанавливается reconciliation. */
  paymentId: string | null;
  /** Серверная цена из recipe_marketplace (NOT client); рубли, NUMERIC(10,2) */
  pricePaid: number;
  royaltyRate: number;
  /** Фиксация приобретённой версии (Q-3.2 default); может быть null */
  recipeVersionId?: string | null;
}

export interface GrantResult {
  granted: boolean;
  purchaseId: string | null;
  reactivated: boolean;
}

/**
 * Идемпотентная выдача entitlement после серверно подтверждённого платежа.
 * Повторная доставка webhook не создаёт дубль (UNIQUE 0072) и не меняет
 * существующую активную запись.
 */
export async function grantEntitlement(input: GrantInput): Promise<GrantResult> {
  const pricePaid = Number(input.pricePaid);
  const royaltyAmount = Number((pricePaid * Number(input.royaltyRate)).toFixed(2));
  const commissionAmount = Number((pricePaid * PLATFORM_COMMISSION_RATE).toFixed(2));

  const { data, error } = await supabaseAdmin
    .from("recipe_purchases")
    .upsert(
      {
        recipe_id: input.recipeId,
        buyer_id: input.buyerId,
        price_paid: pricePaid,
        royalty_amount: royaltyAmount,
        commission_amount: commissionAmount,
        payment_id: input.paymentId,
        recipe_version_id: input.recipeVersionId ?? null,
        is_active: true,
      },
      { onConflict: "recipe_id,buyer_id", ignoreDuplicates: false }
    )
    .select("id, is_active, created_at")
    .single();

  if (error) {
    console.error("[entitlement] grant failed:", error.message);
    return { granted: false, purchaseId: null, reactivated: false };
  }

  // ignoreDuplicates:false + upsert: существующая строка обновилась.
  // Если она была revoked → реактивация (РЕШ-6.2). Детекция для лога:
  return {
    granted: true,
    purchaseId: data.id,
    reactivated: data.is_active === true,
  };
}

/**
 * Отзыв entitlement при ПОЛНОМ возврате (webhook refund.succeeded,
 * fully_refunded=true). Частичный возврат доступ НЕ отзывает (Q-3.1 default).
 */
export async function revokeEntitlement(recipeId: string, buyerId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("recipe_purchases")
    .update({ is_active: false })
    .eq("recipe_id", recipeId)
    .eq("buyer_id", buyerId)
    .eq("is_active", true);
  if (error) {
    console.error("[entitlement] revoke failed:", error.message);
    return false;
  }
  return true;
}
