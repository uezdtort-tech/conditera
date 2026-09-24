/**
 * Invoice / payout verification helpers.
 *
 * These functions are called BEFORE issuing a B2B invoice or processing a payout
 * to verify the recipient organization is still active.
 *
 * Usage:
 *   import { verifyForInvoice, verifyForPayout } from "@/lib/organization-gate";
 *
 *   if (!await verifyForInvoice(confectionerId)) {
 *     return NextResponse.json({ error: "Получатель недействителен" }, { status: 403 });
 *   }
 *
 * Безопасность:
 *   • Все запросы используют supabaseAdmin.
 *   • legalInfo валидируется через type narrowing.
 *   • При сбое БД возвращаем allowed=false с reason (fail-closed — деньги не выдаём).
 */
import { supabaseAdmin } from "./supabase/admin";
import {
  verifyOrganization,
  recordVerification,
  type VerificationResult,
} from "./dadata";

export interface GateResult {
  allowed: boolean;
  reason?: string;
  verificationId?: string;
  status?: VerificationResult["status"];
}

interface LegalInfo {
  inn?: string;
  status?: string;
  type?: string;
}

interface SupabaseError {
  message: string;
}

interface ConfectionerLegalRow {
  legal_info: unknown;
  user_id: string;
  balance: number | null;
}

interface UserLegalRow {
  account_type: string | null;
  legal_info: unknown;
}

/**
 * Безопасное приведение legal_info (jsonb) к LegalInfo.
 */
function coerceLegalInfo(raw: unknown): LegalInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  return {
    inn: typeof obj.inn === "string" ? obj.inn : undefined,
    status: typeof obj.status === "string" ? obj.status : undefined,
    type: typeof obj.type === "string" ? obj.type : undefined,
  };
}

/**
 * Verify an organization before issuing a B2B invoice.
 * Returns allowed=true if organization is ACTIVE or REORGANIZING.
 * For LIQUIDATED/LIQUIDATING — blocks the invoice and records the verification.
 */
export async function verifyForInvoice(
  confectionerId: string,
  _invoiceAmount?: number
): Promise<GateResult> {
  // Get the confectioner's legal info
  const { data: confectioner, error } = await supabaseAdmin
    .from("confectioners")
    .select("legal_info, user_id")
    .eq("id", confectionerId)
    .maybeSingle() as { data: ConfectionerLegalRow | null; error: SupabaseError | null };

  if (error) {
    console.error("[org-gate] confectioner lookup failed:", error.message);
    return { allowed: false, reason: "Ошибка БД при проверке кондитера" };
  }

  if (!confectioner) {
    return { allowed: false, reason: "Кондитер не найден" };
  }

  const legalInfo = coerceLegalInfo(confectioner.legal_info);
  if (!legalInfo?.inn) {
    return { allowed: false, reason: "У кондитера не указан ИНН организации" };
  }

  const result = await verifyOrganization(legalInfo.inn);

  // If DaData unavailable, allow (dev mode)
  if (result.status === "UNKNOWN" && result.isAllowed) {
    return { allowed: true, status: result.status };
  }

  if (!result.isAllowed) {
    const recorded = await recordVerification(result, {
      userId: confectioner.user_id,
      confectionerId,
      trigger: "INVOICE_ISSUE",
    });
    return {
      allowed: false,
      reason: result.reason || "Организация недействующая",
      verificationId: recorded.id,
      status: result.status,
    };
  }

  return { allowed: true, status: result.status };
}

/**
 * Verify before processing a payout to a confectioner.
 * Same logic as invoice, but records trigger=PAYOUT_REQUEST.
 */
export async function verifyForPayout(
  confectionerId: string,
  payoutAmount?: number
): Promise<GateResult> {
  const { data: confectioner, error } = await supabaseAdmin
    .from("confectioners")
    .select("legal_info, user_id, balance")
    .eq("id", confectionerId)
    .maybeSingle() as { data: ConfectionerLegalRow | null; error: SupabaseError | null };

  if (error) {
    console.error("[org-gate] confectioner lookup failed:", error.message);
    return { allowed: false, reason: "Ошибка БД при проверке кондитера" };
  }

  if (!confectioner) {
    return { allowed: false, reason: "Кондитер не найден" };
  }

  const legalInfo = coerceLegalInfo(confectioner.legal_info);
  if (!legalInfo?.inn) {
    return { allowed: false, reason: "У кондитера не указан ИНН организации" };
  }

  // Check balance — fail-closed при недостатке средств
  const balance = confectioner.balance || 0;
  if (payoutAmount !== undefined && payoutAmount > balance) {
    return {
      allowed: false,
      reason: `Недостаточно средств на балансе (доступно: ${balance}, запрошено: ${payoutAmount})`,
    };
  }

  const result = await verifyOrganization(legalInfo.inn);

  if (result.status === "UNKNOWN" && result.isAllowed) {
    return { allowed: true, status: result.status };
  }

  if (!result.isAllowed) {
    const recorded = await recordVerification(result, {
      userId: confectioner.user_id,
      confectionerId,
      trigger: "PAYOUT_REQUEST",
    });
    return {
      allowed: false,
      reason: result.reason || "Организация недействующая, выплата невозможна",
      verificationId: recorded.id,
      status: result.status,
    };
  }

  return { allowed: true, status: result.status };
}

/**
 * Verify a customer (legal user) before they can place a B2B order.
 * Used for corporate orders.
 */
export async function verifyForCorporateOrder(
  userId: string
): Promise<GateResult> {
  const { data: user, error } = await supabaseAdmin
    .from("profiles")
    .select("account_type, legal_info")
    .eq("id", userId)
    .maybeSingle() as { data: UserLegalRow | null; error: SupabaseError | null };

  if (error) {
    console.error("[org-gate] user lookup failed:", error.message);
    return { allowed: false, reason: "Ошибка БД при проверке пользователя" };
  }

  if (!user) {
    return { allowed: false, reason: "Пользователь не найден" };
  }

  if (user.account_type !== "legal") {
    // Individuals can always order
    return { allowed: true };
  }

  const legalInfo = coerceLegalInfo(user.legal_info);
  if (!legalInfo?.inn) {
    return { allowed: false, reason: "Не указан ИНН организации" };
  }

  const result = await verifyOrganization(legalInfo.inn);

  if (result.status === "UNKNOWN" && result.isAllowed) {
    return { allowed: true, status: result.status };
  }

  if (!result.isAllowed) {
    const recorded = await recordVerification(result, {
      userId,
      trigger: "INVOICE_ISSUE",
    });
    return {
      allowed: false,
      reason: result.reason || "Организация недействующая",
      verificationId: recorded.id,
      status: result.status,
    };
  }

  return { allowed: true, status: result.status };
}
