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
import { getPool } from "@/lib/postgrest/pool";

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
  production_product_id?: string;
}

/** GET — товары кондитера с действующим рецептом для привязки к индивидуальному заказу. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) throw new HttpError(401, "Не авторизован");
    const { id: quoteRequestId } = await params;

    const { data: confectioner, error: confError } = await supabaseAdmin
      .from("confectioners").select("id").eq("userId", user.userId).maybeSingle();
    if (confError || !confectioner) throw new HttpError(403, "Вы не кондитер");

    const { data: quoteRequest, error: requestError } = await supabaseAdmin
      .from("quote_requests").select("id, confectioner_ids")
      .eq("id", quoteRequestId).maybeSingle();
    if (requestError || !quoteRequest) throw new HttpError(404, "Запрос не найден");
    if (!(quoteRequest.confectioner_ids ?? []).includes(confectioner.id)) {
      throw new HttpError(403, "Этот запрос не направлен вам");
    }

    const products = await getPool().query<{ id: string; title: string }>(
      `SELECT p.id::text AS id, p.title
         FROM public.products AS p
        WHERE p.confectioner_id::text = $1
          AND p.status = 'published'
          AND p.recipe_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.recipe_ingredients AS ri
             WHERE ri.recipe_id = p.recipe_id
          )
        ORDER BY p.title
        LIMIT 200`,
      [user.userId]
    );
    return NextResponse.json({ products: products.rows });
  } catch (error) {
    return handleRouteError(error);
  }
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
      .select("id, confectioner_ids, city, status, expires_at")
      .eq("id", quoteRequestId)
      .maybeSingle();

    if (qrError || !quoteRequest) {
      throw new HttpError(404, "Запрос не найден");
    }

    if (!(quoteRequest.confectioner_ids ?? []).includes(confectioner.id)) {
      throw new HttpError(403, "Этот запрос не направлен вам");
    }
    if (new Date(quoteRequest.expires_at).getTime() <= Date.now() ||
        ["approved", "cancelled", "expired"].includes(quoteRequest.status)) {
      throw new HttpError(409, "Запрос уже закрыт или срок ответа истёк");
    }

    const { data: body, error: parseError } = await safeJsonBody<RespondBody>(req);
    if (parseError || !body) {
      throw new HttpError(400, parseError || "Невалидный JSON");
    }

    // Денежные поля API и таблицы confectioner_quotes — только целые копейки.
    const money = (value: unknown, field: string): number => {
      if (value === undefined || value === null) return 0;
      if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100_000_000) {
        throw new HttpError(400, `Некорректная сумма: ${field} (ожидаются целые копейки)`);
      }
      return value as number;
    };
    const base = money(body.base_cost, "base_cost");
    const filling = money(body.filling_cost, "filling_cost");
    const coating = money(body.coating_cost, "coating_cost");
    const decoration = money(body.decoration_cost, "decoration_cost");
    const packaging = money(body.packaging_cost, "packaging_cost");
    const printing = money(body.printing_cost, "printing_cost");
    const storage = money(body.storage_cost, "storage_cost");
    const delivery = money(body.delivery_cost, "delivery_cost");
    const service = money(body.service_cost, "service_cost");
    const customDesign = money(body.custom_design_cost, "custom_design_cost");

    const subtotal = base + filling + coating + decoration + packaging +
      printing + storage + delivery + service + customDesign;
    if (!Number.isSafeInteger(subtotal) || subtotal <= 0) {
      throw new HttpError(400, "Итоговая стоимость предложения должна быть положительной");
    }

    const discountPercent = body.discount_percent ?? 0;
    if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 50) {
      throw new HttpError(400, "Скидка должна быть целым числом от 0 до 50%");
    }
    const discountAmount = Math.round(subtotal * discountPercent / 100);
    const totalPrice = subtotal - discountAmount;
    if (totalPrice <= 0) throw new HttpError(400, "Сумма после скидки должна быть положительной");

    if (!body.production_product_id || !/^[0-9a-f-]{36}$/i.test(body.production_product_id)) {
      throw new HttpError(422, "Выберите товар с действующим производственным рецептом");
    }
    const productCheck = await getPool().query<{ id: string }>(
      `SELECT p.id::text AS id
         FROM public.products AS p
        WHERE p.id = $1::uuid
          AND p.confectioner_id::text = $2
          AND p.status = 'published'
          AND p.recipe_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.recipe_ingredients AS ri
             WHERE ri.recipe_id = p.recipe_id
          )`,
      [body.production_product_id, user.userId]
    );
    const productionProduct = productCheck.rows[0];
    if (!productionProduct) {
      throw new HttpError(422, "Выбранный производственный товар недоступен или не имеет рецепта");
    }

    const prepDays = body.prep_days ?? 3;
    if (!Number.isInteger(prepDays) || prepDays < 1 || prepDays > 365) {
      throw new HttpError(400, "Срок изготовления должен быть от 1 до 365 дней");
    }

    // Проверить, что скидка в пределах лимита
    const { data: pricing } = await supabaseAdmin
      .from("confectioner_pricing")
      .select("max_discount_percent, accepts_discount_requests")
      .eq("confectioner_id", confectioner.id)
      .eq("city", quoteRequest.city)
      .maybeSingle();

    if (discountPercent > 0 && (!pricing || !pricing.accepts_discount_requests)) {
      throw new HttpError(400, "Кондитер не принимает запросы на скидку");
    }
    if (pricing && discountPercent > pricing.max_discount_percent) {
      throw new HttpError(400, `Максимальная скидка: ${pricing.max_discount_percent}%`);
    }

    // RPC сериализует создание/пересмотр предложения с принятием и отказом покупателя.
    const { data: savedQuote, error: saveError } = await supabaseAdmin.rpc(
      "save_confectioner_quote",
      {
        p_quote_request_id: quoteRequestId,
        p_confectioner_id: confectioner.id,
        p_production_product_id: productionProduct.id,
        p_base_cost: base,
        p_filling_cost: filling,
        p_coating_cost: coating,
        p_decoration_cost: decoration,
        p_packaging_cost: packaging,
        p_printing_cost: printing,
        p_storage_cost: storage,
        p_delivery_cost: delivery,
        p_service_cost: service,
        p_custom_design_cost: customDesign,
        p_discount_percent: discountPercent,
        p_prep_days: prepDays,
        p_comment: body.comment ?? null,
        p_available_date: body.available_date ?? null,
        p_offered_packaging: body.offered_packaging ?? null,
        p_offered_delivery: body.offered_delivery ?? null,
      }
    );
    if (saveError) {
      const message = saveError.message || "";
      const status = /QUOTE_ALREADY_ACCEPTED|QUOTE_ALREADY_PROCESSED|QUOTE_REQUEST_CLOSED/.test(message) ? 409
        : /PRODUCTION_RECIPE|QUOTE_AMOUNT_INVALID|QUOTE_COST_INVALID|QUOTE_TERMS_INVALID/.test(message) ? 422
        : /CONFECTIONER_NOT_INVITED|QUOTE_REQUEST_NOT_FOUND/.test(message) ? 403 : 503;
      throw new HttpError(status, status === 409
        ? "Запрос уже закрыт или предложение обработано"
        : status === 422
          ? "Не удалось проверить стоимость или производственный рецепт"
          : "Не удалось сохранить предложение", message);
    }
    const quote = Array.isArray(savedQuote) ? savedQuote[0] : savedQuote;
    if (!quote?.id) throw new HttpError(503, "Сохранённое предложение не возвращено");

    return NextResponse.json({
      quote,
      message: "Ваше ценовое предложение отправлено покупателю!",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
