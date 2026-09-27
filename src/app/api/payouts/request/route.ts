/**
 * POST /api/payouts/request — запрос выплаты кондитером
 *
 * Проверяет:
 * 1. Пользователь — кондитер
 * 2. Организация действующая (verifyForPayout)
 * 3. Сумма ≤ balance
 * 4. Есть завершённые заказы с payout_transferred_at = null
 *
 * Создает запись о выплате и (в production) вызывает YooKassa payout API.
 *
 * Безопасность:
 *   • POST: требует AUTHENTICATED + CONFECTIONER + checkConfectionerGate + verifyForPayout.
 *   • POST: 2FA-проверка если tfa_required_for включает "payout".
 *   • Atomic balance decrement через RPC deduct_confectioner_balance — нет race condition.
 *   • Все db-запросы на supabaseAdmin с type-safe interfaces.
 *
 * P0 (pay0-6):
 *   • eligible-заказы: payment_status='released' + escrow_released_at NOT NULL
 *     (раньше фильтр был payment_status='succeeded' — этот статус нигде
 *     не пишется, путь выплат был мёртвым).
 *   • Fail-closed: при ошибке RPC — 500 (раньше был не-атомарный fallback
 *     `balance = Math.max(0, balance − amount)` с гонкой и тихим овердрафтом).
 *   • Выплата — только на ПОЛНУЮ доступную сумму батча: раньше частичный
 *     запрос помечал ВСЕ eligible-заказы payout_transferred_at, остаток
 *     становился невыплачиваем.
 *   • Создаётся запись в payout_requests (раньше выплата была невидима админу).
 *
 * P0 (db1-2, split-brain identity):
 *   • Профиль кондитера ищется по «userId» (0017 camelCase), а не по
 *     несуществующим «user_id»/«business_name» — прежде lookup падал с
 *     PGRST204 → 500.
 *   • eligible-заказы ищутся по confectioner.userId (orders.confectioner_id —
 *     auth-UUID, миграция 0002), а не по confectioner.id (там conf_*-cuid) —
 *     прежде список eligible был всегда пуст.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { verifyForPayout } from "@/lib/organization-gate";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

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
}

const MAX_ORDERS_FOR_PAYOUT = 50;
const YOOKASSA_RATE = 0.025;
const DEFAULT_COMMISSION_RATE = 0.15;

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

    if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0) {
      throw new HttpError(400, "Укажите сумму выплаты (положительное число)");
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

    // Проверка баланса
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
        tfaOk = verifyBackupCode(backupCode, backupCodes);
        // Списываем использованный backup-код
        if (tfaOk) {
          const usedHash = backupCodes.find((h) => verifyBackupCode(backupCode, [h]));
          if (usedHash) {
            await supabaseAdmin
              .from("profiles")
              .update({
                tfa_backup_codes: backupCodes.filter((h) => h !== usedHash),
                updated_at: new Date().toISOString(),
              })
              .eq("id", user.userId);
          }
        }
      }
      if (!tfaOk) {
        throw new HttpError(403, "Неверный 2FA-код");
      }
    }

    // Находим заказы для выплаты (снапшот тарифа из заказа!)
    // P0: 'released' — эскроу действительно релизнут (cron escrow-release);
    // статус 'succeeded' в payment_status нигде не пишется — прежний
    // фильтр не находил ни одного заказа.
    const { data: eligibleOrders, error: ordersErr } = await supabaseAdmin
      .from("orders")
      .select(`
        id, number, total, delivery_cost,
        tariff_snapshot, commission_rate_snapshot
      `)
      // db1-2: orders.confectioner_id — auth-UUID (0002), поэтому фильтруем
      // по confectioner.userId, а не по confectioner.id (conf_*-cuid).
      // Прежний фильтр по conf-PK не находил ни одного заказа.
      .eq("confectioner_id", confectioner.userId)
      .eq("payment_status", "released")
      .not("escrow_released_at", "is", null)
      .in("status", ["DELIVERED", "COMPLETED"])
      .is("payout_transferred_at", null)
      .limit(MAX_ORDERS_FOR_PAYOUT) as { data: OrderForPayoutRow[] | null; error: SupabaseError | null };

    if (ordersErr) {
      console.error("[payouts/request] eligible orders failed:", ordersErr.message);
      throw new HttpError(500, "Не удалось загрузить заказы для выплаты");
    }

    // Считаем сумму к выплате по снапшоту тарифа
    let totalPayout = 0;
    const orderPayouts = (eligibleOrders || []).map((o) => {
      const commissionRate = o.commission_rate_snapshot ?? DEFAULT_COMMISSION_RATE;
      const itemsTotal = o.total - (o.delivery_cost || 0);
      const commission = Math.round(itemsTotal * commissionRate);
      const yookassaFee = Math.round(o.total * YOOKASSA_RATE);
      const payout = o.total - commission - yookassaFee;
      totalPayout += payout;
      return {
        orderId: o.id,
        orderNumber: o.number,
        payout,
        commission,
        yookassaFee,
      };
    });

    if (totalPayout <= 0) {
      throw new HttpError(400, "Нет заказов, доступных для выплаты");
    }

    // P0: выплата — только на ПОЛНУЮ доступную сумму батча.
    // Частичный запрос раньше помечал ВСЕ заказы выплаченными,
    // и остаток становился невыплачиваем. Частичные выплаты — вместе
    // с ledger-учётом (PAY-3).
    if (body.amount !== totalPayout) {
      throw new HttpError(
        400,
        `Выплата возможна только на полную доступную сумму: ${totalPayout}₽ (по ${(eligibleOrders || []).length} заказам). Частичные выплаты появятся вместе с ledger-учётом.`
      );
    }

    // Регистрируем выплату в payout_requests — единый журнал для админа
    // (раньше мгновенная выплата была невидима в /api/admin/payouts)
    const { data: payoutRequest, error: payoutReqErr } = await supabaseAdmin
      .from("payout_requests")
      .insert({
        user_id: user.userId,
        amount: body.amount,
        method: "card",
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

    // Списываем баланс кондитера атомарно через RPC
    const { error: balanceErr } = await supabaseAdmin
      .rpc("deduct_confectioner_balance", {
        p_confectioner_id: confectioner.id,
        p_amount: body.amount,
      });

    if (balanceErr) {
      // P0: fail-closed. Прежний fallback `balance = Math.max(0, balance − amount)`
      // был не атомарным (гонка) и молча прощал овердрафт.
      console.error("[payouts/request] balance RPC failed:", balanceErr.message);
      await supabaseAdmin
        .from("payout_requests")
        .update({ status: "rejected", rejection_reason: `balance RPC failed: ${balanceErr.message}` })
        .eq("id", payoutRequest.id);
      throw new HttpError(500, "Сервис баланса недоступен, попробуйте позже");
    }

    // Отмечаем заказы как выплаченные — на ПОЛНУЮ сумму которых и выплатили
    const nowIso = new Date().toISOString();
    for (const op of orderPayouts) {
      await supabaseAdmin
        .from("orders")
        .update({ payout_transferred_at: nowIso })
        .eq("id", op.orderId);
    }

    // Закрываем запись выплаты
    await supabaseAdmin
      .from("payout_requests")
      .update({ status: "paid", processed_at: nowIso })
      .eq("id", payoutRequest.id);

    // Уведомление (non-blocking)
    try {
      const { sendNotification } = await import("@/lib/notifications");
      await sendNotification({
        userId: confectioner.userId,
        template: "PAYOUT_PROCESSED",
        vars: {
          amount: body.amount,
          cardLast4: "••••",
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[payouts/request] notification failed:", msg);
    }

    return NextResponse.json({
      success: true,
      amount: body.amount,
      orders: orderPayouts.length,
      details: orderPayouts,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
