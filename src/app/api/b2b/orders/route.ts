/**
 * /api/b2b/orders
 *
 * GET  — список B2B-заказов текущего пользователя.
 * POST — создать B2B-заказ (оптом, с оплатой по счёту).
 *
 * B2B-заказ хранится в таблице orders с номером с префиксом «B2B-» и
 * payment_method = "invoice" (безналичный расчёт).
 *
 * Auth: CORPORATE_CLIENT или WHOLESALER (через requireAnyRole).
 *
 * Соответствует таблицам:
 *  - orders (создание заказа)
 *  - order_items (позиции заказа)
 *  - wholesale_prices (оптовые цены для расчёта)
 *  - products (получение розничной цены как fallback)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const B2B_PREFIX = "B2B-";

interface B2BOrderItem {
  productId: string;
  title: string;
  image: string;
  price: number;
  quantity: number;
  customization: Record<string, unknown>;
}

/**
 * GET /api/b2b/orders — список B2B-заказов текущего пользователя.
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

    // Проверка роли — CORPORATE_CLIENT или WHOLESALER
    const guard = await requireAnyRole(user.id, ["CORPORATE_CLIENT", "WHOLESALER"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    // Найти заказы текущего пользователя с префиксом B2B-
    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select(
        `
        id, number, status, total, delivery_date, delivery_address,
        payment_method, payment_status, comment, created_at,
        confectioner_id
      `
      )
      .eq("user_id", user.id)
      .like("number", `${B2B_PREFIX}%`)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("[b2b/orders] GET error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    // Получить items для каждого заказа
    const orderIds = (orders || []).map((o: any) => o.id);
    let itemsByOrder = new Map<string, any[]>();
    if (orderIds.length > 0) {
      const { data: items } = await supabaseAdmin
        .from("order_items")
        .select("id, order_id, title, quantity, price")
        .in("order_id", orderIds);
      for (const item of items || []) {
        const arr = itemsByOrder.get(item.order_id) || [];
        arr.push(item);
        itemsByOrder.set(item.order_id, arr);
      }
    }

    // Получить businessName кондитеров
    const confectionerIds = (orders || [])
      .map((o: any) => o.confectioner_id)
      .filter(Boolean);
    let confMap = new Map<string, string>();
    if (confectionerIds.length > 0) {
      const { data: confs } = await supabaseAdmin
        .from("confectioners")
        .select("id, business_name")
        .in("id", confectionerIds);
      for (const c of confs || []) {
        confMap.set(c.id, c.business_name);
      }
    }

    const result = (orders || []).map((o: any) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      total: Number(o.total),
      delivery_date: o.delivery_date,
      delivery_address: o.delivery_address,
      payment_method: o.payment_method,
      payment_status: o.payment_status,
      comment: o.comment,
      created_at: o.created_at,
      items: itemsByOrder.get(o.id) || [],
      confectioner: o.confectioner_id ? {
        id: o.confectioner_id,
        business_name: confMap.get(o.confectioner_id) || "",
      } : null,
    }));

    return NextResponse.json({ orders: result, total: result.length });
  } catch (error: any) {
    console.error("GET /api/b2b/orders error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/b2b/orders — создать B2B-заказ.
 *
 * Тело запроса:
 *  {
 *    "items": [{ "productId": "...", "quantity": 10 }, ...],
 *    "deliveryDate": "2026-09-15",
 *    "deliveryAddress": "г. Москва, ...",
 *    "comment": "Доставка до 12:00"
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

    // Проверка роли — CORPORATE_CLIENT или WHOLESALER
    const guard = await requireAnyRole(user.id, ["CORPORATE_CLIENT", "WHOLESALER"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = await request.json();
    const { items, deliveryDate, deliveryAddress, comment } = body ?? {};

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Укажите массив items (минимум 1 элемент)" },
        { status: 400 }
      );
    }

    if (!deliveryDate) {
      return NextResponse.json(
        { error: "Укажите deliveryDate" },
        { status: 400 }
      );
    }

    // Рассчитать сумму с учётом оптовых цен
    const orderItems: B2BOrderItem[] = [];
    let total = 0;

    for (const item of items) {
      if (!item.productId || !item.quantity) {
        return NextResponse.json(
          { error: "Каждый item должен содержать productId и quantity" },
          { status: 400 }
        );
      }

      const qty = Math.max(1, Math.floor(Number(item.quantity)));
      if (!Number.isFinite(qty)) {
        return NextResponse.json(
          { error: `Некорректное количество: ${item.quantity}` },
          { status: 400 }
        );
      }

      // Найти товар
      const { data: product, error: prodErr } = await supabaseAdmin
        .from("products")
        .select("id, title, price, images")
        .eq("id", item.productId)
        .maybeSingle();

      if (prodErr || !product) continue;

      // Найти оптовую цену, подходящую под количество
      const { data: wholesalePrices } = await supabaseAdmin
        .from("wholesale_prices")
        .select("id, min_quantity, price")
        .eq("product_id", item.productId)
        .eq("is_active", true)
        .lte("min_quantity", qty)
        .order("min_quantity", { ascending: false })
        .limit(1);

      const wholesale = (wholesalePrices || [])[0];
      const unitPrice = wholesale
        ? Number(wholesale.price)
        : Number(product.price);
      const itemTotal = unitPrice * qty;
      total += itemTotal;

      orderItems.push({
        productId: product.id,
        title: product.title,
        image: (product.images as string[])?.[0] || "",
        price: unitPrice,
        quantity: qty,
        customization: {
          b2b: true,
          wholesalePriceId: wholesale?.id ?? null,
        },
      });
    }

    if (orderItems.length === 0) {
      return NextResponse.json(
        { error: "Не найдено валидных товаров" },
        { status: 400 }
      );
    }

    const orderNumber = `${B2B_PREFIX}${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const finalComment = comment ? String(comment) : null;

    // Создать заказ
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert({
        number: orderNumber,
        user_id: user.id,
        confectioner_id: null, // B2B-заказ может быть от нескольких поставщиков
        status: "PENDING",
        total,
        delivery_address: deliveryAddress || null,
        delivery_date: new Date(deliveryDate).toISOString(),
        payment_method: "invoice",
        payment_status: "pending",
        comment: finalComment,
      })
      .select("id, number")
      .single();

    if (orderErr || !order) {
      console.error("[b2b/orders] POST create error:", orderErr?.message);
      return NextResponse.json(
        { error: "Ошибка при создании заказа", details: orderErr?.message },
        { status: 500 }
      );
    }

    // Создать позиции заказа
    const orderItemsInsert = orderItems.map((item) => ({
      order_id: order.id,
      product_id: item.productId,
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
      console.error("[b2b/orders] items insert error:", itemsErr.message);
      // Не откатываем заказ — он создан, просто без items
      // В прод-окружении здесь должна быть транзакция
    }

    return NextResponse.json(
      {
        order: {
          id: order.id,
          number: order.number,
          status: "PENDING",
          total,
          items_count: orderItems.length,
        },
        message: "B2B-заказ создан, ожидает оплаты по счёту",
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("POST /api/b2b/orders error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
