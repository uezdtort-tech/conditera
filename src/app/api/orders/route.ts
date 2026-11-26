/**
 * GET /api/orders — список заказов текущего пользователя
 * POST /api/orders — создать заказ
 *
 * POST-логика:
 *   1. Проверка аутентификации и anti-fraud (≤5 заказов/час с IP)
 *   2. Если isCorporate=true — проверка организации через DaData
 *   3. Валидация items (quantity 1-999, productId существует)
 *   4. Расчёт itemsTotal на основе цены товара из БД
 *      (PR-2C: база — get_product_price_at(now), фолбэк products.price;
 *      order_items.price_version_id + metadata.pricing)
 *   5. Доставка — СЕРВЕРНЫЙ расчёт calculateDelivery (lib/finance, единая
 *      формула с checkout). Присланный клиентом deliveryCost НЕ используется
 *      для расчёта — только в metadata.pricing.deliveryClientSubmitted (аудит).
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
import { loadConfectionerOrderSnapshot } from "@/lib/confectioner-tariff";
import { buildAcceptanceSnapshot, type AcceptanceSnapshot } from "@/lib/ops/snapshot";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";
import { calculateDelivery } from "@/lib/finance";
import { getPool } from "@/lib/postgrest/pool";
import {
  resolveCurrentPriceSafe,
  syncEffectiveProductPricesSafe,
} from "@/lib/price-version";
import { emitEvent } from "@/lib/n8n";
import { recordEvent } from "@/lib/ops/events";

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
  price_version_id: string | null; // PR-2C: привязка к версии цены (legacy-фолбэк → NULL)
}

// Ставки комиссии — в lib/confectioner-tariff.ts (ЕДИНЫЙ источник с checkout)

/**
 * GET /api/orders — список заказов текущего пользователя.
 * Поддерживает фильтр ?status=PENDING|CONFIRMED|...
 *
 * Локальный runtime: embed confectioner:confectioners(...) убран — между
 * orders и confectioners нет FK (и в 0017 camelCase-колонки). Информация о
 * кондитере дозагружается вторым простым запросом (safe enrich, см. ниже).
 * CONFECTIONER/ADMIN видят также заказы, назначенные им (confectioner_id).
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

    const roles = (user.roles as string[]) || [];
    const isPerformer =
      roles.includes("CONFECTIONER") ||
      roles.includes("ADMIN") ||
      roles.includes("SUPER_ADMIN");

    let query = supabaseAdmin
      .from("orders")
      .select(
        `
        id, number, status, total, delivery_address, delivery_date,
        delivery_time, delivery_cost, payment_method, payment_status,
        comment, confectioner_id, user_id, created_at
      `
      );

    if (isPerformer) {
      // Свои заказы как покупателя + назначенные как кондитеру
      query = query.or(
        `user_id.eq.${user.userId},confectioner_id.eq.${user.userId}`
      );
    } else {
      query = query.eq("user_id", user.userId);
    }

    query = query.order("created_at", { ascending: false });

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
      // checkout пишет product_title/product_image/unit_price, /api/orders POST —
      // title/image/price; берём оба набора и сводим (колонки-дубли в 0017).
      const { data: items } = await supabaseAdmin
        .from("order_items")
        .select(
          "id, order_id, product_id, title, image, price, product_title, product_image, unit_price, quantity, customization"
        )
        .in("order_id", orderIds);
      for (const raw of items || []) {
        const item = {
          ...raw,
          title: raw.title || raw.product_title || null,
          image: raw.image || raw.product_image || null,
          price:
            Number(raw.price) > 0
              ? Number(raw.price)
              : Number(raw.unit_price ?? 0),
        };
        const arr = itemsByOrder.get(item.order_id) || [];
        arr.push(item);
        itemsByOrder.set(item.order_id, arr);
      }
    }

    // Safe enrich: инфо о кондитере вторым запросом (без FK/embed).
    // confectioners.id — text ('c0'), orders.confectioner_id — uuid пользователя,
    // поэтому маппинг по "userId"; фолбэк — по id. Ошибка обогащения не роняет список.
    const confIds = Array.from(
      new Set(
        (orders || [])
          .map((o: any) => o.confectioner_id)
          .filter((v: unknown): v is string => typeof v === "string" && v.length > 0)
      )
    );
    const confByKey = new Map<string, { business_name: string | null; avatar: string | null }>();
    if (confIds.length > 0) {
      let rows: any[] | null = null;
      try {
        const byUser = await supabaseAdmin
          .from("confectioners")
          .select("userId, businessName, avatar")
          .in("userId", confIds);
        if (!byUser.error) rows = (byUser.data as any[]) || null;
      } catch {
        rows = null;
      }
      if (!rows) {
        // Фолбэк: старые сиды, где orders.confectioner_id совпадает с confectioners.id
        try {
          const byId = await supabaseAdmin
            .from("confectioners")
            .select("id, businessName, avatar")
            .in("id", confIds);
          if (!byId.error) rows = (byId.data as any[]) || null;
        } catch {
          rows = null;
        }
      }
      for (const r of rows || []) {
        const info = {
          business_name: (r.businessName as string) || null,
          avatar: (r.avatar as string) || null,
        };
        if (r.userId) confByKey.set(r.userId, info);
        if (r.id) confByKey.set(r.id, info);
      }
    }

    // Этап 10 §A3: имя покупателя для кондитерского скоупа (раньше UI показывал
    // пустую строку — contact через чат не очевиден). Отдаём только имя профиля,
    // без email/телефона — в пределах допустимой информации о покупателе.
    // Safe enrich: ошибка не роняет список.
    const customerIds = Array.from(
      new Set(
        (orders || [])
          .map((o: any) => o.user_id)
          .filter((v: unknown): v is string => typeof v === "string" && v.length > 0)
      )
    );
    const customerNames = new Map<string, string>();
    if (customerIds.length > 0) {
      try {
        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("id, name")
          .in("id", customerIds);
        for (const p of profiles || []) {
          customerNames.set((p as any).id, ((p as any).name as string) || "");
        }
      } catch {
        // фолбэк ниже оставит пустую строку — список заказов не блокируем
      }
    }

    const result = (orders || []).map((o: any) => ({
      ...o,
      confectioner: o.confectioner_id ? confByKey.get(o.confectioner_id) || null : null,
      customer_name: customerNames.get(o.user_id) || "",
      items: itemsByOrder.get(o.id) || [],
    }));

    return NextResponse.json({ orders: result });
  } catch (error: any) {
    // Z-v19 §6 fix: регистрация 5xx в app_error_events (было только console.error)
    console.error("GET /api/orders error:", error?.message);
    return handleRouteError(error, { route: "/api/orders", component: "orders" });
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

    // Legacy POST /api/orders не создаёт YooKassa payment/ledger. Карточные
    // заказы обязаны проходить через /api/checkout, иначе заказ остаётся без оплаты.
    const normalizedPaymentMethod = typeof paymentMethod === "string" ? paymentMethod.trim().toLowerCase() : "card";
    if (normalizedPaymentMethod !== "cash") {
      return NextResponse.json(
        { error: "Для оплаты картой используйте оформление через платёжный checkout.", code: "CHECKOUT_REQUIRED" },
        { status: 409 }
      );
    }

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
    // PR-2C: перед резолвом цен — ленивый catch-up эффективных цен (best-effort,
    // тот же контракт, что в checkout: сбой синка НЕ валид заказ).
    await syncEffectiveProductPricesSafe(getPool());

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

      // PR-2C: базовая цена — покрывающая now версия истории цен (0083).
      // Legacy-фолбэк (version_id NULL) или ошибка БД → products.price как раньше.
      let unitPrice = Number(product.price);
      let priceVersionId: string | null = null;
      const resolved = await resolveCurrentPriceSafe(getPool(), product.id);
      if (resolved) {
        unitPrice = resolved.amount;
        priceVersionId = resolved.versionId;
      }

      const itemTotal = unitPrice * item.quantity;
      itemsTotal += itemTotal;

      orderItems.push({
        product_id: product.id,
        title: product.title,
        image: ((product.images as string[]) || [])[0] || "",
        price: unitPrice,
        quantity: item.quantity,
        customization: item.customization ?? null,
        price_version_id: priceVersionId,
      });
    }

    if (orderItems.length === 0) {
      return NextResponse.json(
        { error: "Не найдено валидных товаров в корзине" },
        { status: 400 }
      );
    }

    // 5. PR-2C SECURITY FIX: доставка считается СЕРВЕРОМ той же функцией, что
    // и в checkout (lib/finance.calculateDelivery; pickup в этом пути нет —
    // заказ всегда с адресом). Клиентское deliveryCost для расчёта НЕ
    // используется: оно может быть сохранено ТОЛЬКО в metadata.pricing.
    // deliveryClientSubmitted (аудит отклонения клиентских ожиданий).
    const serverDeliveryCost = calculateDelivery(itemsTotal).cost;
    const clientDeliverySubmitted =
      typeof deliveryCost === "number" && Number.isFinite(deliveryCost)
        ? deliveryCost
        : typeof deliveryCost === "string" && deliveryCost.trim() !== "" && Number.isFinite(Number(deliveryCost))
          ? Number(deliveryCost)
          : null;

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
        // products.confectioner_id — UUID пользователя (auth.users), а
        // confectioners.id — TEXT legacy-сид ('c0'…). Раньше искали по id и
        // ВСЕГДА промахивались → tariff/commission snapshot были null у ВСЕХ
        // заказов этого пути. Единый хелпер (checkout использует тот же):
        // поиск по "userId" + только approved.
        const snapshot = await loadConfectionerOrderSnapshot(confectionerId);
        tariffSnapshot = snapshot.tariffSnapshot;
        commissionRateSnapshot = snapshot.commissionRateSnapshot;
        legalStatusSnapshot = snapshot.legalStatusSnapshot;
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

    // Итоговая сумма: товары + СЕРВЕРНАЯ доставка − промо-скидка − бонусная скидка
    const totalDiscount = promoDiscount + bonusDiscountRub;
    const finalTotal = Math.max(1, itemsTotal + serverDeliveryCost - totalDiscount);

    // 8.5. Z-v29: НЕИЗМЕНЯЕМЫЙ snapshot производственной потребности —
    // тот же контракт, что у checkout: сервер собирает состав из БД в момент
    // фиксации, запись попадает В ТОТ ЖЕ INSERT orders (metadata.acceptance_snapshot).
    // Fail-closed: ошибка сборки → 503 ДО создания заказа.
    let acceptanceSnapshot: AcceptanceSnapshot | null = null;
    {
      const built = await buildAcceptanceSnapshot({
        items: orderItems.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
        source: "orders_b2b",
      });
      if (!built.ok) {
        console.error("[orders] acceptance snapshot build failed:", built.error);
        return NextResponse.json(
          { error: "Не удалось зафиксировать производственный состав заказа, попробуйте позже" },
          { status: 503 }
        );
      }
      acceptanceSnapshot = built.snapshot;
    }

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
        delivery_cost: serverDeliveryCost,
        payment_method: "cash",
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
        metadata: {
          items_count: orderItems.length,
          // PR-2C: аудит привязки цен + серверного расчёта доставки.
          // Присланный клиентом deliveryCost сохраняется ТОЛЬКО здесь.
          pricing: {
            resolvedAt: new Date().toISOString(),
            currency: "RUB" as const,
            items: orderItems.map((i) => ({
              productId: i.product_id,
              priceVersionId: i.price_version_id,
              unitPrice: i.price,
            })),
            deliverySource: "server_calculated" as const,
            deliveryClientSubmitted: clientDeliverySubmitted,
          },
          // Z-v29: снимок производственной потребности на момент оформления
          ...(acceptanceSnapshot ? { acceptance_snapshot: acceptanceSnapshot } : {}),
        },
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

    // n8n: order.created (fail-safe, после успешной записи заказа)
    void emitEvent("order.created", {
      orderId: order.id,
      orderNumber: order.number,
      total: finalTotal,
      userId: user.userId as string,
    }).catch(() => {});

    // ops: event log (append-only, fail-safe)
    void recordEvent("order.created", {
      entityType: "order",
      entityId: order.id,
      actorId: user.userId as string,
      payload: { number: order.number, total: finalTotal },
    });

    // Создать order_items
    const orderItemsInsert = orderItems.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      title: item.title,
      image: item.image,
      price: item.price,
      quantity: item.quantity,
      customization: item.customization,
      price_version_id: item.price_version_id, // PR-2C: привязка версии цены
    }));

    const { error: itemsErr } = await supabaseAdmin
      .from("order_items")
      .insert(orderItemsInsert);

    if (itemsErr) {
      console.error("[orders] items insert error:", itemsErr.message);
      const { error: cancelError } = await supabaseAdmin.from("orders")
        .update({
          status: "CANCELLED",
          payment_status: "failed",
          comment: "Автоматическая отмена: не удалось сохранить состав заказа",
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      if (cancelError) console.error("[orders] failed to cancel order after items insert error:", cancelError.message);
      return NextResponse.json(
        { error: "Не удалось сохранить состав заказа. Заказ не принят.", code: "ORDER_ITEMS_SAVE_FAILED" },
        { status: 500 }
      );
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

        // История системной отмены (заказ только что создан в PENDING).
        // FIX-TL: раньше строку писал триггер orders_log_status (0006,
        // changed_by=NULL); триггер удалён (0061) — пишем сами.
        await supabaseAdmin
          .from("order_status_history")
          .insert({
            order_id: order.id,
            status_from: "PENDING",
            status_to: "CANCELLED",
            comment: `Отмена: недостаточно бонусов (${e?.message || "unknown"})`,
          });

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
        // P1.1: дедуп события — повторная эмиссия не задвоит уведомление
        dedupKey: `order-created:${order.id}`,
      });

      if (confectionerId) {
        const { data: confUser } = await supabaseAdmin
          .from("confectioners")
          .select("userId")
          .eq("id", confectionerId)
          .maybeSingle();
        if (confUser) {
          await sendNotification({
            userId: confUser.userId,
            template: "NEW_MESSAGE",
            vars: {
              senderName: "Новый заказ",
              text: `Заказ #${order.number} на сумму ${finalTotal} ₽`,
            },
            data: { orderId: order.id, type: "new_order" },
            dedupKey: `order-created-cf:${order.id}`,
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
    // Z-v19 §6 fix: регистрация 5xx в app_error_events (было только console.error)
    console.error("POST /api/orders error:", error?.message);
    return handleRouteError(error, { route: "/api/orders", component: "orders" });
  }
}
