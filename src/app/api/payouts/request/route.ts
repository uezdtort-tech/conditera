/**
 * POST /api/payouts/request — запрос выплаты кондитером
 *
 * Проверяет:
 * 1. Пользователь — кондитер
 * 2. Организация действующая (verifyForPayout)
 * 3. Сумма ≤ balance
 * 4. Есть завершённые заказы с payout_transferred_at = null И payout_reserved_at = null
 *
 * P0 (pay3, state-machine выплат):
 *   • Созданная заявка остаётся в статусе "pending" — резервирует средства
 *     (RPC deduct_confectioner_balance) и состав (CAS payout_reserved_at на
 *     каждом заказе). Фактическая выплата — только после админ-подтверждения:
 *     PATCH /api/admin/payouts {payoutId, action:"approve"}, затем
 *     action:"complete" ставит
 *     payout_transferred_at и статус "paid". Прежний немедленный "paid"
 *     без провайдера и без админа вводил в заблуждение и обходил одобрение.
 *   • P0-1 (двойная выплата батча): каждый заказ резервируется CAS-апдейтом
 *     (payout_reserved_at IS NULL → NOT NULL). Конкурентная/повторная заявка
 *     не может включить тот же заказ; при частичном сбое резерва — полная
 *     компенсация: возврат резерва RPC add_confectioner_balance + снятие
 *     payout_reserved_at + заявка → rejected. Раньше маркировка заказов шла
 *     без CAS и без проверки ошибок — один и тот же батч можно было списать
 *     дважды (баланс > суммы батча, батч > MAX_ORDERS_FOR_PAYOUT, ретрай).
 *   • Детерминированный батч: ORDER BY created_at (прежде порядок был
 *     недетерминированным — два запроса могли увидеть разные наборы).
 *
 * pay3b (payout-раунд):
 *   • Формула выплаты — единая computeOrderPayout (src/lib/payout-math.ts),
 *     та же, что начисляет эскроу-крон: clamp >= 0 (P1-E: прежде заявка
 *     считала БЕЗ clamp и могла расходиться с начислением).
 *   • Резерв заказа связан с заявкой жёстко: orders.payout_request_id
 *     (0037). Компенсация снимает резерв только СВОЕЙ заявки — раньше
 *     метка nowIso коллационировалась по равенству timestamp (same-ms
 *     коллизия двух заявок теоретически снимала чужой резерв).
 *   • 2FA backup-код списывается атомарным RPC consume_tfa_backup_code
 *     (0037): два параллельных запроса с одним кодом — проходит ровно
 *     один (P1-D: прежде read-verify-filter-write пускал оба). Fallback
 *     на прежнюю семантику при отсутствии RPC (0037 не применена).
 *   • bankDetails: суммарный размер JSON ≤ 4000 символов (прежде был
 *     лимит только на число ключей).
 *
 * Прежние фиксы (pay0-6, db1-2): eligible = payment_status='released' +
 * escrow_released_at NOT NULL; профиль по «userId» (0017, camelCase);
 * fail-closed вместо не-атомарного fallback; выплата только на ПОЛНУЮ
 * сумму батча; запись в payout_requests.
 *
 * Безопасность:
 *   • POST: требует AUTHENTICATED + CONFECTIONER + checkConfectionerGate + verifyForPayout.
 *   • POST: 2FA-проверка если tfa_required_for включает "payout".
 *   • Atomic balance decrement через RPC deduct_confectioner_balance (0013,
 *     гранты 0034: EXECUTE только service_role).
 *   • amount — целое число рублей, совпадающее с расчётом по снапшотам.
 *   • Все db-запросы на supabaseAdmin с type-safe interfaces.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { verifyForPayout } from "@/lib/organization-gate";
import { computeOrderPayout } from "@/lib/payout-math";
import { safeJsonBody, HttpError, handleRouteError, readEnumField } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

/** Строка confectioners (0017, camelCase). */
interface ConfectionerRow {
  id: string;
  businessName: string;
  balance: number | null;
  tariff: string | null;
  legalInfo: unknown;
  userId: string;
}

interface UserTfaRow {
  id: string;
  tfa_enabled: boolean | null;
  tfa_secret: string | null;
  tfa_backup_codes: string[] | null;
  tfa_required_for: string[] | null;
}

interface OrderForPayoutRow {
  id: string;
  number: string;
  total: number;
  delivery_cost: number | null;
  tariff_snapshot: unknown;
  commission_rate_snapshot: number | null;
}

interface PayoutBody {
  amount?: number;
  totpCode?: string;
  backupCode?: string;
  method?: string;
  bankDetails?: unknown;
}

const MAX_ORDERS_FOR_PAYOUT = 50;
const MAX_BANK_DETAILS_KEYS = 20;
/** pay3b: суммарный размер сериализованного bankDetails (защита от раздувания JSONB) */
const MAX_BANK_DETAILS_JSON = 4000;
const PAYOUT_METHODS = ["card", "sbp", "bank_account", "invoice"] as const;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { data: body, error: parseErr } = await safeJsonBody<PayoutBody>(req);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    if (
      typeof body.amount !== "number" ||
      !Number.isFinite(body.amount) ||
      !Number.isInteger(body.amount) ||
      body.amount <= 0
    ) {
      throw new HttpError(400, "Укажите сумму выплаты (целое число рублей)");
    }

    // Способ выплаты (pay3: больше не хардкод «card»); способ получения
    // денег подтверждает админ на этапе approve/complete.
    const methodResult = readEnumField(
      { method: body.method || "card" },
      "method",
      PAYOUT_METHODS
    );
    if (methodResult.error || !methodResult.value) {
      throw new HttpError(422, methodResult.error || `method должен быть одним из: ${PAYOUT_METHODS.join(", ")}`);
    }
    const method = methodResult.value;

    // bankDetails — опциональный объект (куда выводить), без инъекций
    let bankDetails: Record<string, unknown> | null = null;
    if (body.bankDetails !== undefined && body.bankDetails !== null) {
      if (typeof body.bankDetails !== "object" || Array.isArray(body.bankDetails)) {
        throw new HttpError(422, "bankDetails должен быть объектом");
      }
      const bd = body.bankDetails as Record<string, unknown>;
      if (Object.keys(bd).length > MAX_BANK_DETAILS_KEYS) {
        throw new HttpError(422, `bankDetails: слишком много полей (макс ${MAX_BANK_DETAILS_KEYS})`);
      }
      if (JSON.stringify(bd).length > MAX_BANK_DETAILS_JSON) {
        throw new HttpError(422, `bankDetails: слишком большой (макс ${MAX_BANK_DETAILS_JSON} символов)`);
      }
      bankDetails = bd;
    }

    // Находим кондитера по «userId» (db1-2: auth-UUID; на схеме 0017
    // колонки camelCase — «userId»/«businessName», snake_case даёт PGRST204)
    const { data: confectioner, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("id, businessName, balance, tariff, legalInfo, userId")
      .eq("userId", user.userId)
      .maybeSingle() as { data: ConfectionerRow | null; error: SupabaseError | null };

    if (confErr) {
      console.error("[payouts/request] confectioner lookup failed:", confErr.message);
      throw new HttpError(500, "Не удалось загрузить профиль кондитера");
    }
    if (!confectioner) {
      throw new HttpError(404, "Профиль кондитера не найден");
    }

    // Проверка баланса (pre-check для UX; атомарный гейт — RPC deduct)
    const balance = confectioner.balance || 0;
    if (body.amount > balance) {
      throw new HttpError(400, `Недостаточно средств. Доступно: ${balance}₽`);
    }

    // P1: Проверка организации через DaData
    const orgCheck = await verifyForPayout(confectioner.id, body.amount);
    if (!orgCheck.allowed) {
      throw new HttpError(403, `Выплата невозможна: ${orgCheck.reason}`);
    }

    // Gate: кондитер должен быть подтверждён админом
    const { checkConfectionerGate } = await import("@/lib/confectioner-gate");
    const confGate = await checkConfectionerGate(user.userId);
    if (!confGate.allowed) {
      return NextResponse.json(
        {
          error: confGate.reason,
          verificationStatus: confGate.status,
          requiresApproval: true,
        },
        { status: 403 }
      );
    }

    // 2FA-проверка
    const { data: userTfa, error: tfaErr } = await supabaseAdmin
      .from("profiles")
      .select("id, tfa_enabled, tfa_secret, tfa_backup_codes, tfa_required_for")
      .eq("id", user.userId)
      .maybeSingle() as { data: UserTfaRow | null; error: SupabaseError | null };

    if (tfaErr) {
      console.error("[payouts/request] tfa lookup failed:", tfaErr.message);
      throw new HttpError(500, "Не удалось проверить 2FA");
    }

    const tfaRequiredFor = userTfa?.tfa_required_for || [];
    const tfaRequired = userTfa?.tfa_enabled === true && tfaRequiredFor.includes("payout");
    if (tfaRequired) {
      const { totpCode, backupCode } = body;
      if (!totpCode && !backupCode) {
        return NextResponse.json(
          {
            error: "Требуется 2FA-подтверждение",
            tfaRequired: true,
            methods: ["totp", "backup"],
          },
          { status: 403 }
        );
      }
      let tfaOk = false;
      if (totpCode && userTfa?.tfa_secret) {
        const { verifyTotp, decryptSecret } = await import("@/lib/totp");
        try {
          const secret = decryptSecret(userTfa.tfa_secret);
          tfaOk = verifyTotp(totpCode, secret);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[payouts/request] TOTP decrypt failed:", msg);
        }
      } else if (backupCode && userTfa?.tfa_backup_codes) {
        const { verifyBackupCode } = await import("@/lib/totp");
        const backupCodes = userTfa.tfa_backup_codes;
        const usedHash = backupCodes.find((h) => verifyBackupCode(backupCode, [h]));
        if (usedHash) {
          // pay3b P1-D: атомарное списание кода (0037). Guard "код ещё
          // присутствует" внутри UPDATE — гонка двух параллельных запросов
          // с одним кодом проходит ровно у одного (раньше read-filter-write
          // пускал оба, оба получали выплату).
          const { data: consumed, error: consumeErr } = await supabaseAdmin
            .rpc("consume_tfa_backup_code", {
              p_user_id: user.userId,
              p_code_hash: usedHash,
            })
            .single<{ consume_tfa_backup_code: boolean | null }>() as {
              data: { consume_tfa_backup_code: boolean | null } | null;
              error: (SupabaseError & { code?: string }) | null;
            };

          if (consumeErr && consumeErr.code === "PGRST202") {
            // 0037 не применена — прежняя семантика (гонка не закрыта;
            // гейт применения миграций 0034-0037 — ops, см. worklog)
            console.warn(
              "[payouts/request] consume_tfa_backup_code RPC отсутствует — fallback read-filter-write (примените 0037)"
            );
            tfaOk = true;
            await supabaseAdmin
              .from("profiles")
              .update({
                tfa_backup_codes: backupCodes.filter((h) => h !== usedHash),
                updated_at: new Date().toISOString(),
              })
              .eq("id", user.userId);
          } else if (consumeErr) {
            console.error("[payouts/request] backup-code consume failed:", consumeErr.message);
          } else {
            tfaOk = consumed?.consume_tfa_backup_code === true;
          }
        }
      }
      if (!tfaOk) {
        throw new HttpError(403, "Неверный 2FA-код");
      }
    }

    // Находим заказы для выплаты (снапшот тарифа из заказа!)
    // pay3: payout_reserved_at IS NULL — заказы в открытых заявках не
    // включаются повторно (P0-1). pay0-6: 'released' — эскроу действительно
    // релизнут; статус 'succeeded' в payment_status нигде не пишется.
    const { data: eligibleOrders, error: ordersErr } = await supabaseAdmin
      .from("orders")
      .select(`
        id, number, total, delivery_cost,
        tariff_snapshot, commission_rate_snapshot
      `)
      // db1-2: orders.confectioner_id — auth-UUID (0002), поэтому фильтруем
      // по confectioner.userId, а не по confectioner.id (conf_*-cuid).
      .eq("confectioner_id", confectioner.userId)
      .eq("payment_status", "released")
      .not("escrow_released_at", "is", null)
      .in("status", ["DELIVERED", "COMPLETED"])
      .is("payout_transferred_at", null)
      .is("payout_reserved_at", null)
      // pay3: детерминированный батч (прежде порядок был не определён)
      .order("created_at", { ascending: true })
      .limit(MAX_ORDERS_FOR_PAYOUT) as { data: OrderForPayoutRow[] | null; error: SupabaseError | null };

    if (ordersErr) {
      console.error("[payouts/request] eligible orders failed:", ordersErr.message);
      throw new HttpError(500, "Не удалось загрузить заказы для выплаты");
    }

    // pay3b P1-E: считаем сумму к выплате ЕДИНОЙ формулой computeOrderPayout
    // (та же, что начисляет эскроу-крон: clamp >= 0). Прежде здесь формула
    // дублировалась БЕЗ clamp — расхождение «начислено ↔ запрошено».
    let totalPayout = 0;
    const orderPayouts = (eligibleOrders || []).map((o) => {
      const breakdown = computeOrderPayout({
        total: o.total,
        deliveryCost: o.delivery_cost,
        commissionRateSnapshot: o.commission_rate_snapshot,
      });
      if (breakdown.clamped) {
        console.warn(
          `[payouts/request] order ${o.id}: payout clamped to 0 (total ${o.total}, commission ${breakdown.commission}, fee ${breakdown.yookassaFee})`
        );
      }
      totalPayout += breakdown.payout;
      return {
        orderId: o.id,
        orderNumber: o.number,
        payout: breakdown.payout,
        commission: breakdown.commission,
        yookassaFee: breakdown.yookassaFee,
      };
    });

    if (totalPayout <= 0) {
      throw new HttpError(400, "Нет заказов, доступных для выплаты");
    }

    // P0 (pay0-6): выплата — только на ПОЛНУЮ доступную сумму батча.
    // Частичные выплаты — вместе с ledger-учётом (PAY-2/PAY-3+).
    if (body.amount !== totalPayout) {
      throw new HttpError(
        400,
        `Выплата возможна только на полную доступную сумму: ${totalPayout}₽ (по ${(eligibleOrders || []).length} заказам). Частичные выплаты появятся вместе с ledger-учётом.`
      );
    }

    // Регистрируем заявку (статус pending — деньги зарезервируются ниже,
    // фактическая выплата произойдёт на admin complete)
    const { data: payoutRequest, error: payoutReqErr } = await supabaseAdmin
      .from("payout_requests")
      .insert({
        user_id: user.userId,
        amount: body.amount,
        method,
        bank_details: bankDetails,
        status: "pending",
        metadata: {
          source: "payouts/request",
          orders: orderPayouts.map((o) => o.orderId),
        },
      })
      .select("id")
      .single();

    if (payoutReqErr || !payoutRequest) {
      console.error("[payouts/request] payout_requests insert failed:", payoutReqErr?.message);
      throw new HttpError(500, "Не удалось зарегистрировать выплату");
    }

    // Резервируем средства: атомарное списание баланса через RPC (0013)
    const { error: balanceErr } = await supabaseAdmin
      .rpc("deduct_confectioner_balance", {
        p_confectioner_id: confectioner.id,
        p_amount: body.amount,
      });

    if (balanceErr) {
      // P0 (pay0-6): fail-closed, никакого fallback с овердрафтом
      console.error("[payouts/request] balance RPC failed:", balanceErr.message);
      await supabaseAdmin
        .from("payout_requests")
        .update({ status: "rejected", rejection_reason: `balance RPC failed: ${balanceErr.message}` })
        .eq("id", payoutRequest.id);
      throw new HttpError(500, "Сервис баланса недоступен, попробуйте позже");
    }

    // P0-1 (pay3): CAS-резерв каждого заказа. Апдейт проходит ТОЛЬКО если
    // заказ ещё не зарезервирован и не выплачен — конкурентная заявка не
    // может захватить тот же заказ (в отличие от прежней безусловной
    // маркировки без проверки ошибок).
    const nowIso = new Date().toISOString();
    const reserved: string[] = [];
    let reserveRace = false;
    for (const op of orderPayouts) {
      // pay3b P0-B: резерв привязан к заявке жёстко (0037 payout_request_id)
      const { data: updRows, error: updErr } = await supabaseAdmin
        .from("orders")
        .update({ payout_reserved_at: nowIso, payout_request_id: payoutRequest.id })
        .eq("id", op.orderId)
        .eq("payment_status", "released")
        .is("payout_transferred_at", null)
        .is("payout_reserved_at", null)
        .select("id");

      if (updErr) {
        console.error("[payouts/request] order reserve failed:", op.orderId, updErr.message);
        reserveRace = true;
        break;
      }
      if (!updRows || updRows.length === 0) {
        // Заказ забран конкурентной заявкой / изменился статус — откатываем всё
        console.warn("[payouts/request] order reserve CAS lost (concurrent?):", op.orderId);
        reserveRace = true;
        break;
      }
      reserved.push(op.orderId);
    }

    if (reserveRace) {
      // Полная компенсация: снимаем свой резерв, возвращаем средства, rejected
      if (reserved.length > 0) {
        // pay3b: снимаем только СВОЮ привязку (0037 payout_request_id) —
        // прежде метка сверялась по равенству timestamp (same-ms коллизия)
        const { error: unreserveErr } = await supabaseAdmin
          .from("orders")
          .update({ payout_reserved_at: null, payout_request_id: null })
          .in("id", reserved)
          .eq("payout_request_id", payoutRequest.id);
        if (unreserveErr) {
          console.error("[payouts/request] unreserve failed (needs ops):", unreserveErr.message);
        }
      }
      const { error: refundErr } = await supabaseAdmin.rpc("add_confectioner_balance", {
        p_confectioner_id: confectioner.id,
        p_amount: body.amount,
      });
      if (refundErr) {
        console.error(
          "[payouts/request] COMPENSATION FAILED — резерв не возвращён, нужна ручная сверка:",
          refundErr.message,
          { payoutRequestId: payoutRequest.id, confectionerId: confectioner.id, amount: body.amount }
        );
      }
      await supabaseAdmin
        .from("payout_requests")
        .update({
          status: "rejected",
          rejection_reason: "reserve race: состав выплаты изменился конкурентной заявкой",
        })
        .eq("id", payoutRequest.id);
      throw new HttpError(409, "Состав выплаты изменился (конкурентный запрос). Попробуйте ещё раз.");
    }

    // Уведомление о регистрации заявки (non-blocking).
    // pay3: PAYOUT_PROCESSED («деньги поступят на карту») отправляет админ
    // на complete — раньше он уходил здесь, до любой реальной выплаты.
    try {
      const { sendNotification } = await import("@/lib/notifications");
      await sendNotification({
        userId: confectioner.userId,
        template: "PAYOUT_REQUEST_RECEIVED",
        vars: {
          amount: body.amount,
          orders: orderPayouts.length,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[payouts/request] notification failed:", msg);
    }

    return NextResponse.json({
      success: true,
      status: "pending",
      amount: body.amount,
      orders: orderPayouts.length,
      details: orderPayouts,
      message: "Заявка зарегистрирована, средства зарезервированы. Ожидайте подтверждения администратора.",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
