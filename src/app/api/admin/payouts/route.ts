/**
 * GET /api/admin/payouts — список запросов на выплату
 * POST /api/admin/payouts — создать выплату
 * PATCH /api/admin/payouts?action=approve — одобрить/отклонить
 *
 * Auth: GET — аутентифицированные пользователи видят свои запросы,
 *            ADMIN/SUPER_ADMIN/INSPECTOR видят все.
 *       POST — аутентифицированные пользователи могут запросить выплату.
 *       PATCH — только ADMIN/SUPER_ADMIN/INSPECTOR.
 *
 * Безопасность:
 *   • POST: парсинг JSON безопасен (safeJsonBody), 400 при невалидном теле.
 *   • POST: amount валидируется как положительное число, method — enum.
 *   • POST: bankDetails — object, не массив/null (защита от инъекций).
 *   • PATCH: payoutId и action обязательны, action — enum approve/reject.
 *   • При DB error не возвращаем детали БД клиенту.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";
import { safeJsonBody, HttpError, handleRouteError, readEnumField } from "@/lib/http-helpers";

export const runtime = "nodejs";

const ADMIN_PAYOUT_ROLES = ["ADMIN", "SUPER_ADMIN", "INSPECTOR"] as const;
const PAYOUT_METHODS = ["card", "sbp", "bank_account"] as const;
const PAYOUT_ACTIONS = ["approve", "reject"] as const;
const MAX_REJECTION_REASON_LENGTH = 500;
const MAX_BANK_DETAILS_KEYS = 20;

interface CreatePayoutBody {
  amount?: number;
  method?: string;
  bankDetails?: unknown;
}

interface PatchPayoutBody {
  payoutId?: string;
  action?: string;
  rejectionReason?: string;
}

function isAdmin(user: { roles: string[] }): boolean {
  return user.roles.some((r) => (ADMIN_PAYOUT_ROLES as readonly string[]).includes(r));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    let query = supabaseAdmin.from("payout_requests").select("*");
    if (!isAdmin(user)) {
      query = query.eq("user_id", user.id);
    }

    const { data, error } = await query.order("created_at", { ascending: false }).limit(50);
    if (error) {
      console.error("[admin/payouts] GET error:", error.message);
      throw new HttpError(500, "Не удалось получить список выплат");
    }
    return NextResponse.json({ payouts: data });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    const { data: body, error: parseErr } = await safeJsonBody<CreatePayoutBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    // Валидация amount
    const amount = body.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      throw new HttpError(400, "amount должен быть положительным числом");
    }
    if (amount > 10_000_000) {
      throw new HttpError(422, "amount слишком большой (макс 10 000 000 ₽)");
    }

    // Валидация method
    const methodResult = readEnumField(
      { method: body.method || "card" },
      "method",
      PAYOUT_METHODS
    );
    if (methodResult.error || !methodResult.value) {
      throw new HttpError(422, methodResult.error || `method должен быть одним из: ${PAYOUT_METHODS.join(", ")}`);
    }
    const method = methodResult.value;

    // Валидация bankDetails — object с ограничением числа ключей
    let bankDetails: Record<string, unknown> | null = null;
    if (body.bankDetails !== undefined && body.bankDetails !== null) {
      if (typeof body.bankDetails !== "object" || Array.isArray(body.bankDetails)) {
        throw new HttpError(422, "bankDetails должен быть объектом");
      }
      const bd = body.bankDetails as Record<string, unknown>;
      if (Object.keys(bd).length > MAX_BANK_DETAILS_KEYS) {
        throw new HttpError(422, `bankDetails: слишком много полей (макс ${MAX_BANK_DETAILS_KEYS})`);
      }
      bankDetails = bd;
    }

    const { data, error } = await supabaseAdmin
      .from("payout_requests")
      .insert({
        user_id: user.id,
        amount,
        method,
        bank_details: bankDetails,
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      console.error("[admin/payouts] insert failed:", error.message);
      throw new HttpError(500, "Не удалось создать запрос на выплату");
    }

    return NextResponse.json({ payout: data }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();
    if (!isAdmin(user)) {
      return forbiddenResponse("Только админ");
    }

    const { data: body, error: parseErr } = await safeJsonBody<PatchPayoutBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    if (typeof body.payoutId !== "string" || body.payoutId.length === 0) {
      throw new HttpError(400, "payoutId обязателен");
    }

    const actionResult = readEnumField(
      { action: body.action },
      "action",
      PAYOUT_ACTIONS,
      { required: true }
    );
    if (actionResult.error || !actionResult.value) {
      throw new HttpError(422, actionResult.error || `action должен быть одним из: ${PAYOUT_ACTIONS.join(", ")}`);
    }
    const action = actionResult.value;

    const updateData: Record<string, string | null> = {
      processed_by: user.id,
      processed_at: new Date().toISOString(),
    };

    if (action === "approve") {
      updateData.status = "approved";
    } else if (action === "reject") {
      updateData.status = "rejected";
      if (typeof body.rejectionReason === "string" && body.rejectionReason.trim().length > 0) {
        if (body.rejectionReason.length > MAX_REJECTION_REASON_LENGTH) {
          throw new HttpError(
            422,
            `rejectionReason слишком длинный (макс ${MAX_REJECTION_REASON_LENGTH} символов)`
          );
        }
        updateData.rejection_reason = body.rejectionReason;
      }
    }

    const { data, error } = await supabaseAdmin
      .from("payout_requests")
      .update(updateData)
      .eq("id", body.payoutId)
      .select()
      .single();

    if (error) {
      console.error("[admin/payouts] update failed:", error.message);
      throw new HttpError(500, "Не удалось обновить запрос на выплату");
    }
    return NextResponse.json({ payout: data });
  } catch (error) {
    return handleRouteError(error);
  }
}
