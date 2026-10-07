/**
 * POST /api/checkout — оформить заказ + создать платёж YooKassa.
 *
 * Flow:
 *   0. Rate limit (5/min, как payment/create) + auth (Supabase session)
 *   1. Idempotency-Key (заголовок): повтор в течение 15 минут возвращает
 *      СУЩЕСТВУЮЩИЙ заказ (поиск user_id + metadata->>idempotency_key)
 *   2. Zod-валидация тела (quantity 1..999, cartItems: product_id | custom,
 *      адрес обязателен только для deliveryType=delivery)
 *   3. Товары из products (admin client): published + СЕРВЕРНЫЙ пересчёт цены:
 *      unit_price = products.price + валидированные модификаторы (fillings jsonb);
 *      custom-позиции конструктора — validateBuilderConfig + calculateBuilderPrice
 *      (ЕДИНАЯ формула с клиентом, src/lib/cake-builder-pricing.ts).
 *      Неизвестный модификатор → 422 (не молчаливое игнорирование).
 *   4. Промокод — серверная истина (lib/promo-codes): discount в рублях,
 *      free_delivery → delivery_cost = 0; orders.promo_code/promo_discount.
 *   5. Доставка: calculateDelivery (единая формула с клиентом); pickup → 0.
 *   6. Суммы в РУБЛЯХ. order + order_items (снапшот цен + selected_attributes).
 *   7. Платёж через lib/yookassa — детерминированный Idempotence-Key.
 *   8. Корзину чистим ТОЛЬКО после успешного создания платежа.
 *
 * Возвращает: { orderId, orderNumber, paymentUrl, total, isStub, subtotal,
 *               deliveryCost, discount, appliedPromoCode, items[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
// Единый auth-контракт (Bearer + cookie cd_session): getSession() требовал
// GoTrue (/auth/v1 — 501-стаб в локальном runtime) и всегда отдавал 401.
import { getUserFromRequest } from "@/lib/auth";
import { calculateDelivery } from "@/lib/finance";
import { checkAcceptance } from "@/lib/ops/acceptance"; // P0.5 §29: capacity/inventory/deadline gate
import { createPayment, isYookassaConfigured } from "@/lib/yookassa";
import { enforceRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit";
import {
  validatePromoCode,
  applyPromoCodeToOrder,
  normalizePromoCodeInput,
  extractIdempotencyKey,
} from "@/lib/promo-codes";
import {
  validateBuilderConfig,
  calculateBuilderPrice,
  describeBuilderConfig,
  mergeBuilderFillings,
  type CakeBuilderConfig,
} from "@/lib/cake-builder-pricing";

/** Разрешённые ключи кастомизации товара (product-page: filling/coating/decoration/inscription). */
const ALLOWED_ATTR_KEYS = new Set(["filling", "coating", "decoration", "inscription"]);
const MAX_INSCRIPTION_LENGTH = 100;
/** Окно идемпотентности checkout (P1-A6). */
const IDEMPOTENCY_TTL_MINUTES = 15;

const CheckoutSchema = z
  .object({
    cartItems: z
      .array(
        z.object({
          id: z.string().max(100).optional(),
          product_id: z.string().max(100).optional(),
          quantity: z.number().int().min(1).max(999),
          selected_attributes: z.record(z.string(), z.string()).optional(),
          custom: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .min(1)
      .max(50),
    deliveryAddress: z.string().max(500).optional(),
    deliveryCity: z.string().min(1).max(100),
    deliveryDate: z.string().max(40).optional(),
    deliveryType: z.enum(["delivery", "pickup", "self_pickup"]).optional(),
    notes: z.string().max(1000).optional(),
    promoCode: z.string().max(40).optional(),
    customerName: z.string().min(2).max(100),
    customerPhone: z.string().min(10).max(20),
    paymentMethod: z.string().max(30).optional(),
  })
  .superRefine((val, ctx) => {
    // Каждая позиция: либо товар, либо custom-конфигурация конструктора
    val.cartItems.forEach((item, idx) => {
      if (!item.product_id && !item.custom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cartItems", idx],
          message: "Позиция требует product_id или custom (конфигурация конструктора)",
        });
      }
      if (item.product_id && item.custom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cartItems", idx],
          message: "Позиция не может одновременно иметь product_id и custom",
        });
      }
    });
    // Адрес обязателен только для доставки
    const deliveryType = val.deliveryType ?? "delivery";
    if (deliveryType === "delivery") {
      const addr = (val.deliveryAddress || "").trim();
      if (addr.length < 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deliveryAddress"],
          message: "Адрес доставки обязателен (минимум 5 символов) при доставке",
        });
      }
    }
  });

/** JSONB fillings товара: [{ name, priceModifier }] | [string] | пусто. */
function normalizeProductFillings(raw: unknown): Array<{ name: string; priceModifier: number }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return { name: entry, priceModifier: 0 };
      if (entry && typeof entry === "object") {
        const e = entry as { name?: unknown; priceModifier?: unknown };
        if (typeof e.name === "string") {
          const mod = Number(e.priceModifier);
          return {
            name: e.name,
            priceModifier: Number.isFinite(mod) ? mod : 0,
          };
        }
      }
      return null;
    })
    .filter((x): x is { name: string; priceModifier: number } => x !== null);
}

/** Валидация телефона РФ: 11 цифр, начинается с 7/8 (или 10 цифр начиная с 9). */
function isValidRuPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) return true;
  if (digits.length === 10 && digits.startsWith("9")) return true;
  return false;
}

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

    // 1. Идемпотентность (P1-A6): повторный POST с тем же Idempotency-Key
    //    возвращает СУЩЕСТВУЮЩИЙ заказ вместо создания нового.
    const idempotencyKey = extractIdempotencyKey(request);
    if (idempotencyKey) {
      const since = new Date(Date.now() - IDEMPOTENCY_TTL_MINUTES * 60 * 1000).toISOString();
      const { data: existing } = await supabaseAdmin
        .from("orders")
        .select("id, number, total, subtotal, delivery_cost, discount, created_at")
        .eq("user_id", user.id)
        .eq("metadata->>idempotency_key", idempotencyKey)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        const replay = await buildReplayResponse(existing);
        return NextResponse.json(replay);
      }
    }

    // 2. Валидация тела
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
      customerName,
      customerPhone,
      paymentMethod,
    } = parsed.data;

    // Контакт получателя — серверная валидация (P1-A7)
    const name = customerName.trim();
    const phone = customerPhone.trim();
    if (name.length < 2) {
      return NextResponse.json(
        { error: "Имя получателя должно содержать минимум 2 символа" },
        { status: 400 }
      );
    }
    if (!isValidRuPhone(phone)) {
      return NextResponse.json(
        { error: "Телефон получателя должен быть номером РФ (например +7 999 123-45-67)" },
        { status: 400 }
      );
    }

    // 3. Товары из БД (только product-позиции)
    const productItems = cartItems.filter(
      (c): c is typeof c & { product_id: string } => typeof c.product_id === "string" && c.product_id.length > 0
    );
    const customItems = cartItems.filter((c) => !c.product_id && c.custom);

    const productIds = [...new Set(productItems.map((c) => c.product_id))];
    const productsMap = new Map<
      string,
      { id: string; title: string; price: number; status: string; confectioner_id: string | null; fillings: unknown }
    >();

    if (productIds.length > 0) {
      const { data: products, error: productsError } = await supabaseAdmin
        .from("products")
        .select("id, title, price, status, confectioner_id, fillings")
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

      const draftProducts = products.filter((p) => p.status !== "published");
      if (draftProducts.length > 0) {
        return NextResponse.json(
          { error: `Товары недоступны: ${draftProducts.map((p) => p.title).join(", ")}` },
          { status: 400 }
        );
      }
      for (const p of products) productsMap.set(p.id, p);
    }

    // 3a. Начинки конструктора: DB (APPROVED) + mock — единый справочник с клиентом
    let builderFillings = mergeBuilderFillings(null);
    if (customItems.length > 0) {
      try {
        const { data: dbFillings } = await supabaseAdmin
          .from("fillings")
          .select("id, name, price_multiplier")
          .eq("status", "APPROVED")
          .limit(500);
        builderFillings = mergeBuilderFillings(dbFillings || []);
      } catch (e) {
        console.warn("[checkout] fillings load failed, using mock catalog:", (e as Error).message);
      }
    }

    // 3b. Серверный пересчёт позиций (НЕ доверяем клиентской цене)
    interface ComputedItem {
      product_id: string | null;
      product_title: string;
      unit_price: number;
      quantity: number;
      selected_attributes: Record<string, unknown> | null;
      total: number;
    }
    const orderItems: ComputedItem[] = [];

    for (const item of productItems) {
      const product = productsMap.get(item.product_id);
      if (!product) throw new Error(`Product ${item.product_id} not found`);

      const attrs: Record<string, unknown> = {};
      let unitPrice = product.price; // рубли (НЕ копейки — см. seed/формат витрины)

      if (item.selected_attributes) {
        // Неизвестный ключ модификатора → 422 (не молчаливое игнорирование)
        for (const key of Object.keys(item.selected_attributes)) {
          if (!ALLOWED_ATTR_KEYS.has(key)) {
            return NextResponse.json(
              { error: `Неизвестный модификатор товара: ${key}` },
              { status: 422 }
            );
          }
        }

        const registry = normalizeProductFillings(product.fillings);
        const fillingName = item.selected_attributes.filling?.trim();
        if (fillingName) {
          if (registry.length === 0) {
            return NextResponse.json(
              { error: "Начинка недоступна для этого товара" },
              { status: 422 }
            );
          }
          const found = registry.find((f) => f.name === fillingName);
          if (!found) {
            return NextResponse.json(
              { error: `Начинка «${fillingName.slice(0, 60)}» недоступна для этого товара` },
              { status: 422 }
            );
          }
          unitPrice += found.priceModifier;
          attrs.filling = found.name;
        }

        // products: колонок coatings/decorations в БД нет (модификаторов цены не существует).
        // Принимаем их КАК ИНФОРМАЦИОННЫЕ атрибуты (пишутся кондитеру), БЕЗ изменения цены —
        // иначе витринный путь «товар с покрытием/декором → checkout» всегда падал бы 422.
        // Жёсткая валидация остаётся у НАЧИНКИ — у неё есть реальные price_modifier.
        const coatingName = item.selected_attributes.coating?.trim();
        if (coatingName) {
          if (coatingName.length > 100) {
            return NextResponse.json(
              { error: "Покрытие — до 100 символов" },
              { status: 422 }
            );
          }
          attrs.coating = coatingName; // информационно, без price_modifier
        }
        const decorationName = item.selected_attributes.decoration?.trim();
        if (decorationName) {
          if (decorationName.length > 200) {
            return NextResponse.json(
              { error: "Декор — до 200 символов" },
              { status: 422 }
            );
          }
          attrs.decoration = decorationName; // информационно, без price_modifier
        }

        const inscription = item.selected_attributes.inscription?.trim();
        if (inscription) {
          if (inscription.length > MAX_INSCRIPTION_LENGTH) {
            return NextResponse.json(
              { error: "Надпись на торте — до 100 символов" },
              { status: 422 }
            );
          }
          attrs.inscription = inscription; // бесплатно, пишем кондитеру
        }
      }

      orderItems.push({
        product_id: product.id,
        product_title: product.title,
        unit_price: unitPrice,
        quantity: item.quantity,
        selected_attributes: Object.keys(attrs).length > 0 ? attrs : null,
        total: unitPrice * item.quantity,
      });
    }

    for (const item of customItems) {
      const cfg = item.custom as CakeBuilderConfig;
      const validation = validateBuilderConfig(cfg, { fillings: builderFillings });
      if (!validation.valid) {
        return NextResponse.json(
          { error: validation.reason || "Некорректная конфигурация конструктора" },
          { status: 422 }
        );
      }
      const unitPrice = calculateBuilderPrice(cfg, { fillings: builderFillings });
      if (unitPrice === null || !Number.isFinite(unitPrice) || unitPrice < 0) {
        return NextResponse.json(
          { error: "Не удалось рассчитать цену конфигурации конструктора" },
          { status: 422 }
        );
      }
      orderItems.push({
        product_id: null,
        product_title: describeBuilderConfig(cfg, { fillings: builderFillings }),
        unit_price: unitPrice,
        quantity: item.quantity,
        selected_attributes: { ...cfg } as Record<string, unknown>, // снимок конфига — кондитер видит состав
        total: unitPrice * item.quantity,
      });
    }

    const subtotal = orderItems.reduce((sum, item) => sum + item.total, 0);

    // Confectioner_id — из первого ТОВАРНОГО товара (custom-позиции без кондитера)
    const confectionerId =
      (productItems.length > 0
        ? productsMap.get(productItems[0].product_id)?.confectioner_id ?? null
        : null) ?? null;

    // 3.5 P0.5 §29: Acceptance Engine — проверка выполнимости ДО создания заказа.
    // Блокируем ТОЛЬКО недоступность; предупреждения не блокируют оплату.
    // Custom-позиции конструктора не имеют product_id — в гейт не попадают.
    if (productItems.length > 0) {
      try {
        const loadedItems = productItems.map((c) => ({
          productId: c.product_id,
          quantity: c.quantity,
        }));
        const itemsData = await (async () => {
          const { loadProductItemsData } = await import("@/lib/ops/acceptance");
          return loadProductItemsData(loadedItems);
        })();
        const acceptance = await checkAcceptance({
          items: itemsData,
          assignedConfectionerId: confectionerId,
          deliveryDate: deliveryDate ?? null,
          deliveryTimeWindow: null,
          deliveryTime: null,
        });
        if (!acceptance.canAccept) {
          const nextWindow = acceptance.alternativeWindows[0];
          return NextResponse.json(
            {
              error:
                "На выбранное время заказ выполнить не получится. " +
                (nextWindow
                  ? `Ближайшее доступное время — ${nextWindow.date} ${nextWindow.start}.`
                  : "Попробуйте другую дату."),
              availability: acceptance.availability,
              reasons: acceptance.reasons,
              suggestions: acceptance.suggestions,
              alternativeWindows: acceptance.alternativeWindows,
            },
            { status: 422 }
          );
        }
      } catch (accErr) {
        // Движок недоступен/ошибка — НЕ блокируем checkout (fail-open,
        // документировано): заказ создаётся, риск пересчитается при назначении.
        console.warn(
          "[checkout] acceptance check failed (fail-open):",
          accErr instanceof Error ? accErr.message : accErr
        );
      }
    }

    // 4. Доставка — ЕДИНАЯ формула с клиентом (P1-A5); самовывоз → 0 (P1-A7)
    const deliveryResult =
      deliveryType === "delivery" ? calculateDelivery(subtotal) : { cost: 0 };
    let deliveryCost = deliveryResult.cost;

    // 4a. Промокод — серверная истина (P1-A4): скидка в рублях, free_delivery
    let discount = 0;
    let appliedPromoCode: string | null = null;
    let appliedPromoId: string | null = null;
    let promoFreeDelivery = false;
    const promoCodeInput = normalizePromoCodeInput(parsed.data.promoCode);
    if (promoCodeInput) {
      const promo = await validatePromoCode({
        code: promoCodeInput,
        userId: user.id,
        userRoles: (user.roles as string[]) || ["CUSTOMER"],
        orderAmount: subtotal,
        confectionerId,
      });
      if (!promo.valid) {
        return NextResponse.json(
          { error: promo.reason || "Промокод недействителен" },
          { status: 422 }
        );
      }
      discount = promo.discountRub || 0;
      appliedPromoCode = promoCodeInput;
      appliedPromoId = promo.promoCodeId || null;
      promoFreeDelivery = !!promo.freeDelivery;
      if (promoFreeDelivery) deliveryCost = 0;
    }

    const total = subtotal + deliveryCost - discount; // рубли

    // 5. Создаём order
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
        delivery_address: deliveryType === "delivery" ? (deliveryAddress || "").trim() : null,
        delivery_city: deliveryCity.trim(),
        delivery_date: deliveryDate,
        delivery_type: deliveryType,
        notes,
        payment_method: paymentMethod || "card",
        promo_code: appliedPromoCode,
        promo_discount: discount,
        metadata: {
          cart_items: cartItems.map((c) => c.id ?? c.product_id ?? "custom").slice(0, 50),
          idempotency_key: idempotencyKey ?? null,
          contact: { name, phone },
        },
      })
      .select()
      .single();

    if (orderError || !order) {
      console.error("[checkout] Order create error:", orderError?.message);
      return NextResponse.json({ error: "Ошибка создания заказа" }, { status: 500 });
    }

    // 5b. Создаём order_items
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

    // 5b-2. Уведомления «заказ создан» (ТЗ §10/§20): кондитеру + клиенту
    // (колокол, metadata.orderId → переход к заказу). Non-blocking, fail-safe.
    // ВАЖНО: confectionerId здесь — UUID пользователя кондитера
    // (products.confectioner_id → auth.users), шлём напрямую.
    try {
      const { sendNotification } = await import("@/lib/notifications");
      void sendNotification({
        userId: user.id,
        template: "ORDER_CREATED",
        vars: { orderNumber: order.number, total },
        metadata: { orderId: order.id },
      }).catch(() => {});
      if (confectionerId) {
        void sendNotification({
          userId: confectionerId,
          template: "NEW_MESSAGE",
          vars: {
            senderName: "Новый заказ",
            messagePreview: `Заказ #${order.number} на сумму ${total} ₽`,
          },
          metadata: { orderId: order.id },
        }).catch(() => {});
      }
    } catch (e) {
      console.warn("[checkout] new-order notification failed (non-blocking):", (e as Error).message);
    }

    // 5c. Промокод: привязка (promo_code/promo_discount уже в insert) + used_count
    if (appliedPromoCode) {
      try {
        await applyPromoCodeToOrder({
          code: appliedPromoCode,
          promoCodeId: appliedPromoId,
          orderId: order.id,
          discountRub: discount,
        });
      } catch (promoErr) {
        console.warn("[checkout] promo apply failed (non-blocking):", (promoErr as Error).message);
      }
    }

    // 6. Платёж через lib — детерминированный Idempotence-Key внутри lib
    let paymentUrl = `/checkout/success?orderId=${order.id}&demo=true`;
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

    // 7. Запись в payments (существующие колонки 0002) + проверка ошибки
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

    // 8. Корзину чистим только после успешного создания платежа
    //    (раньше корзина стиралась даже если платёж не создался)
    const cartItemIds = cartItems
      .map((c) => c.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (cartItemIds.length > 0) {
      const { error: cartClearError } = await supabaseAdmin
        .from("cart_items")
        .delete()
        .in("id", cartItemIds);

      if (cartClearError) {
        console.warn("[checkout] Cart clear error:", cartClearError.message);
      }
    }

    // 9. Уведомление через Edge Function
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
      subtotal,
      deliveryCost,
      discount,
      appliedPromoCode,
      isStub: !isYookassaConfigured(),
      items: orderItems.map((i) => ({
        title: i.product_title,
        quantity: i.quantity,
        unitPrice: i.unit_price,
        total: i.total,
        selectedAttributes: i.selected_attributes,
      })),
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

/**
 * Ответ на повторный запрос с тем же Idempotency-Key: СУЩЕСТВУЮЩИЙ заказ
 * (позиции + платёж из БД), без создания нового заказа/платежа.
 */
async function buildReplayResponse(existing: {
  id: string;
  number: string;
  total: number;
  subtotal: number | null;
  delivery_cost: number | null;
  discount: number | null;
}): Promise<Record<string, unknown>> {
  const [{ data: items }, { data: payments }] = await Promise.all([
    supabaseAdmin
      .from("order_items")
      .select("product_title, quantity, unit_price, total, selected_attributes")
      .eq("order_id", existing.id),
    supabaseAdmin
      .from("payments")
      .select("yookassa_payment_id, metadata")
      .eq("order_id", existing.id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const paymentRow = payments?.[0] || null;
  const storedUrl = (paymentRow?.metadata as { confirmation_url?: string } | null)
    ?.confirmation_url;
  const isStub = !paymentRow?.yookassa_payment_id;

  return {
    orderId: existing.id,
    orderNumber: existing.number,
    paymentUrl:
      storedUrl || `/checkout/success?orderId=${existing.id}${isStub ? "&demo=true" : ""}`,
    total: existing.total,
    subtotal: existing.subtotal ?? 0,
    deliveryCost: existing.delivery_cost ?? 0,
    discount: existing.discount ?? 0,
    isStub,
    idempotentReplay: true,
    items: (items || []).map((i) => ({
      title: i.product_title,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      total: i.total,
      selectedAttributes: i.selected_attributes,
    })),
  };
}
