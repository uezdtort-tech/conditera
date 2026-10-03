/**
 * POST /api/checkout — оформить заказ + создать платёж YooKassa.
 *
 * Flow:
 *   0. Rate limit (5/min, как payment/create) + auth (Supabase session)
 *   1. Zod-валидация тела (quantity 1..999, обязательные поля)
 *   2. Загружаем товары из products (admin client), проверяем published
 *   3. Считаем subtotal/delivery/total — все суммы в РУБЛЯХ
 *      (products.price в рублях: seed 2400 = 2400₽, formatCurrency без /100)
 *   4. Создаём order + order_items (снапшот цен)
 *   5. Платёж через lib/yookassa — детерминированный Idempotence-Key
 *      (`uezd_konditer:create:{orderId}`): повторный клик/ретрай вернёт
 *      тот же платёж, а не создаст новый. Раньше ключ был
 *      `${order.id}-${Date.now()}` → двойной клик = два реальных платежа (P0).
 *   6. Записываем payments (существующие колонки 0002, ошибка проверяется)
 *   7. Корзину чистим ТОЛЬКО после успешного создания платежа
 *
 * Возвращает: { orderId, paymentUrl }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
// Единый auth-контракт (Bearer + cookie cd_session): getSession() требовал
// GoTrue (/auth/v1 — 501-стаб в локальном runtime) и всегда отдавал 401.
import { getUserFromRequest } from "@/lib/auth";
import { calculateDelivery } from "@/lib/finance";
import { createPayment, isYookassaConfigured } from "@/lib/yookassa";
import { enforceRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit";

const CheckoutSchema = z.object({
  cartItems: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        product_id: z.string().min(1).max(100),
        quantity: z.number().int().min(1).max(999),
        selected_attributes: z.record(z.string(), z.string()).optional(),
      })
    )
    .min(1)
    .max(50),
  deliveryAddress: z.string().min(5).max(500),
  deliveryCity: z.string().min(1).max(100),
  deliveryDate: z.string().max(40).optional(),
  deliveryType: z.enum(["delivery", "pickup", "self_pickup"]).optional(),
  notes: z.string().max(1000).optional(),
});

// Stub mode — возвращает demo-данные без обращения к Yookassa
const STUB_PAYMENT_URL = "/checkout/success?demo=true";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 0. Rate limit — деньги, тот же пресет что и payment/create
    const ip = getClientIP(request);
    const blocked = await enforceRateLimit(
      request,
      `checkout:${ip}`,
      RATE_LIMITS.payment.limit,
      RATE_LIMITS.payment.windowMs
    );
    if (blocked) return blocked as unknown as NextResponse;

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // 1. Валидация тела (P0: quantity не был проверялся — 0/отрицательное
    // давало нулевой или отрицательный total)
    const raw = await request.json().catch(() => null);
    const parsed = CheckoutSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path?.join(".") || "body";
      return NextResponse.json(
        { error: `Некорректные данные (${path}): ${issue?.message || "validation failed"}` },
        { status: 400 }
      );
    }
    const {
      cartItems,
      deliveryAddress,
      deliveryCity,
      deliveryDate,
      deliveryType = "delivery",
      notes,
    } = parsed.data;

    // 2. Загружаем товары (admin client для обхода RLS)
    const productIds = cartItems.map((c) => c.product_id);
    const { data: products, error: productsError } = await supabaseAdmin
      .from("products")
      .select("id, title, price, status, confectioner_id")
      .in("id", productIds);

    if (productsError) {
      console.error("[checkout] Products load error:", productsError.message);
      return NextResponse.json({ error: "Ошибка загрузки товаров" }, { status: 500 });
    }

    if (!products || products.length !== productIds.length) {
      return NextResponse.json(
        { error: "Некоторые товары не найдены" },
        { status: 400 }
      );
    }

    // Проверяем что все товары опубликованы
    const draftProducts = products.filter((p) => p.status !== "published");
    if (draftProducts.length > 0) {
      return NextResponse.json(
        { error: `Товары недоступны: ${draftProducts.map((p) => p.title).join(", ")}` },
        { status: 400 }
      );
    }

    // 3. Считаем subtotal + формируем order_items (все суммы в РУБЛЯХ)
    const orderItems = cartItems.map((item) => {
      const product = products.find((p) => p.id === item.product_id);
      if (!product) throw new Error(`Product ${item.product_id} not found`);

      return {
        product_id: item.product_id,
        product_title: product.title,
        unit_price: product.price, // рубли (НЕ копейки — см. seed/формат витрины)
        quantity: item.quantity,
        selected_attributes: item.selected_attributes,
        total: product.price * item.quantity, // рубли
      };
    });

    const subtotal = orderItems.reduce((sum, item) => sum + item.total, 0);
    const deliveryResult =
      deliveryType === "delivery" ? calculateDelivery(subtotal) : { cost: 0 };
    const deliveryCost = deliveryResult.cost;
    const discount = 0; // TODO: применять промокод
    const total = subtotal + deliveryCost - discount; // рубли

    // Confectioner_id — берём из первого товара (пока поддерживаем только 1 кондитера на заказ)
    const confectionerId = (products.find(
      (p) => p.id === cartItems[0].product_id
    ) as { confectioner_id?: string | null } | undefined)?.confectioner_id ?? null;

    // 4. Создаём order (через admin client)
    // NOTE: number генерируем в коде — триггер generate_order_number в локальном
    // PG падает (lpad(integer,...) не существует) и валил любую вставку без number.
    const orderNumber = `UK-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
        number: orderNumber,
        user_id: user.id,
        confectioner_id: confectionerId,
        subtotal,
        delivery_cost: deliveryCost,
        discount,
        total,
        status: "PENDING",
        type: "product",
        delivery_address: deliveryAddress,
        delivery_city: deliveryCity,
        delivery_date: deliveryDate,
        delivery_type: deliveryType,
        notes,
        metadata: { cart_items: cartItems.map((c) => c.id) },
      })
      .select()
      .single();

    if (orderError || !order) {
      console.error("[checkout] Order create error:", orderError?.message);
      return NextResponse.json({ error: "Ошибка создания заказа" }, { status: 500 });
    }

    // 4b. Создаём order_items
    const { error: itemsError } = await supabaseAdmin
      .from("order_items")
      .insert(
        orderItems.map((item) => ({
          order_id: order.id,
          ...item,
        }))
      );

    if (itemsError) {
      console.error("[checkout] Order items create error:", itemsError.message);
      // Откатываем order
      await supabaseAdmin.from("orders").delete().eq("id", order.id);
      return NextResponse.json({ error: "Ошибка создания позиций заказа" }, { status: 500 });
    }

    // 5. Платёж через lib — детерминированный Idempotence-Key внутри lib
    let paymentUrl: string = STUB_PAYMENT_URL;
    let yookassaPaymentId: string | null = null;

    if (!isYookassaConfigured()) {
      console.warn(
        "[checkout] YooKassa не настроена (YOOKASSA_SHOP_ID/YOOKASSA_SECRET_KEY) — stub payment URL"
      );
    } else {
      const paymentResult = await createPayment({
        amount: total, // рубли
        description: `Заказ ${order.number} — кондитерский маркетплейс «Уездный кондитер»`,
        returnUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/checkout/success?orderId=${order.id}`,
        orderId: order.id,
      });

      if (!paymentResult.success || !paymentResult.payment?.confirmation?.confirmation_url) {
        console.error("[checkout] Yookassa error:", paymentResult.error);
        // Заказ оставляем (можно повторить оплату через /api/payment/create),
        // корзину НЕ чистим
        return NextResponse.json(
          { error: "Ошибка создания платежа в Yookassa" },
          { status: 502 }
        );
      }

      yookassaPaymentId = paymentResult.payment.id;
      paymentUrl = paymentResult.payment.confirmation.confirmation_url;
    }

    // 6. Запись в payments (существующие колонки 0002) + проверка ошибки
    const { error: paymentError } = await supabaseAdmin
      .from("payments")
      .insert({
        order_id: order.id,
        yookassa_payment_id: yookassaPaymentId,
        amount: total, // рубли
        currency: "RUB",
        status: "pending",
        method: "yookassa",
        metadata: { confirmation_url: paymentUrl },
      });

    if (paymentError) {
      // Платёж у провайдера уже создан; webhook найдёт заказ по
      // metadata.orderId (fallback), поэтому не откатываем — но логируем.
      console.error("[checkout] Payment create error:", paymentError.message);
    }

    // 7. Корзину чистим только после успешного создания платежа
    //    (раньше корзина стиралась даже если платёж не создался)
    const { error: cartClearError } = await supabaseAdmin
      .from("cart_items")
      .delete()
      .in(
        "id",
        cartItems.map((c) => c.id)
      );

    if (cartClearError) {
      console.warn("[checkout] Cart clear error:", cartClearError.message);
    }

    // 8. Уведомление через Edge Function
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (supabaseUrl) {
        await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "order_created",
            orderId: order.number,
            amount: total, // рубли
            customer: user.email,
          }),
        });
      }
    } catch (e) {
      console.warn("[checkout] Notification send error:", (e as Error).message);
    }

    return NextResponse.json({
      orderId: order.id,
      orderNumber: order.number,
      paymentUrl,
      total, // рубли
      isStub: !isYookassaConfigured(),
    });
  } catch (error) {
    // detail не отдаём клиенту (утечка внутренностей)
    console.error("[checkout] Unexpected error:", (error as Error).message);
    return NextResponse.json(
      { error: "Внутренняя ошибка" },
      { status: 500 }
    );
  }
}
