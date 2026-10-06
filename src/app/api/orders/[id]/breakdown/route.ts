/**
 * GET /api/orders/[id]/breakdown — «разбор заказа» (Task 2-b).
 *
 * Считает потребность в ингредиентах по позициям заказа и сопоставляет
 * со складом владельца заказа. Расчёт — в src/lib/ops/breakdown.ts (общий
 * с POST /api/orders/[id]/purchase-draft).
 *
 * Права:
 *   • владелец заказа (orders.confectioner_id === user.id);
 *   • ADMIN | SUPER_ADMIN (hasAnyRole, БД-гейт).
 * Ошибки: 401 не авторизован, 403 не владелец/не админ, 404 заказ не найден.
 *
 * Ответ:
 * {
 *   order: { id, number, status, delivery_date, delivery_time_window, confectioner_id },
 *   items: [{ product_id, title, quantity, recipe_id }],
 *   ingredients: [{ name, unit, required, stock, shortage,
 *                   status: "ok"|"shortage"|"no_stock"|"unit_mismatch",
 *                   inventory_item_id, estimated_cost, ...warehouse_* }],
 *   shortages: [...],        // только shortage>0 или no_stock
 *   can_produce: boolean,    // все ингредиенты в статусе "ok"
 *   total_shortage_cost: number
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { hasAnyRole } from "@/lib/role-guards";
import { computeOrderBreakdown } from "@/lib/ops/breakdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
        { status: 401 }
      );
    }

    const breakdown = await computeOrderBreakdown(id);
    if (!breakdown) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Заказ не найден" },
        { status: 404 }
      );
    }

    const isOwner =
      breakdown.order.confectioner_id !== null &&
      breakdown.order.confectioner_id === user.id;
    if (!isOwner) {
      const isAdmin = await hasAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
      if (!isAdmin) {
        return NextResponse.json(
          { error: "FORBIDDEN", message: "Нет доступа к заказу" },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(breakdown);
  } catch (err) {
    console.error(
      "[orders/breakdown] GET failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
