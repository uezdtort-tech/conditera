/**
 * Confectioner gate: проверка статуса модерации кондитера.
 *
 * Правила:
 *  - verificationStatus = "pending" → ждёт подтверждения админом.
 *    НЕ может: публиковать товары, принимать заказы, запрашивать выплаты.
 *  - verificationStatus = "approved" → полный доступ.
 *  - verificationStatus = "rejected" → отказ, причина в rejectionReason.
 *  - verificationStatus = "needs_revision" → запрошены правки.
 *
 * Используется в endpoints:
 *  - POST /api/products (создание товара)
 *  - POST /api/orders/[id]/accept (принятие заказа)
 *  - POST /api/payouts/request (выплата)
 *  - PUT /api/confectioners/[id] (изменение профиля — частично)
 *
 * Безопасность:
 *   • Все запросы используют supabaseAdmin.
 *   • При сбое БД возвращаем allowed=false (fail-closed —
 *     нельзя публиковать товары или принимать заказы без проверки).
 *   • Type-safe interfaces (без any).
 */

import { supabaseAdmin } from "./supabase/admin";

export type VerificationStatus = "pending" | "approved" | "rejected" | "needs_revision";

export interface ConfectionerGateResult {
  allowed: boolean;
  reason?: string;
  status: VerificationStatus;
  confectioner?: {
    id: string;
    businessName: string;
    verified: boolean;
    verificationStatus: string;
    rejectionReason?: string | null;
  };
}

interface SupabaseError {
  message: string;
}

interface ConfectionerRow {
  id: string;
  businessName: string | null;
  verified: boolean | null;
  verificationStatus: string | null;
  rejectionReason: string | null;
}

/**
 * Получить кондитера по userId + проверить статус модерации.
 * Fail-closed: при сбое БД возвращаем allowed=false.
 */
export async function checkConfectionerGate(
  userId: string
): Promise<ConfectionerGateResult> {
  // db1-3 (split-brain): confectioners — миграция 0017, camelCase-колонки
  // («userId», «businessName», «verificationStatus», «rejectionReason»);
  // snake_case давал PGRST204 → все gate-проверки были вечным fail-closed.
  const { data: conf, error } = await supabaseAdmin
    .from("confectioners")
    .select("id, businessName, verified, verificationStatus, rejectionReason")
    .eq("userId", userId)
    .maybeSingle() as { data: ConfectionerRow | null; error: SupabaseError | null };

  if (error) {
    console.error("[confectioner-gate] lookup failed:", error.message);
    return {
      allowed: false,
      reason: "Не удалось проверить статус модерации. Попробуйте позже.",
      status: "pending",
    };
  }

  if (!conf) {
    return {
      allowed: false,
      reason: "Профиль кондитера не найден. Создайте профиль кондитера.",
      status: "pending",
    };
  }

  // Normalize to VerificationStatus union — fallback to "pending" для неизвестных значений
  const rawStatus = conf.verificationStatus || "pending";
  const status: VerificationStatus =
    rawStatus === "approved" || rawStatus === "rejected" || rawStatus === "needs_revision"
      ? rawStatus
      : "pending";

  const confectionerData = {
    id: conf.id,
    businessName: conf.businessName || "",
    verified: conf.verified === true,
    verificationStatus: rawStatus,
    rejectionReason: conf.rejectionReason,
  };

  if (status === "approved" || confectionerData.verified) {
    return {
      allowed: true,
      status: "approved",
      confectioner: confectionerData,
    };
  }

  const reasons: Record<VerificationStatus, string> = {
    pending: "Ваш профиль ожидает модерации. После подтверждения администратором вы сможете публиковать товары и принимать заказы.",
    rejected: `Ваш профиль отклонён: ${conf.rejectionReason || "причина не указана"}. Исправьте профиль и отправьте на повторную модерацию.`,
    needs_revision: `Администратор запросил правки: ${conf.rejectionReason || "уточните детали"}. Внесите изменения и отправьте на повторную модерацию.`,
    approved: "", // не должно сюда попасть
  };

  return {
    allowed: false,
    reason: reasons[status],
    status,
    confectioner: confectionerData,
  };
}

/**
 * Может ли кондитер публиковать товары.
 */
export async function canPublishProducts(userId: string): Promise<ConfectionerGateResult> {
  return checkConfectionerGate(userId);
}

/**
 * Может ли кондитер принимать заказы.
 */
export async function canAcceptOrders(userId: string): Promise<ConfectionerGateResult> {
  return checkConfectionerGate(userId);
}

/**
 * Может ли кондитер запрашивать выплаты.
 */
export async function canRequestPayout(userId: string): Promise<ConfectionerGateResult> {
  return checkConfectionerGate(userId);
}
