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
 *      base = get_product_price_at(now) (0083; legacy-фолбэк version_id NULL →
 *      products.price) + валидированные модификаторы (fillings jsonb);
 *      custom-позиции конструктора — validateBuilderConfig + calculateBuilderPrice
 *      (ЕДИНАЯ формула с клиентом, src/lib/cake-builder-pricing.ts).
 *      Неизвестный модификатор → 422 (не молчаливое игнорирование).
 *      PR-2C: order_items.price_version_id + metadata.pricing (аудит привязки).
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
import { invokeInternalEdgeFunction } from "@/lib/supabase/edge-functions";
// Единый auth-контракт (Bearer + cookie cd_session): getSession() требовал
// GoTrue (/auth/v1 — 501-стаб в локальном runtime) и всегда отдавал 401.
import { getUserFromRequest } from "@/lib/auth";
import { calculateDelivery } from "@/lib/finance";
import { getPool } from "@/lib/postgrest/pool";
import {
  resolveCurrentPriceSafe,
  syncEffectiveProductPricesSafe,
} from "@/lib/price-version";
import { checkAcceptance } from "@/lib/ops/acceptance"; // P0.5 §29: capacity/inventory/deadline gate
import { createPayment, isYookassaConfigured } from "@/lib/yookassa";
import { enforceRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit";
import { loadConfectionerOrderSnapshot } from "@/lib/confectioner-tariff";
import { recordFinancialEntrySafe } from "@/lib/financial-ledger";
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
  type BuilderFillingOption,
  type CakeBuilderConfig,
} from "@/lib/cake-builder-pricing";
import { loadBuilderFillingsForValidation } from "@/lib/builder-fillings-server";
import { buildAcceptanceSnapshot, type AcceptanceSnapshot } from "@/lib/ops/snapshot";
// Z-v32 Этап 8 (PR-5): серверная фиксация согласованной цены индивидуального
// предложения (negotiations.valid_until 0085) — цена приходит ТОЛЬКО из БД.
import {
  applyNegotiationPriceBinding,
  buildOfferBindingMeta,
  validateNegotiationBinding,
  type NegotiationRecord,
  type OfferBindingMeta,
} from "@/lib/negotiation-binding";

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
    paymentMethod: z.enum(["yookassa", "card", "sbp"]).optional(),
    // Z-v32 (PR-5): опциональная привязка к принятым переговорам — цена
    // подменяется сервером из negotiations.quoted_price (в теле цены нет).
    negotiationId: z.string().uuid().optional(),
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
      negotiationId,
    } = parsed.data;

    // Z-v32 (PR-5): валидация binding переговоров ДО пересчёта позиций.
    // Владелец/статус/истечение — серверное решение (403/409/410); цена
    // из negotiations.quoted_price подставляется ниже в custom-позицию.
    let negotiationBinding: NegotiationRecord | null = null;
    if (negotiationId) {
      // ZV33-4b D1: order_id в селекте — гвард «один заказ на предложение»
      // (повторный checkout с новым Idempotency-Key → 409, ДО создания заказа).
      const { data: negRow } = await supabaseAdmin
        .from("negotiations")
        .select("id, user_id, status, quoted_price, quoted_delivery_cost, valid_until, order_id")
        .eq("id", negotiationId)
        .maybeSingle();
      if (!negRow) {
        return NextResponse.json(
          { error: "Переговоры не найдены" },
          { status: 404 }
        );
      }
      const decision = validateNegotiationBinding(
        negRow as unknown as NegotiationRecord,
        user.id
      );
      if (!decision.ok) {
        return NextResponse.json(
          {
            error: decision.code,
            message: decision.message,
            ...(decision.expiredAt ? { expiredAt: decision.expiredAt } : {}),
          },
          { status: decision.httpStatus }
        );
      }
      negotiationBinding = decision.negotiation;
    }

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

    // Индивидуальный торт из конструктора оформляется отдельным согласованным
    // заказом, а не смешивается с товарами конкретного кондитера.
    if (productItems.length > 0 && customItems.length > 0) {
      return NextResponse.json(
        { error: "Заказ из конструктора оформляется отдельно от товаров витрины.", code: "MIXED_CUSTOM_AND_MARKETPLACE_ITEMS" },
        { status: 422 }
      );
    }

    // В production не обещаем изготовление без проверенной производственной
    // спецификации. Для нестандартной позиции используется согласование с кондитером.
    if (process.env.NODE_ENV === "production") {
      const unsupportedProductionItems = cartItems.filter((item) =>
        Boolean(item.custom) ||
        Object.entries(item.selected_attributes ?? {}).some(
          ([key, value]) => key !== "inscription" && typeof value === "string" && value.trim().length > 0
        )
      );
      if (unsupportedProductionItems.length > 0) {
        return NextResponse.json(
          {
            error: "Некоторые позиции требуют производственной спецификации",
            message: "Оплачиваемый заказ пока доступен для товаров с настроенным рецептом без изменений состава, размера, начинки, покрытия и декора. Для индивидуального торта отправьте запрос на согласование с кондитером.",
            code: "PRODUCTION_SPEC_REQUIRED",
          },
          { status: 422 }
        );
      }
    }

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
      // Один оплачиваемый заказ — один производственный исполнитель.
      // Иначе назначение, себестоимость и выплаты становятся неоднозначными.
      const sellerIds = new Set(products.map((p) => p.confectioner_id).filter((id): id is string => Boolean(id)));
      const hasUnassignedProduct = products.some((p) => !p.confectioner_id);
      if (sellerIds.size > 1 || (sellerIds.size === 1 && hasUnassignedProduct)) {
        return NextResponse.json(
          { error: "В одной оплате могут быть товары только одного кондитера. Разделите корзину на отдельные заказы.", code: "MULTIPLE_CONFECTIONERS" },
          { status: 422 }
        );
      }
      for (const p of products) productsMap.set(p.id, p);
    }

    // 3a. Начинки конструктора: DB (APPROVED + is_active) + mock — ЕДИНЫЙ справочник
    // с /api/cart (loadBuilderFillingsForValidation). Fail-closed: ошибка БД → 503,
    // молчаливого даунгрейда до mock нет — иначе cart↔checkout расходятся (cart
    // отклонит начинку, checkout примет, или наоборот). Лениво: только когда
    // в запросе есть custom-позиции.
    let builderFillings: BuilderFillingOption[] = [];
    if (customItems.length > 0) {
      try {
        builderFillings = await loadBuilderFillingsForValidation(supabaseAdmin);
      } catch (e) {
        console.error("[checkout] fillings catalog unavailable:", (e as Error).message);
        return NextResponse.json(
          { error: "Каталог начинок временно недоступен, попробуйте позже" },
          { status: 503 }
        );
      }
    }

    // 3b. Серверный пересчёт позиций (НЕ доверяем клиентской цене)
    // PR-2C: перед резолвом цен — ленивый catch-up эффективных цен
    // (best-effort: сбой синка НЕ валид checkout, резолв ниже работает по факту).
    await syncEffectiveProductPricesSafe(getPool());

    interface ComputedItem {
      product_id: string | null;
      product_title: string;
      unit_price: number;
      quantity: number;
      selected_attributes: Record<string, unknown> | null;
      total: number;
      price_version_id: string | null; // PR-2C: привязка к версии цены (custom → NULL)
    }
    const orderItems: ComputedItem[] = [];

    // PR-2C: кэш резолва цены на товар (одна позиция может повторяться в корзине)
    const priceVersionCache = new Map<string, Awaited<ReturnType<typeof resolveCurrentPriceSafe>>>();

    for (const item of productItems) {
      const product = productsMap.get(item.product_id);
      if (!product) throw new Error(`Product ${item.product_id} not found`);

      const attrs: Record<string, unknown> = {};
      // PR-2C: базовая цена — покрывающая now версия истории цен (0083).
      // Legacy-фолбэк (version_id NULL) или ошибка БД → products.price как раньше.
      if (!priceVersionCache.has(product.id)) {
        priceVersionCache.set(product.id, await resolveCurrentPriceSafe(getPool(), product.id));
      }
      const resolvedPrice = priceVersionCache.get(product.id) ?? null;
      let unitPrice = resolvedPrice ? resolvedPrice.amount : product.price; // рубли (НЕ копейки — см. seed/формат витрины)
      let priceVersionId: string | null = resolvedPrice ? resolvedPrice.versionId : null;

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
        price_version_id: priceVersionId,
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
        price_version_id: null, // custom-позиция конструктора — версии цены нет
      });
    }

    // Z-v32 (PR-5): фиксация согласованной цены — оверрайд единственной
    // custom-позиции серверным quoted_price (копейки -> рубли). Ноль/несколько
    // custom-позиций -> 422 (честный отказ, см. applyNegotiationPriceBinding).
    // ДО reduce subtotal: оверрайд меняет total позиции.
    let offerBindingMeta: OfferBindingMeta | null = null;
    if (negotiationBinding) {
      const applied = applyNegotiationPriceBinding(orderItems, negotiationBinding);
      if (!applied.ok) {
        return NextResponse.json(
          { error: applied.code, message: applied.message },
          { status: applied.httpStatus }
        );
      }
      const bound = orderItems[applied.boundItemIndex];
      bound.unit_price = applied.quotedPriceRub;
      bound.total = applied.quotedPriceRub * bound.quantity;

      // Якорь binding — revision-снимок, записанный в момент accept
      // (change_reason='accepted'); для legacy-принятий без снимка — null.
      const { data: acceptedRevision } = await supabaseAdmin
        .from("negotiation_revisions")
        .select("id")
        .eq("negotiation_id", negotiationBinding.id)
        .eq("change_reason", "accepted")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      offerBindingMeta = buildOfferBindingMeta({
        negotiation: negotiationBinding,
        quotedPriceRub: applied.quotedPriceRub,
        revisionId: (acceptedRevision as { id: string } | null)?.id ?? null,
        boundAt: new Date(),
      });
    }

    const subtotal = orderItems.reduce((sum, item) => sum + item.total, 0);

    // Confectioner_id — из первого ТОВАРНОГО товара (custom-позиции без кондитера)
    const confectionerId =
      (productItems.length > 0
        ? productsMap.get(productItems[0].product_id)?.confectioner_id ?? null
        : null) ?? null;

    // 3a-1. Тарифная/комиссионная/legal снапшоты кондитера (ЕДИНЫЙ хелпер с
    // POST /api/orders): ищем confectioners по "userId" (auth.users UUID) и
    // только approved; иначе payout-math падает в дефолт вместо тарифа.
    const snapshot = await loadConfectionerOrderSnapshot(confectionerId);

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
        console.error(
          "[checkout] acceptance check failed:",
          accErr instanceof Error ? accErr.message : accErr
        );
        if (process.env.NODE_ENV === "production") {
          return NextResponse.json(
            { error: "Не удалось проверить возможность изготовления заказа. Повторите попытку позже.", code: "ACCEPTANCE_UNAVAILABLE" },
            { status: 503 }
          );
        }
      }
    }

    // P1.1 §2: production — только реальный платёжный провайдер. Раньше
    // заказ создавался с demo-URL «оплатить позже» при любом NODE_ENV,
    // а /api/payment/create в production отдавал 503 — заказ повисал
    // неоплачиваемым. Теперь незавершённая payment-конфигурация в
    // production — безопасная ошибка конфигурации ДО создания заказа;
    // dev/test сохраняют stub-поток.
    if (!isYookassaConfigured() && process.env.NODE_ENV === "production") {
      console.error(
        "[checkout] payment gateway not configured in production — refusing to create order (safe config error)"
      );
      return NextResponse.json(
        { error: "Платёжный шлюз не настроен (ошибка конфигурации сервера)" },
        { status: 503 }
      );
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

    // PR-2C: аудит привязки цен (metadata.pricing; existing-ключи metadata не трогаем —
    // объект собирается ниже одним литералом, pricing добавляется отдельным ключом).
    const pricingMeta = {
      resolvedAt: new Date().toISOString(),
      currency: "RUB" as const,
      items: orderItems.map((i) => ({
        productId: i.product_id,
        priceVersionId: i.price_version_id,
        unitPrice: i.unit_price,
      })),
      deliverySource: "server" as const,
    };

    // 4b. Z-v29: НЕИЗМЕНЯЕМЫЙ snapshot производственной потребности.
    // Собирается сервером из БД в момент фиксации заказа и попадает В ТОТ ЖЕ
    // INSERT orders (metadata.acceptance_snapshot) — запись атомарна с заказом.
    // Клиент не может передать/подменить состав (в теле запроса поля нет).
    // Правка рецепта после этой точки больше НЕ меняет разбор/приёмку заказа.
    // Fail-closed: ошибка сборки → 503 ДО создания заказа (недопустима оплата
    // без производственного снимка — ТЗ Z-v29 §5).
    let acceptanceSnapshot: AcceptanceSnapshot | null = null;
    if (productItems.length > 0) {
      const built = await buildAcceptanceSnapshot({
        items: productItems.map((c) => ({
          product_id: c.product_id,
          quantity: c.quantity,
        })),
        source: "checkout",
      });
      if (!built.ok) {
        console.error("[checkout] acceptance snapshot build failed:", built.error);
        return NextResponse.json(
          { error: "Не удалось зафиксировать производственный состав заказа, попробуйте позже" },
          { status: 503 }
        );
      }
      acceptanceSnapshot = built.snapshot;
    }

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
        tariff_snapshot: snapshot.tariffSnapshot,
        commission_rate_snapshot: snapshot.commissionRateSnapshot,
        legal_status_snapshot: snapshot.legalStatusSnapshot,
        metadata: {
          cart_items: cartItems.map((c) => c.id ?? c.product_id ?? "custom").slice(0, 50),
          idempotency_key: idempotencyKey ?? null,
          contact: { name, phone },
          // PR-2C: аудит привязки цен (версии цены + серверная доставка)
          pricing: pricingMeta,
          // Z-v32 (PR-5): аудит согласования индивидуальной цены
          // (аддитивный ключ; negotiationId/revisionId/quotedPrice/validUntil)
          ...(offerBindingMeta ? { offerBinding: offerBindingMeta } : {}),
          // Z-v29: снимок производственной потребности на момент оформления
          // (неизменяем после INSERT — ни один код-путь не обновляет orders.metadata).
          ...(acceptanceSnapshot ? { acceptance_snapshot: acceptanceSnapshot } : {}),
        },
      })
      .select()
      .single();

    if (orderError || !order) {
      // P1.1 §8: гонка двух параллельных POST с одним Idempotency-Key —
      // select-before-insert оба промахиваются, уникальный индекс 0060
      // (user_id, metadata->>'idempotency_key') даёт 23505 победителю-
      // проигравшему → возвращаем СУЩЕСТВУЮЩИЙ заказ (replay), не два.
      // (JSON-arrow фильтры в локальном PostgREST-шим не поддерживаются —
      // ключ сопоставляем в JS по свежим заказам пользователя.)
      const pgCode = (orderError as { code?: string } | null)?.code;
      if (pgCode === "23505" && idempotencyKey) {
        const hourAgoIso = new Date(Date.now() - 60 * 60_000).toISOString();
        const { data: recent } = await supabaseAdmin
          .from("orders")
          .select("id, number, total, subtotal, delivery_cost, discount, metadata")
          .eq("user_id", user.id)
          .gte("created_at", hourAgoIso)
          .order("created_at", { ascending: false })
          .limit(20);
        const existing = (recent as Array<{ id: string; number: string; total: number; subtotal: number | null; delivery_cost: number | null; discount: number | null; metadata: Record<string, unknown> | null }> | null)?.find(
          (o) => o.metadata && (o.metadata as Record<string, unknown>).idempotency_key === idempotencyKey
        );
        if (existing) {
          console.info("[checkout] idempotency race resolved via unique index (0060)");
          return NextResponse.json(await buildReplayResponse(existing));
        }
      }
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

    // Z-v32 (PR-5): связываем переговоры с заказом (negotiations.order_id —
    // колонка 0004). Best-effort: сбой не валид заказ, идёт в лог.
    // ZV33-4b D1: обновление УСЛОВНОЕ (только когда order_id ещё пуст) —
    // параллельный/повторный checkout не может перезаписать чужую привязку
    // (last-write-wins невозможен; первая связка выигрывает).
    if (negotiationBinding) {
      const { error: negLinkErr } = await supabaseAdmin
        .from("negotiations")
        .update({ order_id: order.id })
        .eq("id", negotiationBinding.id)
        .is("order_id", null);
      if (negLinkErr) {
        console.error(
          "[checkout] negotiation order_id link failed:",
          negLinkErr.message
        );
      }
    }

    // 5b-1. order.created — event log (P1.1 §3: dedup key, idempotent) + n8n.
    // Раньше витринный путь НЕ писал order.created в domain_events (дыра в
    // ops-логе/timeline: B2B-путь /api/orders писал, checkout — нет).
    try {
      const { recordEvent } = await import("@/lib/ops/events");
      void recordEvent("order.created", {
        entityType: "order",
        entityId: order.id,
        actorId: user.id,
        dedupKey: `order-created:${order.id}`,
        payload: { number: order.number, total, source: "checkout" },
      });
      const { emitEvent } = await import("@/lib/n8n");
      void emitEvent("order.created", {
        orderId: order.id,
        orderNumber: order.number,
        total,
      }).catch(() => {});
    } catch (e) {
      console.warn("[checkout] order.created event failed (non-blocking):", (e as Error).message);
    }

    // 5b-2. Уведомления «заказ создан» (ТЗ §10/§20): кондитеру + клиенту
    // (колокол, metadata.orderId → переход к заказу). Non-blocking, fail-safe.
    // ВАЖНО: confectionerId здесь — UUID пользователя кондитера
    // (products.confectioner_id → auth.users), шлём напрямую.
    // P1.1: dedupKey — повторная обработка не создаёт второй notification.
    try {
      const { sendNotification } = await import("@/lib/notifications");
      void sendNotification({
        userId: user.id,
        template: "ORDER_CREATED",
        vars: { orderNumber: order.number, total },
        metadata: { orderId: order.id },
        dedupKey: `order-created:${order.id}`,
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
          dedupKey: `order-created-cf:${order.id}`,
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
          userId: user.id, // Этап 10 §C1: журнал promo_code_usages
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

    // 7. Запись в payments (существующие колонки 0002) + проверка ошибки.
    // PAY-2: забираем id записи — нужен для журнала financial_ledger.
    const { data: paymentRow, error: paymentError } = await supabaseAdmin
      .from("payments")
      .insert({
        order_id: order.id,
        yookassa_payment_id: yookassaPaymentId,
        amount: total, // рубли
        currency: "RUB",
        status: "pending",
        method: "yookassa",
        metadata: { confirmation_url: paymentUrl },
      })
      .select("id")
      .single();

    if (paymentError) {
      // Не выдаём confirmation URL без локальной записи платежа: webhook
      // должен сверить сумму и конкретную попытку оплаты до подтверждения.
      console.error("[checkout] Payment ledger insert failed:", paymentError.message);
      return NextResponse.json(
        { error: "Не удалось зафиксировать платёж. Повторите попытку оплаты.", code: "PAYMENT_LEDGER_UNAVAILABLE" },
        { status: 503 }
      );
    } else {
      // PAY-2: журнал — платёж создан (lifecycle-запись, amount 0 — деньги
      // ещё не двигались; финальное +amount напишет webhook payment.succeeded)
      void recordFinancialEntrySafe({
        entryType: "payment_created",
        amount: 0,
        paymentId: paymentRow?.id ?? null,
        orderId: order.id,
        actorId: user.id,
        idempotencyKey: `pay-created:${yookassaPaymentId ?? paymentRow?.id ?? order.id}`,
        metadata: {
          provider: isYookassaConfigured() ? "yookassa" : "stub",
          mode: process.env.NODE_ENV,
          total,
        },
      });
    }

    // 8. Корзину чистим только после успешного создания платежа
    //    (раньше корзина стиралась даже если платёж не создался).
    //    P1 «серверная корзина»: id от клиента — это client_ref позиции
    //    (itemId Zustand-корзины), НЕ uuid cart_items. Удаление строго
    //    в владении пользователя: .eq("user_id", user.id) — иначе admin-клиент
    //    (RLS bypass) мог бы удалить ЧУЖИЕ строки по перебору uuid.
    const cartItemIds = cartItems
      .map((c) => c.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (cartItemIds.length > 0) {
      const { error: cartClearError } = await supabaseAdmin
        .from("cart_items")
        .delete()
        .in("client_ref", cartItemIds)
        .eq("user_id", user.id);

      if (cartClearError) {
        console.warn("[checkout] Cart clear error:", cartClearError.message);
      }
    }

    // 9. Уведомление через внутренний Edge Function route (service_role через Kong).
    try {
      await invokeInternalEdgeFunction("send-notification", {
        type: "order_created",
        orderId: order.number,
        amount: total, // рубли
        customer: user.email,
      });
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
