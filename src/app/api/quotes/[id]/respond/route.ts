/**
 * POST /api/quotes/[id]/respond — кондитер отвечает ценовым предложением
 *
 * Тело:
 *   base_cost, filling_cost, coating_cost, decoration_cost,
 *   packaging_cost, printing_cost, storage_cost, delivery_cost,
 *   service_cost, custom_design_cost,
 *   discount_percent, comment, prep_days, available_date,
 *   offered_packaging, offered_delivery
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RespondBody {
  base_cost?: number;
  filling_cost?: number;
  coating_cost?: number;
  decoration_cost?: number;
  packaging_cost?: number;
  printing_cost?: number;
  storage_cost?: number;
  delivery_cost?: number;
  service_cost?: number;
  custom_design_cost?: number;
  discount_percent?: number;
  comment?: string;
  prep_days?: number;
  available_date?: string;
  offered_packaging?: string;
  offered_delivery?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { id: quoteRequestId } = await params;

    // Найти confectioner_id
    const { data: confectioner, error: confError } = await supabaseAdmin
      .from("confectioners")
      .select("id")
      .eq("userId", user.userId)
      .maybeSingle();

    if (confError || !confectioner) {
      throw new HttpError(403, "Вы не кондитер");
    }

    // Проверить, что запрос относится к этому кондитеру
    const { data: quoteRequest, error: qrError } = await supabaseAdmin
      .from("quote_requests")
      .select("id, confectioner_ids, city")
      .eq("id", quoteRequestId)
      .maybeSingle();

    if (qrError || !quoteRequest) {
      throw new HttpError(404, "Запрос не найден");
    }

    if (!quoteRequest.confectioner_ids.includes(confectioner.id)) {
      throw new HttpError(403, "Этот запрос не направлен вам");
    }

    const { data: body, error: parseError } = await safeJsonBody<RespondBody>(req);
    if (parseError || !body) {
      throw new HttpError(400, parseError || "Невалидный JSON");
    }

    // Расчёт суммы
    const base = body.base_cost || 0;
    const filling = body.filling_cost || 0;
    const coating = body.coating_cost || 0;
    const decoration = body.decoration_cost || 0;
    const packaging = body.packaging_cost || 0;
    const printing = body.printing_cost || 0;
    const storage = body.storage_cost || 0;
    const delivery = body.delivery_cost || 0;
    const service = body.service_cost || 0;
    const customDesign = body.custom_design_cost || 0;

    const subtotal = base + filling + coating + decoration + packaging +
      printing + storage + delivery + service + customDesign;

    const discountPercent = body.discount_percent || 0;
    const discountAmount = Math.round(subtotal * discountPercent / 100);
    const totalPrice = subtotal - discountAmount;

    // Проверить, что скидка в пределах лимита
    const { data: pricing } = await supabaseAdmin
      .from("confectioner_pricing")
      .select("max_discount_percent, accepts_discount_requests")
      .eq("confectioner_id", confectioner.id)
      .eq("city", quoteRequest.city)
      .maybeSingle();

    if (pricing && discountPercent > pricing.max_discount_percent) {
      throw new HttpError(400, `Максимальная скидка: ${pricing.max_discount_percent}%`);
    }

    // Создать или обновить ценовое предложение
    const { data: existing } = await supabaseAdmin
      .from("confectioner_quotes")
      .select("id")
      .eq("quote_request_id", quoteRequestId)
      .eq("confectioner_id", confectioner.id)
      .maybeSingle();

    const quoteData = {
      quote_request_id: quoteRequestId,
      confectioner_id: confectioner.id,
      base_cost: base,
      filling_cost: filling,
      coating_cost: coating,
      decoration_cost: decoration,
      packaging_cost: packaging,
      printing_cost: printing,
      storage_cost: storage,
      delivery_cost: delivery,
      service_cost: service,
      custom_design_cost: customDesign,
      subtotal,
      discount_percent: discountPercent,
      discount_amount: discountAmount,
      total_price: totalPrice,
      prep_days: body.prep_days || 3,
      available_date: body.available_date,
      comment: body.comment,
      offered_packaging: body.offered_packaging,
      offered_delivery: body.offered_delivery,
      status: "pending",
    };

    let quote;
    if (existing) {
      const { data: updated, error } = await supabaseAdmin
        .from("confectioner_quotes")
        .update(quoteData)
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw new HttpError(500, "DB error", error.message);
      quote = updated;
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("confectioner_quotes")
        .insert(quoteData)
        .select()
        .single();
      if (error) throw new HttpError(500, "DB error", error.message);
      quote = created;
    }

    return NextResponse.json({
      quote,
      message: "Ваше ценовое предложение отправлено покупателю!",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
