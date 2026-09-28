/**
 * GET /api/admin/payouts — список запросов на выплату
 * POST /api/admin/payouts — создать запрос на выплату (только кондитеры)
 * PATCH /api/admin/payouts?action=approve|reject|complete — стейт-машина выплаты
 *
 * Auth (pay3):
 *   • GET — аутентифицированные видят свои запросы; ADMIN/SUPER_ADMIN/INSPECTOR — все.
 *   • POST — только пользователи с профилем кондитера (прежде любой
 *     аутентифицированный мог создать заявку на любую сумму ≤ 10М без связи
 *     с балансом — спам/фрод-шум; теперь заявка без кондитер-профиля 403).
 *   • PATCH — только ADMIN/SUPER_ADMIN (INSPECTOR исключён: разделение
 *     полномочий — инспектор читает, деньги двигают админы; синхронно с RLS
 *     политикой 0036).
 *
 * PATCH — стейт-машина выплат (pay3), CAS по исходному статусу:
 *   • approve:   pending → approved (админ согласовал; деньги ещё не двигали)
 *   • complete:  approved → paid (админ подтверждает ФАКТИЧЕСКУЮ выплату:
 *                orders.payout_transferred_at проставляется CAS'ом; требует
 *                metadata.orders — состав из /api/payouts/request)
 *   • reject:    pending|approved → rejected (резерв возвращается RPC
 *                add_confectioner_balance, payout_reserved_at снимается)
 *   Прежний PATCH менял статус с любого на любой без предусловий (paid →
 *   rejected, повторный approve), а фронт вообще бил в несуществующий URL
 *   /api/admin/payouts/:id. Повторные переходы теперь дают 409.
 *
 * Безопасность:
 *   • Парсинг JSON безопасен (safeJsonBody), 400 при невалидном теле.
 *   • amount — целое число рублей, 0 < amount ≤ 10 000 000.
 *   • method — enum; bankDetails — object, не массив/null (защита от инъекций).
 *   • Все переходы статусов — через CAS (.in("status", ...)), конкурентный
 *     PATCH даёт 409 вместо двойного исполнения side-effects.
 *   • При DB error не возвращаем детали БД клиенту.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";
import { safeJsonBody, HttpError, handleRouteError, readEnumField } from "@/lib/http-helpers";

export const runtime = "nodejs";

const ADMIN_PAYOUT_ROLES = ["ADMIN", "SUPER_ADMIN", "INSPECTOR"] as const;
/** pay3: деньги двигают только админы (RLS payouts_update_admin@0036 синхронно) */
const ADMIN_PAYOUT_MANAGE_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;
const PAYOUT_METHODS = ["card", "sbp", "bank_account"] as const;
const PAYOUT_ACTIONS = ["approve", "reject", "complete"] as const;
const MAX_REJECTION_REASON_LENGTH = 500;
const MAX_BANK_DETAILS_KEYS = 20;
const MAX_AMOUNT = 10_000_000;

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

interface PayoutRequestRow {
  id: string;
  user_id: string;
  amount: number;
  status: string;
  method?: string;
  metadata: { orders?: string[]; source?: string } | null;
}

function hasRole(user: { roles: string[] }, roles: readonly string[]): boolean {
  return user.roles.some((r) => roles.includes(r));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    let query = supabaseAdmin.from("payout_requests").select("*");
    if (!hasRole(user, ADMIN_PAYOUT_ROLES)) {
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

    // pay3: выплаты — только для кондитеров (прежде POST принимал любой
    // аутентифицированный запрос на любую сумму без связи с балансом)
    const { data: conf, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("id")
      .eq("userId", user.id)
      .maybeSingle();

    if (confErr) {
      console.error("[admin/payouts] confectioner lookup failed:", confErr.message);
      throw new HttpError(500, "Не удалось проверить профиль кондитера");
    }
    if (!conf) {
      return forbiddenResponse("Запросы выплат доступны только кондитерам");
    }

    const { data: body, error: parseErr } = await safeJsonBody<CreatePayoutBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    // Валидация amount (pay3: + целое число рублей)
    const amount = body.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
      throw new HttpError(400, "amount должен быть целым положительным числом рублей");
    }
    if (amount > MAX_AMOUNT) {
      throw new HttpError(422, `amount слишком большой (макс ${MAX_AMOUNT} ₽)`);
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
        metadata: { source: "admin/payouts" },
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

/** CAS-переход статуса заявки. Возвращает строку после апдейта или null (гонка/не найдено). */
async function casTransition(
  payoutId: string,
  fromStatuses: string[],
  patch: Record<string, string | null>
): Promise<{ row: PayoutRequestRow | null; error: string | null }> {
  const { data, error } = await supabaseAdmin
    .from("payout_requests")
    .update({ ...patch, processed_at: new Date().toISOString() })
    .eq("id", payoutId)
    .in("status", fromStatuses)
    .select()
    .maybeSingle() as { data: PayoutRequestRow[] | PayoutRequestRow | null; error: { message: string } | null };

  if (error) return { row: null, error: error.message };
  // update().select() возвращает массив; maybeSingle может дать объект/массив/null
  const row = Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
  return { row, error: null };
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();
    if (!hasRole(user, ADMIN_PAYOUT_MANAGE_ROLES)) {
      return forbiddenResponse("Только ADMIN/SUPER_ADMIN");
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

    // ------------------------------------------------------------------
    // approve: pending → approved
    // ------------------------------------------------------------------
    if (action === "approve") {
      const { row, error } = await casTransition(body.payoutId, ["pending"], {
        status: "approved",
        processed_by: user.id,
      });
      if (error) {
        console.error("[admin/payouts] approve failed:", error);
        throw new HttpError(500, "Не удалось обновить запрос на выплату");
      }
      if (!row) {
        throw new HttpError(409, "Заявка не найдена или статус уже изменился (конкурентное обновление)");
      }
      return NextResponse.json({ payout: row });
    }

    // ------------------------------------------------------------------
    // reject: pending|approved → rejected + возврат резерва
    // ------------------------------------------------------------------
    if (action === "reject") {
      let rejectionReason: string | null = null;
      if (typeof body.rejectionReason === "string" && body.rejectionReason.trim().length > 0) {
        if (body.rejectionReason.length > MAX_REJECTION_REASON_LENGTH) {
          throw new HttpError(
            422,
            `rejectionReason слишком длинный (макс ${MAX_REJECTION_REASON_LENGTH} символов)`
          );
        }
        rejectionReason = body.rejectionReason;
      }

      const { row, error } = await casTransition(body.payoutId, ["pending", "approved"], {
        status: "rejected",
        processed_by: user.id,
        rejection_reason: rejectionReason,
      });
      if (error) {
        console.error("[admin/payouts] reject failed:", error);
        throw new HttpError(500, "Не удалось обновить запрос на выплату");
      }
      if (!row) {
        throw new HttpError(409, "Заявка не найдена или статус уже изменился (конкурентное обновление)");
      }

      // Возврат зарезервированных средств + снятие резерва заказов.
      // Резерв существует только у заявок из /api/payouts/request
      // (metadata.orders; source=admin/payouts не резервирует).
      const warnings: string[] = [];
      const orderIds = Array.isArray(row.metadata?.orders) ? row.metadata!.orders! : [];
      if (orderIds.length > 0) {
        const { error: unreserveErr } = await supabaseAdmin
          .from("orders")
          .update({ payout_reserved_at: null })
          .in("id", orderIds)
          .not("payout_reserved_at", "is", null);
        if (unreserveErr) {
          console.error("[admin/payouts] unreserve failed:", unreserveErr.message);
          warnings.push(`Не удалось снять резерв заказов: ${unreserveErr.message}`);
        }
      }

      // Возврат средств на баланс кондитера (атомарный RPC, 0036)
      const { data: conf, error: confErr } = await supabaseAdmin
        .from("confectioners")
        .select("id")
        .eq("userId", row.user_id)
        .maybeSingle();

      if (confErr || !conf) {
        console.error(
          "[admin/payouts] refund target not found — РУЧНАЯ СВЕРКА:",
          confErr?.message,
          { payoutId: row.id, userId: row.user_id, amount: row.amount }
        );
        warnings.push("Профиль кондитера не найден — возврат резерва требует ручной операции");
      } else {
        const { error: refundErr } = await supabaseAdmin.rpc("add_confectioner_balance", {
          p_confectioner_id: conf.id,
          p_amount: row.amount,
        });
        if (refundErr) {
          console.error(
            "[admin/payouts] REFUND FAILED — РУЧНАЯ СВЕРКА:",
            refundErr.message,
            { payoutId: row.id, confectionerId: conf.id, amount: row.amount }
          );
          warnings.push("Не удалось вернуть резерв на баланс — требуется ручная сверка");
        }
      }

      // Уведомление (non-blocking)
      try {
        const { sendNotification } = await import("@/lib/notifications");
        await sendNotification({
          userId: row.user_id,
          template: "PAYOUT_REJECTED",
          vars: {
            amount: row.amount,
            reason: rejectionReason || "причина не указана",
          },
        });
      } catch (e) {
        console.warn("[admin/payouts] notification failed:", e instanceof Error ? e.message : e);
      }

      return NextResponse.json({ payout: row, warnings: warnings.length > 0 ? warnings : undefined });
    }

    // ------------------------------------------------------------------
    // complete: approved → paid (фактическая выплата подтверждена админом)
    // ------------------------------------------------------------------
    // Состав выплаты обязателен: заявки без metadata.orders (созданные вне
    // /api/payouts/request) не резервируют средства и не могут быть «выплачены»
    const preCheck = await casTransitionRead(body.payoutId);
    if (preCheck.error) {
      console.error("[admin/payouts] complete precheck failed:", preCheck.error);
      throw new HttpError(500, "Не удалось загрузить заявку");
    }
    if (!preCheck.row) {
      throw new HttpError(404, "Заявка не найдена");
    }
    if (preCheck.row.status !== "approved") {
      throw new HttpError(
        409,
        `complete возможен только из статуса approved (текущий: ${preCheck.row.status})`
      );
    }
    const orderIds = Array.isArray(preCheck.row.metadata?.orders)
      ? preCheck.row.metadata!.orders!
      : [];
    if (orderIds.length === 0) {
      throw new HttpError(
        422,
        "Нет состава выплаты (metadata.orders) — заявка создана вне /api/payouts/request и не может быть подтверждена как выплаченная"
      );
    }

    const { row, error } = await casTransition(body.payoutId, ["approved"], {
      status: "paid",
      processed_by: user.id,
    });
    if (error) {
      console.error("[admin/payouts] complete failed:", error);
      throw new HttpError(500, "Не удалось обновить запрос на выплату");
    }
    if (!row) {
      throw new HttpError(409, "Заявка не найдена или статус уже изменился (конкурентное обновление)");
    }

    // Фиксируем фактическую выплату на заказах (CAS; pay3: раньше orders
    // маркировались в payouts/request без CAS и до реальной выплаты)
    const nowIso = new Date().toISOString();
    const warnings: string[] = [];
    let marked = 0;
    for (const orderId of orderIds) {
      const { data: updRows, error: updErr } = await supabaseAdmin
        .from("orders")
        .update({ payout_transferred_at: nowIso })
        .eq("id", orderId)
        .eq("payment_status", "released")
        .is("payout_transferred_at", null)
        .not("payout_reserved_at", "is", null)
        .select("id");
      if (updErr) {
        console.error("[admin/payouts] order payout mark failed:", orderId, updErr.message);
        warnings.push(`Заказ ${orderId}: ошибка маркировки — ${updErr.message}`);
        continue;
      }
      if (!updRows || updRows.length === 0) {
        warnings.push(`Заказ ${orderId}: не помечен выплаченным (статус изменился или резерв снят)`);
        continue;
      }
      marked++;
    }
    if (marked < orderIds.length) {
      console.error(
        "[admin/payouts] partial payout marking:",
        { payoutId: row.id, marked, expected: orderIds.length }
      );
    }

    // Уведомление (non-blocking) — теперь честно: деньги подтверждены админом
    try {
      const { sendNotification } = await import("@/lib/notifications");
      await sendNotification({
        userId: row.user_id,
        template: "PAYOUT_PROCESSED",
        vars: {
          amount: row.amount,
          method: typeof row.method === "string" ? row.method : "card",
        },
      });
    } catch (e) {
      console.warn("[admin/payouts] notification failed:", e instanceof Error ? e.message : e);
    }

    return NextResponse.json({ payout: row, marked, warnings: warnings.length > 0 ? warnings : undefined });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Чтение заявки для precheck complete (без мутации). */
async function casTransitionRead(
  payoutId: string
): Promise<{ row: PayoutRequestRow | null; error: string | null }> {
  const { data, error } = await supabaseAdmin
    .from("payout_requests")
    .select("id, user_id, amount, status, metadata")
    .eq("id", payoutId)
    .maybeSingle() as { data: PayoutRequestRow | null; error: { message: string } | null };
  if (error) return { row: null, error: error.message };
  return { row: data, error: null };
}
