/**
 * GET    /api/subscriptions — список подписок пользователя
 * POST   /api/subscriptions — создать подписку на торт
 * DELETE /api/subscriptions?id=... — отменить подписку
 *
 * Auth: AUTHENTICATED
 *
 * Безопасность:
 *   • POST: парсинг JSON безопасен (safeJsonBody), 400 при невалидном теле.
 *   • POST: schedule — enum (weekly/biweekly/monthly).
 *   • POST: pricePerDelivery — положительное число.
 *   • POST: servings — целое число (1-99).
 *   • DELETE: ownership check через .eq("user_id", user.id) — нельзя отменить
 *     чужую подписку, даже зная subId.
 *   • При DB error не возвращаем детали БД клиенту.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError, readEnumField } from "@/lib/http-helpers";

export const runtime = "nodejs";

const SCHEDULES = ["weekly", "biweekly", "monthly"] as const;
const MAX_SERVINGS = 99;
const MIN_PRICE = 100;
const MAX_PRICE = 100_000;
const MAX_ADDRESS_LENGTH = 500;

interface CreateSubBody {
  confectionerId?: string;
  productId?: string;
  schedule?: string;
  servings?: number;
  pricePerDelivery?: number;
  deliveryCity?: string;
  deliveryAddress?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { data, error } = await supabaseAdmin
      .from("cake_subscriptions")
      .select("*")
      .eq("user_id", user.userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[subscriptions] GET error:", error.message);
    }
    return NextResponse.json({ subscriptions: data || [] });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { data: body, error: parseErr } = await safeJsonBody<CreateSubBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    // Валидация обязательных полей
    if (typeof body.confectionerId !== "string" || body.confectionerId.length === 0) {
      throw new HttpError(400, "confectionerId обязателен");
    }
    if (typeof body.productId !== "string" || body.productId.length === 0) {
      throw new HttpError(400, "productId обязателен");
    }
    if (typeof body.pricePerDelivery !== "number" || !Number.isFinite(body.pricePerDelivery) || body.pricePerDelivery < MIN_PRICE) {
      throw new HttpError(422, `pricePerDelivery должен быть числом не менее ${MIN_PRICE} ₽`);
    }
    if (body.pricePerDelivery > MAX_PRICE) {
      throw new HttpError(422, `pricePerDelivery слишком большой (макс ${MAX_PRICE} ₽)`);
    }

    // Валидация schedule enum
    const scheduleResult = readEnumField(
      { schedule: body.schedule },
      "schedule",
      SCHEDULES,
      { required: true }
    );
    if (scheduleResult.error || !scheduleResult.value) {
      throw new HttpError(422, scheduleResult.error || `schedule должен быть одним из: ${SCHEDULES.join(", ")}`);
    }
    const schedule = scheduleResult.value;

    // Валидация servings
    let servings = 1;
    if (body.servings !== undefined) {
      if (typeof body.servings !== "number" || !Number.isInteger(body.servings) || body.servings < 1) {
        throw new HttpError(422, "servings должен быть положительным целым числом");
      }
      if (body.servings > MAX_SERVINGS) {
        throw new HttpError(422, `servings слишком большой (макс ${MAX_SERVINGS})`);
      }
      servings = body.servings;
    }

    // Валидация строковых полей
    const deliveryCity = typeof body.deliveryCity === "string" ? body.deliveryCity : null;
    const deliveryAddress = typeof body.deliveryAddress === "string" ? body.deliveryAddress : null;
    if (deliveryAddress && deliveryAddress.length > MAX_ADDRESS_LENGTH) {
      throw new HttpError(422, `deliveryAddress слишком длинный (макс ${MAX_ADDRESS_LENGTH})`);
    }

    // Calculate next delivery date
    const now = new Date();
    const nextDelivery = new Date(now);
    switch (schedule) {
      case "weekly": nextDelivery.setDate(nextDelivery.getDate() + 7); break;
      case "biweekly": nextDelivery.setDate(nextDelivery.getDate() + 14); break;
      case "monthly": nextDelivery.setMonth(nextDelivery.getMonth() + 1); break;
    }

    const { data: sub, error } = await supabaseAdmin
      .from("cake_subscriptions")
      .insert({
        user_id: user.userId,
        confectioner_id: body.confectionerId,
        product_id: body.productId,
        schedule,
        servings,
        price_per_delivery: body.pricePerDelivery,
        delivery_city: deliveryCity,
        delivery_address: deliveryAddress,
        status: "active",
        next_delivery_at: nextDelivery.toISOString(),
        deliveries_count: 0,
        total_spent: 0,
      })
      .select()
      .single();

    if (error) {
      console.error("[subscriptions] insert failed:", error.message);
      throw new HttpError(500, "Не удалось создать подписку");
    }

    return NextResponse.json({ subscription: sub }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { searchParams } = new URL(request.url);
    const subId = searchParams.get("id");
    if (!subId) throw new HttpError(400, "Укажите id");

    // Ownership check через .eq("user_id", user.id) — нельзя отменить чужую подписку
    const { error } = await supabaseAdmin
      .from("cake_subscriptions")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", subId)
      .eq("user_id", user.userId);

    if (error) {
      console.error("[subscriptions] cancel failed:", error.message);
      throw new HttpError(500, "Не удалось отменить подписку");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
