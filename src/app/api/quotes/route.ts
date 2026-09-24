/**
 * POST /api/quotes/create — покупатель отправляет запрос цен кондитерам
 * GET  /api/quotes/my — покупатель видит свои запросы
 * GET  /api/quotes/confectioner — кондитер видит запросы к нему
 *
 * Логика:
 *   1. Покупатель собирает торт в конструкторе
 *   2. Выбирает до 5 кондитеров в локации
 *   3. Отправляет запрос (quote_request) — все кондитеры получают уведомление
 *   4. Каждый кондитер отвечает ценовым предложением (confectioner_quote)
 *   5. Покупатель сравнивает предложения и выбирает лучшее
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

// =====================================================================
// POST /api/quotes/create — создать запрос цен
// =====================================================================

interface QuoteRequestBody {
  product_type?: string;
  product_type_label?: string;
  event_type?: string;
  base?: string;
  filling?: string;
  filling_id?: string;
  coating?: string;
  decorations?: string[];
  dietary?: string[];
  servings?: number;
  quantity?: number;
  tiers?: number;
  shape?: string;
  inscription?: string;
  comment?: string;
  city: string;
  delivery_date?: string;
  delivery_type?: string;
  address?: string;
  discount_requested?: boolean;
  discount_percent?: number;
  discount_comment?: string;
  estimated_price?: number;
  estimated_delivery_cost?: number;
  confectioner_ids: string[];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { data: body, error: parseError } = await safeJsonBody<QuoteRequestBody>(req);
    if (parseError || !body) {
      throw new HttpError(400, parseError || "Невалидный JSON");
    }

    // Валидация: до 5 кондитеров
    if (!body.confectioner_ids || body.confectioner_ids.length === 0) {
      throw new HttpError(400, "Выберите хотя бы одного кондитера");
    }
    if (body.confectioner_ids.length > 5) {
      throw new HttpError(400, "Максимум 5 кондитеров на один запрос");
    }
    if (!body.city) {
      throw new HttpError(400, "Укажите город");
    }

    // Создать запрос
    const { data: quoteRequest, error: insertError } = await supabaseAdmin
      .from("quote_requests")
      .insert({
        customer_id: user.userId,
        customer_name: user.name || "Покупатель",
        product_type: body.product_type,
        product_type_label: body.product_type_label,
        event_type: body.event_type,
        base: body.base,
        filling: body.filling,
        filling_id: body.filling_id,
        coating: body.coating,
        decorations: body.decorations || [],
        dietary: body.dietary || [],
        servings: body.servings,
        quantity: body.quantity,
        tiers: body.tiers || 1,
        shape: body.shape,
        inscription: body.inscription,
        comment: body.comment,
        city: body.city,
        delivery_date: body.delivery_date,
        delivery_type: body.delivery_type || "delivery",
        address: body.address,
        discount_requested: body.discount_requested || false,
        discount_percent: body.discount_percent || 0,
        discount_comment: body.discount_comment,
        estimated_price: body.estimated_price || 0,
        estimated_delivery_cost: body.estimated_delivery_cost || 0,
        confectioner_ids: body.confectioner_ids,
        status: "sent",
      })
      .select()
      .single();

    if (insertError) {
      throw new HttpError(500, "DB error", insertError.message);
    }

    // Уведомить кондитеров (non-blocking)
    body.confectioner_ids.forEach((confId) => {
      supabaseAdmin.from("notifications").insert({
        user_id: null,
        type: "new_quote_request",
        title: "Новый запрос на торт!",
        body: `Запрос от ${user.name || "покупателя"} в г. ${body.city}. Срок: ${body.delivery_date || "не указан"}`,
        data: { quote_request_id: quoteRequest.id, confectioner_id: confId },
      }).then(() => {}, () => {});
    });

    return NextResponse.json(
      {
        quoteRequest,
        message: `Запрос отправлен ${body.confectioner_ids.length} кондитер(ам)! Ожидайте предложений в течение 48 часов.`,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

// =====================================================================
// GET /api/quotes/my — мои запросы (для покупателя)
// GET /api/quotes/confectioner — запросы к кондитеру
// =====================================================================

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") || "my";

    if (mode === "my") {
      // Запросы покупателя
      const { data: quotes, error } = await supabaseAdmin
        .from("quote_requests")
        .select(`
          *,
          confectioner_quotes:confectioner_quotes(*)
        `)
        .eq("customer_id", user.userId)
        .order("created_at", { ascending: false });

      if (error) {
        throw new HttpError(500, "DB error", error.message);
      }

      return NextResponse.json({ quotes: quotes || [] });
    }

    if (mode === "confectioner") {
      // Найти confectioner_id для текущего пользователя
      const { data: confectioner } = await supabaseAdmin
        .from("confectioners")
        .select("id")
        .eq("userId", user.userId)
        .maybeSingle();

      if (!confectioner) {
        throw new HttpError(403, "Вы не кондитер");
      }

      // Запросы, где кондитер в списке confectioner_ids
      const { data: quotes, error } = await supabaseAdmin
        .from("quote_requests")
        .select(`
          *,
          my_quotes:confectioner_quotes!inner(*)
        `)
        .contains("confectioner_ids", [confectioner.id])
        .order("created_at", { ascending: false });

      if (error) {
        throw new HttpError(500, "DB error", error.message);
      }

      return NextResponse.json({ quotes: quotes || [], confectioner_id: confectioner.id });
    }

    throw new HttpError(400, "Неизвестный режим. Используйте ?mode=my или ?mode=confectioner");
  } catch (error) {
    return handleRouteError(error);
  }
}
