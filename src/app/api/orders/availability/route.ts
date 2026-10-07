/**
 * POST /api/orders/availability — customer-facing проверка выполнимости
 * ДО оформления заказа (ТЗ §29, §30, §40).
 *
 * Body: { items: [{ productId, quantity }], deliveryDate, deliveryTimeWindow?, deliveryTime? }
 *
 * Ответ: availability: available | available_with_warning | unavailable
 *        + причины/подсказки/альтернативные окна
 *        («На выбранное время заказ выполнить не получится. Ближайшее
 *          доступное время — 18:30»).
 *
 * Права: любой аутентифицированный пользователь (checkout/конструктор).
 * Пишет nothing в БД (read-only) — кроме события acceptance_rejected (fail-safe).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { loadProductItemsData, checkAcceptance } from "@/lib/ops/acceptance";
import { recordEvent } from "@/lib/ops/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AvailabilityItem {
  productId?: string;
  quantity?: number;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
        { status: 401 }
      );
    }

    let body: {
      items?: AvailabilityItem[];
      deliveryDate?: string;
      deliveryTimeWindow?: string;
      deliveryTime?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Ожидается JSON" },
        { status: 400 }
      );
    }

    const rawItems = (body.items ?? []).filter(
      (i) => typeof i.productId === "string" && i.productId.length > 0
    );
    if (rawItems.length === 0) {
      return NextResponse.json(
        { error: "NO_ITEMS", message: "Не переданы товары" },
        { status: 400 }
      );
    }
    if (rawItems.length > 50) {
      return NextResponse.json(
        { error: "TOO_MANY_ITEMS", message: "Максимум 50 позиций" },
        { status: 400 }
      );
    }

    const deliveryDate = typeof body.deliveryDate === "string" && body.deliveryDate.trim() ? body.deliveryDate.trim() : null;
    if (deliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
      return NextResponse.json(
        { error: "BAD_DATE", message: "deliveryDate ожидается в формате YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const items = await loadProductItemsData(
      rawItems.map((i) => ({
        productId: i.productId as string,
        quantity: Math.max(1, Math.min(Number(i.quantity ?? 1) || 1, 999)),
      }))
    );

    const result = await checkAcceptance({
      items,
      deliveryDate,
      deliveryTimeWindow: body.deliveryTimeWindow ?? null,
      deliveryTime: body.deliveryTime ?? null,
    });

    return NextResponse.json({
      availability: result.availability,
      canAccept: result.canAccept,
      risk: result.risk,
      reasons: result.reasons,
      suggestions: result.suggestions,
      alternativeWindows: result.alternativeWindows,
      owners: result.owners.map((o) => ({
        confectionerId: o.confectionerId,
        confectionerName: o.confectionerName,
        items: o.items,
        productionMinutes: o.productionMinutes,
        estimateApproximate: o.estimateApproximate,
        inventory: { canProduce: o.inventory.canProduce, shortageCount: o.inventory.shortageCount },
        capacity: {
          checked: o.capacity.checked,
          fits: o.capacity.fits,
          utilizationPercent: o.capacity.utilizationPercent,
          window: o.capacity.window,
        },
        deadline: o.deadline,
      })),
    });
  } catch (err) {
    console.error(
      "[orders/availability] POST failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
