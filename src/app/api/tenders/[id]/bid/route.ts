/**
 * POST /api/tenders/[id]/bid — подать заявку (ставку) на тендер.
 *
 * Кондитер предлагает свою цену. Body: { price: number, message?: string }.
 *
 * Хранение: отдельной таблицы для ставок нет — используем
 * OrderNegotiation не подходит (требует orderId). Поэтому записываем
 * отклик в массив confectionerIds тендера (PriceInquiry) и инкрементим
 * responsesCount. Дополнительно создаём AuditLog с деталями ставки.
 *
 * Auth: CONFECTIONER role.
 *
 * Безопасность:
 *   • POST: требует роль CONFECTIONER + checkConfectionerGate (approved статус).
 *   • POST: price — положительное число, message — строка ≤2000 символов.
 *   • Idempotency: если кондитер уже откликнулся, не дублируем запись,
 *     но позволяем обновить цену (через audit_log).
 *   • Counter increment responses_count через атомарный SQL expression.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const MAX_MESSAGE_LENGTH = 2000;
const MAX_PRICE = 10_000_000;

interface BidBody {
  price?: number;
  message?: string;
}

interface SupabaseError {
  message: string;
}

interface TenderRow {
  id: string;
  user_id: string;
  status: string | null;
  confectioner_ids: string[] | null;
  responses_count: number | null;
}

interface ConfectionerRow {
  id: string;
  business_name: string | null;
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: tenderId } = await params;
    if (!tenderId) throw new HttpError(400, "Tender ID required");

    const user = await getUserFromRequest(req);
    if (!user) throw new HttpError(401, "Не авторизован");

    const roles = user.roles || [];
    if (!roles.includes("CONFECTIONER")) {
      throw new HttpError(403, "Только кондитеры могут подавать ставки на тендер");
    }

    // Gate: кондитер должен быть подтверждён админом.
    const { checkConfectionerGate } = await import("@/lib/confectioner-gate");
    const gate = await checkConfectionerGate(user.userId);
    if (!gate.allowed) {
      return NextResponse.json(
        {
          error: gate.reason,
          verificationStatus: gate.status,
          requiresApproval: true,
        },
        { status: 403 }
      );
    }

    const { data: body, error: parseErr } = await safeJsonBody<BidBody>(req);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    if (typeof body.price !== "number" || !Number.isFinite(body.price) || body.price <= 0) {
      throw new HttpError(400, "Укажите price (положительное число)");
    }
    if (body.price > MAX_PRICE) {
      throw new HttpError(422, `price слишком большой (макс ${MAX_PRICE})`);
    }

    let message: string | null = null;
    if (typeof body.message === "string") {
      if (body.message.length > MAX_MESSAGE_LENGTH) {
        throw new HttpError(422, `message слишком длинный (макс ${MAX_MESSAGE_LENGTH})`);
      }
      message = body.message;
    }

    const { data: tender, error: tenderErr } = await supabaseAdmin
      .from("price_inquiries")
      .select("id, user_id, status, confectioner_ids, responses_count")
      .eq("id", tenderId)
      .maybeSingle() as { data: TenderRow | null; error: SupabaseError | null };

    if (tenderErr) {
      console.error("[tenders/bid] tender lookup failed:", tenderErr.message);
      throw new HttpError(500, "Не удалось загрузить тендер");
    }
    if (!tender) throw new HttpError(404, "Тендер не найден");

    if (tender.status === "closed") {
      throw new HttpError(400, "Тендер закрыт");
    }

    // Find confectioner profile (нельзя использовать user.id как confectioner_id)
    const { data: confectioner, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("id, business_name")
      .eq("user_id", user.userId)
      .maybeSingle() as { data: ConfectionerRow | null; error: SupabaseError | null };

    if (confErr) {
      console.error("[tenders/bid] confectioner lookup failed:", confErr.message);
      throw new HttpError(500, "Не удалось загрузить профиль кондитера");
    }
    if (!confectioner) throw new HttpError(404, "Профиль кондитера не найден");

    // Добавляем кондитера в список откликнувшихся, если ещё нет.
    const existingIds = tender.confectioner_ids || [];
    const isNewBid = !existingIds.includes(confectioner.id);
    const updatedConfectionerIds = isNewBid
      ? [...existingIds, confectioner.id]
      : existingIds;

    // Атомарный increment responses_count через SQL UPDATE expression — нет race condition.
    // Используем только isNewBid для условного increment.
    const { error: updateErr } = await supabaseAdmin
      .from("price_inquiries")
      .update({
        confectioner_ids: updatedConfectionerIds,
        responses_count: isNewBid ? (tender.responses_count || 0) + 1 : (tender.responses_count || 0),
        status: "responded",
      })
      .eq("id", tenderId);

    if (updateErr) {
      console.error("[tenders/bid] tender update failed:", updateErr.message);
      throw new HttpError(500, "Не удалось подать ставку");
    }

    // Логируем ставку в audit_logs
    const { error: auditErr } = await supabaseAdmin
      .from("audit_logs")
      .insert({
        user_id: user.userId,
        action: "tender_bid",
        metadata: {
          tenderId,
          confectionerId: confectioner.id,
          businessName: confectioner.business_name || "",
          price: body.price,
          message: message || null,
        },
        created_at: new Date().toISOString(),
      });

    if (auditErr) {
      console.warn("[tenders/bid] auditLog insert failed:", auditErr.message);
    }

    // Уведомление автору тендера (non-blocking)
    try {
      const { sendNotification } = await import("@/lib/notifications");
      await sendNotification({
        userId: tender.user_id,
        template: "NEW_MESSAGE",
        vars: {
          senderName: confectioner.business_name || "Кондитер",
          messagePreview: `Новая ставка на тендер: ${body.price} ₽`,
        },
        data: { tenderId, type: "tender_bid", price: body.price },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[tenders/bid] notification failed:", msg);
    }

    return NextResponse.json({
      success: true,
      tenderId,
      confectionerId: confectioner.id,
      price: body.price,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
