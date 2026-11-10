/**
 * POST /api/orders/:id/accept — кондитер принимает заказ.
 *
 * Проверки: CONFECTIONER, verified, заказ принадлежит кондитеру, статус PENDING.
 * После: status → CONFIRMED, уведомление покупателю.
 *
 * Auth: CONFECTIONER
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import { checkOrderAcceptance } from "@/lib/ops/acceptance";
import { handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams { params: Promise<{ id: string }>; }

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: orderId } = await params;
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireRole(user.id, "CONFECTIONER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    // Check confectioner is verified
    const { data: conf } = await supabaseAdmin
      .from("confectioners")
      .select("id, verificationStatus")
      .eq("userId", user.id)
      .maybeSingle();

    if (!conf) return NextResponse.json({ error: "Профиль кондитера не найден" }, { status: 404 });
    if (conf.verificationStatus !== "approved") {
      return NextResponse.json({ error: "Профиль не подтверждён админом" }, { status: 403 });
    }

    // Get order
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, number, status, confectioner_id, user_id")
      .eq("id", orderId)
      .maybeSingle();

    if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    // orders.confectioner_id — UUID пользователя (products.confectioner_id →
    // auth.users), а НЕ confectioners.id (cuid). Сравнение с conf.id было
    // ошибкой — ни один кондитер не мог принять заказ (всегда 403).
    if (order.confectioner_id !== user.id) {
      return NextResponse.json({ error: "Заказ назначен другому кондитеру" }, { status: 403 });
    }
    if (order.status !== "PENDING") {
      return NextResponse.json({ error: `Заказ уже ${order.status}` }, { status: 400 });
    }

    // === Acceptance Engine (ТЗ §8/§40) — гейт принятия =====================
    // Сценарии A/D приёмки (Z-v12): при нехватке ингредиентов (canProduce=false)
    // и при позиции без рецепта (RECIPE_MISSING) заказ НЕ должен молча переходить
    // в CONFIRMED (состояние «принято к производству»); пользователь получает
    // список причин и нехватающих ингредиентов. Склад не изменяется (accept не
    // списывает — списание отдельный идемпотентный write-off в PREPARING).
    let feasibility: Awaited<ReturnType<typeof checkOrderAcceptance>>;
    try {
      feasibility = await checkOrderAcceptance(orderId);
    } catch (err) {
      console.error("[orders/:id/accept] acceptance check failed:", err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: "FEASIBILITY_CHECK_FAILED", message: "Проверка выполнимости недоступна — принятие отклонено (fail-closed)." },
        { status: 503 }
      );
    }
    if (!feasibility) {
      return NextResponse.json(
        { error: "FEASIBILITY_CHECK_FAILED", message: "Не удалось проверить выполнимость заказа." },
        { status: 503 }
      );
    }
    const inventoryBlocked = feasibility.owners.some((o) => !o.inventory.canProduce);
    if (!feasibility.canAccept || inventoryBlocked) {
      return NextResponse.json(
        {
          error: "ORDER_NOT_FEASIBLE",
          message: `Заказ не выполним: ${feasibility.reasons.map((r) => r.message).join(" ")}`.trim(),
          reasons: feasibility.reasons,
          shortages: feasibility.owners.flatMap((o) => o.inventory.shortages),
        },
        { status: 409 }
      );
    }

    // Conditional update: параллельные/повторные запросы на принятие — статус
    // меняется ровно один раз (who loses: rowCount=0 → 409, без дублей истории).
    const { data: updatedRows } = await supabaseAdmin
      .from("orders")
      .update({ status: "CONFIRMED", updated_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("status", "PENDING")
      .select("id");

    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json(
        { error: "Заказ уже обработан другим запросом" },
        { status: 409 }
      );
    }

    // Status history.
    // FIX-TL: раньше вставка использовала несуществующую колонку `status`
    // (в схеме 0006 — status_from/status_to) и молча падала (ошибка не
    // проверялась) — строку писал триггер orders_log_status с
    // changed_by=NULL. Триггер удалён (0061) — пишем сами, с атрибуцией
    // актёра (PENDING → CONFIRMED).
    const { error: historyError } = await supabaseAdmin
      .from("order_status_history")
      .insert({
        order_id: orderId,
        status_from: order.status,
        status_to: "CONFIRMED",
        changed_by: user.id,
        comment: null,
      });
    if (historyError) {
      // История не роняет переход (статус = источник истины), но фиксируем.
      console.error("[orders/:id/accept] history insert failed:", historyError.message);
    }

    // Notify customer (non-blocking).
    // Z-v14 FIX: dedupKey — тот же ключ, что и в PATCH-переходе PENDING→CONFIRMED
    // (миграция 0060: UNIQUE (user_id, channel, metadata->>'dedup_key')).
    // Пересечение PATCH+accept теперь даёт ровно одно событие на уровне БД,
    // даже если оба пути прошли свои проверки до CAS-обновления другого.
    try {
      const { sendNotification } = await import("@/lib/notifications");
      await sendNotification({
        userId: order.user_id,
        template: "ORDER_CONFIRMED",
        vars: { orderNumber: order.number || orderId },
        data: { type: "order_confirmed", orderId },
        dedupKey: `order-confirmed:${orderId}`,
      });
    } catch {}

    return NextResponse.json({ success: true, orderId, status: "CONFIRMED" });
  } catch (error: any) {
    return handleRouteError(error, {
      route: "/api/orders/[id]/accept",
      component: "orders",
      requestId: req.headers.get("x-request-id") ?? undefined,
    });
  }
}
