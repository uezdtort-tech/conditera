/**
 * POST /api/orders/[id]/repeat — Повторить заказ (ТЗ §13).
 *
 * НОВЫЙ контракт (P1): заказ НЕ создаётся молча. Сервер возвращает
 * позиции с АКТУАЛЬНЫМИ ценами и доступностью — клиент видит корзину.
 *
 *   Ответ: {
 *     orderNumber: string,
 *     currency: "RUB",
 *     items: [{
 *       productId, title, image, quantity,
 *       unitPrice,        // актуальная серверная цена
 *       oldPrice,         // цена из order_items (snapshot)
 *       available: boolean,
 *       unavailableReason?: string,
 *     }],
 *   }
 *
 * Проверки на позицию: product существует + status='published' +
 * is_available (0052). Quantity берётся из старого заказа.
 *
 * Auth: владелец заказа или ADMIN/SUPER_ADMIN.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";

export const runtime = "nodejs";

interface RepeatOrderItem {
  product_id: string | null;
  product_title: string | null;
  product_image: string | null;
  image: string | null;
  unit_price: number | null;
  price: number | null;
  quantity: number | null;
}

interface RepeatOrderRow {
  id: string;
  number: string | null;
  user_id: string;
  items: RepeatOrderItem[];
}

interface ProductRow {
  id: string;
  title: string;
  price: number;
  images: string[] | null;
  status: string | null;
  is_available: boolean | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: orderId } = await params;
    // Единый auth-контракт (Bearer app-JWT), как в /api/orders и /cancel —
    // getCurrentUser (Supabase cookie) не видит app-JWT и ломал mobile/API-клиентов
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    // Оригинальный заказ + позиции (оба набора snapshot-колонок: 0002/0040)
    const { data: original, error: loadErr } = await supabaseAdmin
      .from("orders")
      .select(
        `
        id, number, user_id,
        items:order_items(product_id, product_title, product_image, image, unit_price, price, quantity)
      `
      )
      .eq("id", orderId)
      .maybeSingle() as { data: RepeatOrderRow | null; error: { message: string } | null };

    if (loadErr) {
      console.error("[orders/repeat] load:", loadErr.message);
      return NextResponse.json({ error: "Не удалось загрузить заказ" }, { status: 500 });
    }
    if (!original) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    const admin = await isAdmin(user.userId);
    if (original.user_id !== user.userId && !admin) {
      return NextResponse.json({ error: "Нет прав" }, { status: 403 });
    }

    const oldItems = (original.items || []).filter(
      (i) => i.product_id // custom-позиции без product не повторяются
    );

    if (oldItems.length === 0) {
      return NextResponse.json(
        {
          orderNumber: original.number || "",
          currency: "RUB",
          items: [],
          message: "В заказе нет позиций, которые можно повторить",
        },
        { status: 422 }
      );
    }

    // Актуальные данные товаров одним запросом
    const productIds = [...new Set(oldItems.map((i) => i.product_id as string))];
    const { data: products, error: prodErr } = await supabaseAdmin
      .from("products")
      .select("id, title, price, images, status, is_available")
      .in("id", productIds) as { data: ProductRow[] | null; error: { message: string } | null };

    if (prodErr) {
      console.error("[orders/repeat] products:", prodErr.message);
      return NextResponse.json({ error: "Не удалось загрузить товары" }, { status: 500 });
    }

    const productMap = new Map((products || []).map((p) => [p.id, p]));

    const items = oldItems.map((item) => {
      const product = productMap.get(item.product_id as string);
      const quantity = Math.max(1, Number(item.quantity) || 1);
      const oldPrice = Number(item.price) > 0 ? Number(item.price) : Number(item.unit_price) || 0;
      const image = item.image || item.product_image || product?.images?.[0] || "";

      if (!product) {
        return {
          productId: item.product_id as string,
          title: item.product_title || "Товар",
          image,
          quantity,
          unitPrice: oldPrice,
          oldPrice,
          available: false,
          unavailableReason: "Товар удалён из каталога",
        };
      }
      if ((product.status || "") !== "published") {
        return {
          productId: product.id,
          title: product.title,
          image,
          quantity,
          unitPrice: product.price,
          oldPrice,
          available: false,
          unavailableReason: "Товар скрыт кондитером",
        };
      }
      if (product.is_available === false) {
        return {
          productId: product.id,
          title: product.title,
          image,
          quantity,
          unitPrice: product.price,
          oldPrice,
          available: false,
          unavailableReason: "Товар недоступен для заказа",
        };
      }

      return {
        productId: product.id,
        title: product.title,
        image,
        quantity,
        unitPrice: Number(product.price) || oldPrice,
        oldPrice,
        available: true,
      };
    });

    return NextResponse.json({
      orderNumber: original.number || "",
      currency: "RUB",
      items,
    });
  } catch (error) {
    console.error("[orders/repeat] POST failed:", (error as Error)?.message);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
