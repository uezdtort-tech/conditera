/**
 * POST /api/checkout — оформить заказ + создать платёж Yookassa.
 *
 * Flow:
 *   1. Загружаем товары из cart_items (через admin client, в обход RLS)
 *   2. Считаем subtotal, delivery_cost, total
 *   3. Создаём order + order_items (snapshot цен)
 *   4. Создаём Yookassa payment через /v3/payments
 *   5. Возвращаем confirmation_url для редиректа пользователя
 *
 * Возвращает: { orderId, paymentUrl }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSession } from "@/lib/supabase/auth";
import { calculateDelivery } from "@/lib/finance";

interface CheckoutRequest {
  cartItems: Array<{
    id: string;
    product_id: string;
    quantity: number;
    selected_attributes?: Record<string, string>;
  }>;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryDate?: string;
  deliveryType?: string;
  notes?: string;
}

interface YookassaPaymentResponse {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
  confirmation: {
    confirmation_url: string;
  };
  paid: boolean;
  amount: { value: string; currency: "RUB" };
  metadata?: Record<string, string>;
}

const YOOKASSA_API_URL = process.env.YOOKASSA_API_URL || "https://api.yookassa.ru/v3";
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;

// Stub mode — возвращает demo-данные без обращения к Yookassa
const STUB_PAYMENT_URL = "/checkout/success?demo=true";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { user } = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const body: CheckoutRequest = await request.json();
    const {
      cartItems,
      deliveryAddress,
      deliveryCity,
      deliveryDate,
      deliveryType = "delivery",
      notes,
    } = body;

    if (!cartItems || cartItems.length === 0) {
      return NextResponse.json({ error: "Корзина пуста" }, { status: 400 });
    }

    if (!deliveryAddress || !deliveryCity) {
      return NextResponse.json({ error: "Укажите адрес доставки" }, { status: 400 });
    }

    // 1. Загружаем товары (через admin client для обхода RLS, чтобы
    //    получить данные даже если product status = draft — для админ-заказа)
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

    // 2. Считаем subtotal + формируем order_items
    const orderItems = cartItems.map((item) => {
      const product = products.find((p) => p.id === item.product_id);
      if (!product) throw new Error(`Product ${item.product_id} not found`);

      return {
        product_id: item.product_id,
        product_title: product.title,
        unit_price: product.price, // в копейках
        quantity: item.quantity,
        selected_attributes: item.selected_attributes,
        total: product.price * item.quantity, // subtotal на эту позицию
        confectioner_id: product.confectioner_id,
      };
    });

    const subtotal = orderItems.reduce((sum, item) => sum + item.total, 0);
    const deliveryResult =
      deliveryType === "delivery" ? calculateDelivery(subtotal) : { cost: 0 };
    const deliveryCost = deliveryResult.cost;
    const discount = 0; // TODO: применять промокод
    const total = subtotal + deliveryCost - discount;

    // Confectioner_id — берём из первого товара (пока поддерживаем только 1 кондитера на заказ)
    const confectionerId = orderItems[0].confectioner_id;

    // 3. Создаём order (через admin client)
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
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

    // 4. Создаём order_items
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

    // 5. Создаём payment в Yookassa
    let yookassaPaymentId: string | null = null;
    let paymentUrl: string = STUB_PAYMENT_URL;

    if (YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY) {
      // Production: реальный запрос к Yookassa
      const authHeader = Buffer.from(
        `${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`
      ).toString("base64");

      const idempotenceKey = `${order.id}-${Date.now()}`;

      const yookassaResponse = await fetch(`${YOOKASSA_API_URL}/payments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${authHeader}`,
          "Idempotence-Key": idempotenceKey,
        },
        body: JSON.stringify({
          amount: {
            value: (total / 100).toFixed(2), // Yookassa требует рубли с копейками
            currency: "RUB",
          },
          capture: true, // auto-capture (без separate capture flow)
          confirmation: {
            type: "redirect",
            return_url: `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success?orderId=${order.id}`,
          },
          metadata: {
            order_id: order.id,
            order_number: order.number,
            user_id: user.id,
          },
          description: `Заказ ${order.number} — кондитерский маркетплейс «Уездный кондитер»`,
        }),
      });

      if (!yookassaResponse.ok) {
        const errorText = await yookassaResponse.text();
        console.error("[checkout] Yookassa error:", errorText);
        return NextResponse.json(
          { error: "Ошибка создания платежа в Yookassa" },
          { status: 500 }
        );
      }

      const payment: YookassaPaymentResponse = await yookassaResponse.json();
      yookassaPaymentId = payment.id;
      paymentUrl = payment.confirmation.confirmation_url;
    } else {
      // Dev mode: возвращаем stub
      console.warn(
        "[checkout] YOOKASSA_SHOP_ID/SECRET_KEY not set — using stub payment URL"
      );
    }

    // 6. Создаём запись в payments
    const { error: paymentError } = await supabaseAdmin
      .from("payments")
      .insert({
        order_id: order.id,
        yookassa_payment_id: yookassaPaymentId,
        amount: total,
        currency: "RUB",
        status: yookassaPaymentId ? "pending" : "pending",
        method: "yookassa",
        metadata: { confirmation_url: paymentUrl },
      });

    if (paymentError) {
      console.error("[checkout] Payment create error:", paymentError.message);
      // Не откатываем order — платёж можно создать позже вручную
    }

    // 7. Очищаем корзину пользователя
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

    // 8. Отправляем уведомление через Edge Function
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (supabaseUrl) {
        await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "order_created",
            orderId: order.number,
            amount: total / 100,
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
      total: total / 100, // в рублях для отображения
      isStub: !YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY,
    });
  } catch (error) {
    console.error("[checkout] Unexpected error:", (error as Error).message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: (error as Error).message },
      { status: 500 }
    );
  }
}
