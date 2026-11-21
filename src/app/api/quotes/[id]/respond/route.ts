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

    const { data: products, error: productsError } = await supabaseAdmin
      .from("products").select("id, title, recipe_id")
      .eq("confectioner_id", confectioner.id).eq("status", "published")
      .not("recipe_id", "is", null).limit(200);
    if (productsError) throw new HttpError(503, "Не удалось загрузить производственные товары");

    const recipeIds = [...new Set((products ?? []).map(p => p.recipe_id).filter((id): id is string => Boolean(id)))];
    const recipes = recipeIds.length
      ? await getPool().query<{ recipe_id: string }>(
          "SELECT DISTINCT recipe_id::text FROM public.recipe_ingredients WHERE recipe_id = ANY($1::uuid[])",
          [recipeIds])
      : { rows: [] as { recipe_id: string }[] };
    const readyRecipeIds = new Set(recipes.rows.map(r => r.recipe_id));
    return NextResponse.json({
      products: (products ?? [])
        .filter(p => p.recipe_id && readyRecipeIds.has(p.recipe_id))
        .map(p => ({ id: p.id, title: p.title })),
    });
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
        ["approved", "rejected", "cancelled", "expired"].includes(quoteRequest.status)) {
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
    const { data: productionProduct, error: productError } = await supabaseAdmin
      .from("products")
      .select("id, recipe_id, status")
      .eq("id", body.production_product_id)
      .eq("confectioner_id", confectioner.id)
      .maybeSingle();
    if (productError || !productionProduct || productionProduct.status !== "published" || !productionProduct.recipe_id) {
      throw new HttpError(422, "Выбранный производственный товар недоступен или не имеет рецепта");
    }
    const recipeCheck = await getPool().query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.recipe_ingredients WHERE recipe_id = $1::uuid",
      [productionProduct.recipe_id]
    );
    if (Number(recipeCheck.rows[0]?.count ?? 0) === 0) {
      throw new HttpError(422, "В производственном рецепте нет ингредиентов");
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

    // Создать или обновить ценовое предложение
    const { data: existing } = await supabaseAdmin
      .from("confectioner_quotes")
      .select("id, status")
      .eq("quote_request_id", quoteRequestId)
      .eq("confectioner_id", confectioner.id)
      .maybeSingle();

    if (existing?.status === "accepted") {
      throw new HttpError(409, "Покупатель уже принял это предложение и заказ создан");
    }

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
      prep_days: prepDays,
      available_date: body.available_date,
      comment: body.comment,
      offered_packaging: body.offered_packaging,
      offered_delivery: body.offered_delivery,
      production_product_id: productionProduct.id,
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

    await supabaseAdmin.from("quote_requests")
      .update({ status: "quoted", updated_at: new Date().toISOString() })
      .eq("id", quoteRequestId)
      .eq("status", "sent");

    return NextResponse.json({
      quote,
      message: "Ваше ценовое предложение отправлено покупателю!",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
