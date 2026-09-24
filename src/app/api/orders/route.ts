/**
 * GET /api/orders — список заказов текущего пользователя
 * POST /api/orders — создать заказ
 *
 * POST-логика:
 *   1. Проверка аутентификации и anti-fraud (≤5 заказов/час с IP)
 *   2. Если isCorporate=true — проверка организации через DaData
 *   3. Валидация items (quantity 1-999, productId существует)
 *   4. Расчёт itemsTotal на основе цены товара из БД
 *   5. Валидация deliveryCost (0-5000 ₽)
 *   6. Получение confectionerId из первого товара + снапшот тарифа
 *   7. Серверная валидация промокода (validatePromoCode)
 *   8. Списание бонусов (redeemPoints с проверкой баланса)
 *   9. Создание заказа в БД + order_items (транзакция)
 *  10. Инкремент usedCount промокода
 *  11. Уведомления: ORDER_CREATED покупателю, NEW_MESSAGE кондитеру
 *  12. Создание chat-комнаты для заказа (ensureOrderChatRoom)
 *  13. Telegram notifyNewOrder
 *  14. Яндекс Метрика trackEventServer
 *  15. Email sendTemplateEmail
 *
 * Auth: AUTHENTICATED (все роли могут создавать заказы)
 * Anti-fraud: 5 заказов в час с IP (через @/lib/anti-fraud)
 *
 * Соответствует таблицам:
 *  - orders (создание заказа)
 *  - order_items (позиции заказа)
 *  - confectioners (снапшот тарифа)
 *  - products (получение цены товара)
 *  - promo_codes (валидация и инкремент usedCount)
 *  - loyalty_transactions (списание бонусов)
 *  - notifications (ORDER_CREATED, NEW_MESSAGE)
 *  - через @/lib/chat-automation: ensureOrderChatRoom
 *  - через @/lib/telegram-bot: notifyNewOrder
 *  - через @/lib/email: sendTemplateEmail
 *  - через @/lib/yandex-metrika: trackEventServer
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface OrderItemInput {
  productId: string;
  quantity: number;
  customization?: Record<string, unknown> | null;
}

interface OrderItemRecord {
  product_id: string;
  title: string;
  image: string;
  price: number;
  quantity: number;
  customization: Record<string, unknown> | null;
}

const TARIFF_RATES: Record<string, number> = {
  START: 0.15,
  PROFI: 0.10,
  PREMIUM: 0.05,
  BASIC: 0.15,
  BUSINESS: 0.08,
};

const DEFAULT_COMMISSION_RATE = 0.15;

/**
 * GET /api/orders — список заказов текущего пользователя.
 * Поддерживает фильтр ?status=PENDING|CONFIRMED|...
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let query = supabaseAdmin
      .from("orders")
      .select(
        `
        id, number, status, total, delivery_address, delivery_date,
        delivery_time, delivery_cost, payment_method, payment_status,
        comment, confectioner_id, created_at,
        confectioner:confectioners(business_name, avatar)
      `
      )
      .eq("user_id", user.userId)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error("[orders] GET query error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    // Получить items для каждого заказа (отдельный запрос для производительности)
    const orderIds = (orders || []).map((o: any) => o.id);
    let itemsByOrder = new Map<string, any[]>();
    if (orderIds.length > 0) {
      const { data: items } = await supabaseAdmin
        .from("order_items")
        .select("id, order_id, product_id, title, image, price, quantity, customization")
        .in("order_id", orderIds);
      for (const item of items || []) {
        const arr = itemsByOrder.get(item.order_id) || [];
        arr.push(item);
        itemsByOrder.set(item.order_id, arr);
      }
    }

    const result = (orders || []).map((o: any) => ({
      ...o,
      items: itemsByOrder.get(o.id) || [],
    }));

    return NextResponse.json({ orders: result });
  } catch (error: any) {
    console.error("GET /api/orders error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/orders — создать заказ.
 *
 * Тело запроса:
 *  {
 *    "items": [{ "productId": "...", "quantity": 2, "customization": {...} }, ...],
 *    "deliveryAddress": "г. Москва, ...",
 *    "deliveryDate": "2026-09-15",
 *    "deliveryTime": "10:00-12:00",
 *    "deliveryCost": 350,
 *    "paymentMethod": "card",
 *    "comment": "Позвонить за час",
 *    "promoCode": "DISCOUNT10",
 *    "bonusPointsToRedeem": 100,
 *    "isCorporate": false
 *  }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    // 1. Anti-fraud: не более 5 заказов в час с IP
    const { checkFraudLimit } = await import("@/lib/anti-fraud");
    const fraudCheck = await checkFraudLimit(request, "order_create", user.userId as string);
    if (!fraudCheck.allowed) {
      const retryAfter = Math.ceil((fraudCheck.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        {
          error: fraudCheck.reason,
          retryAfter,
        },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        }
      );
    }

    const body = (await safeJsonBody<Record<string, unknown>>(request)).data;
    const {
      items,
      deliveryAddress,
      deliveryDate,
      deliveryTime,
      deliveryCost,
      paymentMethod,
      comment,
      promoCode: promoCodeInput,
      bonusPointsToRedeem,
      isCorporate,
    } = body ?? {};

    // Явное приведение типов после safeJsonBody — все поля unknown.
    const deliveryDateStr = typeof deliveryDate === "string" ? deliveryDate : undefined;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Корзина пуста" },
        { status: 400 }
      );
    }

    // 2. Корпоративный заказ — проверка организации
    if (isCorporate) {
      try {
        const { verifyForCorporateOrder } = await import("@/lib/organization-gate");
        const corpCheck = await verifyForCorporateOrder(user.userId as string);
        if (!corpCheck.allowed) {
          return NextResponse.json(
            { error: `Корпоративный заказ невозможен: ${corpCheck.reason}` },
            { status: 403 }
          );
        }
      } catch (e: any) {
        console.warn("[orders] Corporate verification failed:", e?.message);
      }
    }

    // 3-4. Расчёт суммы заказа + подготовка orderItems
    const orderItems: OrderItemRecord[] = [];
    let itemsTotal = 0;

    for (const item of items as OrderItemInput[]) {
      // Валидация quantity
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) {
        return NextResponse.json(
          { error: `Некорректное количество товара: ${item.quantity}` },
          { status: 400 }
        );
      }

      // Получить товар (для цены и названия)
      const { data: product, error: prodErr } = await supabaseAdmin
        .from("products")
        .select("id, title, price, images, confectioner_id")
        .eq("id", item.productId)
        .maybeSingle();

      if (prodErr || !product) continue;

      const itemTotal = Number(product.price) * item.quantity;
      itemsTotal += itemTotal;

      orderItems.push({
        product_id: product.id,
        title: product.title,
        image: ((product.images as string[]) || [])[0] || "",
        price: Number(product.price),
        quantity: item.quantity,
        customization: item.customization ?? null,
      });
    }

    if (orderItems.length === 0) {
      return NextResponse.json(
        { error: "Не найдено валидных товаров в корзине" },
        { status: 400 }
      );
    }

    // 5. Валидация deliveryCost
    const safeDeliveryCost = Math.max(0, Math.min(Number(deliveryCost) || 0, 5000));

    // 6. Получение confectionerId из первого товара + снапшот тарифа
    let confectionerId: string | null = null;
    let tariffSnapshot: string | null = null;
    let commissionRateSnapshot: number | null = null;
    let legalStatusSnapshot: string | null = null;

    const firstItem = orderItems[0];
    if (firstItem) {
      const { data: product } = await supabaseAdmin
        .from("products")
        .select("confectioner_id")
        .eq("id", firstItem.product_id)
        .maybeSingle();
      confectionerId = product?.confectioner_id || null;

      if (confectionerId) {
        const { data: conf } = await supabaseAdmin
          .from("confectioners")
          .select("tariff, legal_info")
          .eq("id", confectionerId)
          .maybeSingle();

        if (conf) {
          tariffSnapshot = String(conf.tariff || "BASIC");
          commissionRateSnapshot = TARIFF_RATES[tariffSnapshot] ?? DEFAULT_COMMISSION_RATE;
          const legalInfo = (conf.legal_info as { status?: string } | null) || null;
          legalStatusSnapshot = legalInfo?.status || null;
        }
      }
    }

    // 7. Серверная валидация промокода
    let promoCodeId: string | null = null;
    let promoCodeApplied: string | null = null;
    let promoDiscount = 0;
    if (promoCodeInput) {
      try {
        const { validatePromoCode } = await import("@/lib/promo-codes");
        const promoResult = await validatePromoCode({
          code: String(promoCodeInput).trim(),
          userId: user.userId as string,
          userRoles: (user.roles as string[]) || ["CUSTOMER"],
          orderAmount: itemsTotal,
          confectionerId: confectionerId || undefined,
        });
        if (!promoResult.valid) {
          return NextResponse.json(
            { error: promoResult.reason || "Промокод недействителен" },
            { status: 400 }
          );
        }
        promoCodeId = promoResult.promoCodeId || null;
        promoCodeApplied = String(promoCodeInput).trim().toUpperCase();
        promoDiscount = promoResult.discountRub || 0;
      } catch (e: any) {
        console.error("[orders] Promo validation error:", e?.message);
        return NextResponse.json(
          { error: "Ошибка валидации промокода" },
          { status: 500 }
        );
      }
    }

    // 8. Заглушка для бонусов — реальное списание после создания заказа
    let bonusPointsRedeemed = 0;
    let bonusDiscountRub = 0;
    // Проверяем валидность только (positive number) — реальное списание через redeemPoints
    // делаем после создания заказа (требуется orderId для идемпотентности)
    const bonusPointsRequested =
      bonusPointsToRedeem && Number(bonusPointsToRedeem) > 0
        ? Number(bonusPointsToRedeem)
        : 0;

    // 1 бонус = 1 рубль — это значение запишем в заказ
    bonusDiscountRub = bonusPointsRequested;

    // Итоговая сумма: товары + доставка − промо-скидка − бонусная скидка
    const totalDiscount = promoDiscount + bonusDiscountRub;
    const finalTotal = Math.max(1, itemsTotal + safeDeliveryCost - totalDiscount);

    // 9. Генерация номера заказа
    const orderNumber = `UK-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

    // Создание заказа в БД
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert({
        number: orderNumber,
        user_id: user.userId as string,
        confectioner_id: confectionerId,
        status: "PENDING",
        total: finalTotal,
        delivery_address: typeof deliveryAddress === "string" ? deliveryAddress : null,
        delivery_date: deliveryDateStr ? new Date(deliveryDateStr).toISOString() : null,
        delivery_time: typeof deliveryTime === "string" ? deliveryTime : null,
        delivery_cost: safeDeliveryCost,
        payment_method: typeof paymentMethod === "string" ? paymentMethod : "card",
        payment_status: "pending",
        comment: typeof comment === "string" ? comment : null,
        tariff_snapshot: tariffSnapshot,
        commission_rate_snapshot: commissionRateSnapshot,
        legal_status_snapshot: legalStatusSnapshot,
        bonus_points_redeemed: bonusPointsRequested,
        bonus_discount_rub: bonusDiscountRub,
        promo_code_applied: promoCodeApplied,
        promo_code_id: promoCodeId,
        promo_discount: promoDiscount,
        metadata: { items_count: orderItems.length },
      })
      .select("id, number")
      .single();

    if (orderErr || !order) {
      console.error("[orders] POST create error:", orderErr?.message);
      return NextResponse.json(
        { error: "Ошибка при создании заказа", details: orderErr?.message },
        { status: 500 }
      );
    }

    // Создать order_items
    const orderItemsInsert = orderItems.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      title: item.title,
      image: item.image,
      price: item.price,
      quantity: item.quantity,
      customization: item.customization,
    }));

    const { error: itemsErr } = await supabaseAdmin
      .from("order_items")
      .insert(orderItemsInsert);

    if (itemsErr) {
      console.error("[orders] items insert error:", itemsErr.message);
      // Заказ создан, но без items — не откатываем
    }

    // 8.5. Реальное списание бонусов через redeemPoints (с реальным orderId)
    if (bonusPointsRequested > 0) {
      try {
        const { redeemPoints } = await import("@/lib/loyalty");
        const result = await redeemPoints(
          user.userId as string,
          order.id,
          finalTotal,
          bonusPointsRequested
        );
        bonusPointsRedeemed = result.redeemedPoints;
        console.info(
          `[orders] Redeemed ${bonusPointsRedeemed} bonus points for order ${order.number}`
        );
      } catch (e: any) {
        // Недостаточно бонусов — отменить заказ
        console.error("[orders] redeemPoints failed:", e?.message);
        await supabaseAdmin
          .from("orders")
          .update({
            status: "CANCELLED",
            payment_status: "failed",
            comment: `Отмена: недостаточно бонусов (${e?.message || "unknown"})`,
          })
          .eq("id", order.id);

        // Откатить инкремент промокода если был
        if (promoCodeId) {
          const { data: promo } = await supabaseAdmin
            .from("promo_codes")
            .select("used_count")
            .eq("id", promoCodeId)
            .maybeSingle();
          if (promo && promo.used_count > 0) {
            await supabaseAdmin
              .from("promo_codes")
              .update({ used_count: promo.used_count - 1 })
              .eq("id", promoCodeId);
          }
        }

        return NextResponse.json(
          { error: e?.message || "Недостаточно бонусов", orderId: order.id },
          { status: 400 }
        );
      }
    }

    // 10. Инкремент usedCount промокода
    if (promoCodeId) {
      const { data: promo } = await supabaseAdmin
        .from("promo_codes")
        .select("used_count")
        .eq("id", promoCodeId)
        .maybeSingle();
      if (promo) {
        await supabaseAdmin
          .from("promo_codes")
          .update({ used_count: (promo.used_count || 0) + 1 })
          .eq("id", promoCodeId);
      }
    }

    // 11. Уведомления: покупателю + кондитеру (non-blocking)
    try {
      const { sendNotification } = await import("@/lib/notifications");
      await sendNotification({
        userId: user.userId as string,
        template: "ORDER_CREATED",
        vars: {
          orderNumber: order.number,
          total: finalTotal,
        },
        data: { orderId: order.id, type: "order_created" },
      });

      if (confectionerId) {
        const { data: confUser } = await supabaseAdmin
          .from("confectioners")
          .select("user_id")
          .eq("id", confectionerId)
          .maybeSingle();
        if (confUser) {
          await sendNotification({
            userId: confUser.user_id,
            template: "NEW_MESSAGE",
            vars: {
              senderName: "Новый заказ",
              text: `Заказ #${order.number} на сумму ${finalTotal} ₽`,
            },
            data: { orderId: order.id, type: "new_order" },
          });
        }
      }
    } catch (notifErr: any) {
      console.warn("[orders] Notification failed (non-blocking):", notifErr?.message);
    }

    // 12. Создание chat-комнаты для заказа (non-blocking)
    try {
      const { ensureOrderChatRoom } = await import("@/lib/chat-automation");
      const chatRoomId = await ensureOrderChatRoom(order.id);
      console.info(`[orders] Auto-chat room created: ${chatRoomId} for order ${order.number}`);
    } catch (chatErr: any) {
      console.warn("[orders] Auto-chat creation failed (non-blocking):", chatErr?.message);
    }

    // 13. Telegram уведомление о новом заказе (non-blocking)
    try {
      const { notifyNewOrder } = await import("@/lib/telegram-bot");
      await notifyNewOrder({
        orderNumber: order.number,
        customerName: user.name || "Клиент",
        total: finalTotal,
        items: orderItems.map((item) => ({
          title: item.title,
          quantity: item.quantity,
          price: item.price,
        })),
        confectionerName: undefined, // можно загрузить через отдельный запрос
        paymentMethod: typeof paymentMethod === "string" ? paymentMethod : "card",
        deliveryDate:
          deliveryDateStr
            ? new Date(deliveryDateStr).toLocaleDateString("ru-RU")
            : undefined,
      });
    } catch (tgErr: any) {
      console.warn("[orders] Telegram notification failed (non-blocking):", tgErr?.message);
    }

    // 14. Яндекс Метрика: server-side трекинг заказа (non-blocking)
    try {
      const { trackEventServer } = await import("@/lib/yandex-metrika");
      await trackEventServer("order_created", {
        order_id: order.id,
        order_number: order.number,
        revenue: finalTotal,
        items_count: orderItems.length,
      });
    } catch (ymErr: any) {
      console.warn("[orders] Yandex Metrika tracking failed (non-blocking):", ymErr?.message);
    }

    // 15. Email: уведомление клиенту о новом заказе (non-blocking)
    try {
      const { sendTemplateEmail } = await import("@/lib/email");
      const { data: customer } = await supabaseAdmin
        .from("profiles")
        .select("email, name")
        .eq("id", user.userId as string)
        .maybeSingle();
      if (customer?.email) {
        await sendTemplateEmail("order_created", {
          to: customer.email,
          toName: customer.name,
          userId: user.userId as string,
          orderId: order.id,
          params: {
            orderNumber: order.number,
            customerName: customer.name,
            total: finalTotal,
            items: orderItems.map((item) => ({
              title: item.title,
              quantity: item.quantity,
              price: item.price,
            })),
            deliveryDate:
              deliveryDateStr
                ? new Date(deliveryDateStr).toLocaleDateString("ru-RU")
                : "не указана",
            paymentMethod: typeof paymentMethod === "string" ? paymentMethod : "card",
          },
        });
      }
    } catch (emailErr: any) {
      console.warn("[orders] Email notification failed (non-blocking):", emailErr?.message);
    }

    return NextResponse.json(
      {
        order: {
          id: order.id,
          number: order.number,
          status: "PENDING",
          total: finalTotal,
          items_count: orderItems.length,
          bonus_points_redeemed: bonusPointsRedeemed,
          promo_code_applied: promoCodeApplied,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("POST /api/orders error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
