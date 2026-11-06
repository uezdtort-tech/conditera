/**
 * PATCH /api/orders/[id] — обновление статуса заказа.
 *
 * Доступ:
 *   - CUSTOMER: только CANCELLED (отмена своего заказа)
 *   - CONFECTIONER: CONFIRMED, PREPARING, READY (статусы приготовления)
 *   - COURIER: IN_DELIVERY, DELIVERED
 *   - ADMIN: любой статус
 *
 * Body: { status: 'PENDING'|'CONFIRMED'|..., comment?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
// Единый auth-контракт: getUserFromRequest читает Bearer И cookie cd_session —
// раньше getCurrentUser (GoTrue getSession) не работал в локальном runtime
// (auth/v1 — 501-стаб) и отдавал 401 всем Bearer-клиентам.
import { getUserFromRequest } from "@/lib/auth";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/supabase/auth";
import { isCourierAssignedToOrder } from "@/lib/courier-assignments";
import { emitEvent } from "@/lib/n8n";
import { recordEvent } from "@/lib/ops/events";

interface OrderStatusTransition {
  from: string;
  to: string;
  roles: string[]; // роли которым разрешён переход
}

const STATUS_TRANSITIONS: OrderStatusTransition[] = [
  { from: "PENDING", to: "CONFIRMED", roles: ["CONFECTIONER", "ADMIN", "SUPER_ADMIN"] },
  { from: "PENDING", to: "CANCELLED", roles: ["CUSTOMER", "CONFECTIONER", "ADMIN", "SUPER_ADMIN"] },
  { from: "CONFIRMED", to: "PREPARING", roles: ["CONFECTIONER", "ADMIN", "SUPER_ADMIN"] },
  { from: "PREPARING", to: "READY", roles: ["CONFECTIONER", "ADMIN", "SUPER_ADMIN"] },
  { from: "READY", to: "IN_DELIVERY", roles: ["COURIER", "ADMIN", "SUPER_ADMIN"] },
  { from: "IN_DELIVERY", to: "DELIVERED", roles: ["COURIER", "ADMIN", "SUPER_ADMIN"] },
  { from: "DELIVERED", to: "COMPLETED", roles: ["CUSTOMER", "ADMIN", "SUPER_ADMIN"] },
  { from: "DELIVERED", to: "REFUNDED", roles: ["ADMIN", "SUPER_ADMIN", "INSPECTOR"] },
];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: orderId } = await params;
    const user = await getUserFromRequest(request);

    if (!user) {
      return unauthorizedResponse();
    }

    const body = await request.json();
    const { status: newStatus, comment } = body as {
      status: string;
      comment?: string;
    };

    if (!newStatus) {
      return NextResponse.json({ error: "Status is required" }, { status: 400 });
    }

    // Загружаем текущий заказ
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, confectioner_id, status, number")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }

    // Проверяем права на переход
    const transition = STATUS_TRANSITIONS.find(
      (t) => t.from === order.status && t.to === newStatus
    );

    if (!transition) {
      return NextResponse.json(
        { error: `Запрещённый переход: ${order.status} → ${newStatus}` },
        { status: 400 }
      );
    }

    // Проверяем роль пользователя
    const userRoles = user.roles;
    const hasRole = transition.roles.some((r) => userRoles.includes(r));
    if (!hasRole) {
      return forbiddenResponse(`Роль ${userRoles.join(", ")} не может менять статус ${order.status} → ${newStatus}`);
    }

    // Дополнительная проверка: CUSTOMER может менять только свой заказ.
    // Сужение применяется ТОЛЬКО если CUSTOMER входит в роли ЭТОГО перехода:
    // у каждого пользователя в токене есть базовая роль CUSTOMER (login), и
    // раньше courier (roles [CUSTOMER, COURIER]) на переходе IN_DELIVERY →
    // DELIVERED (roles COURIER/ADMIN) попадал под «Можно менять только свои
    // заказы» раньше курьерского guard'а — завершение чужой доставки было
    // невозможно для любого курьера.
    if (
      transition.roles.includes("CUSTOMER") &&
      userRoles.includes("CUSTOMER") &&
      !userRoles.includes("ADMIN")
    ) {
      if (order.user_id !== user.id) {
        return forbiddenResponse("Можно менять только свои заказы");
      }
    }

    // Дополнительная проверка: CONFECTIONER может менять только свои заказы
    if (
      transition.roles.includes("CONFECTIONER") &&
      userRoles.includes("CONFECTIONER") &&
      !userRoles.includes("ADMIN")
    ) {
      if (order.confectioner_id !== user.id) {
        return forbiddenResponse("Можно менять только заказы, назначенные вам");
      }
    }

    // P1.1 §15: COURIER меняет только назначенные ему доставки. Раньше любой
    // курьер мог перевести ЛЮБОЙ заказ READY → IN_DELIVERY → DELIVERED.
    // A-2: массив-запрос вместо .maybeSingle() — при аномалии из двух строк
    // (order+courier) maybeSingle вернул бы ошибку, assignment=null и легитимный
    // курьер получил бы 403. Ошибка БД — fail-closed 500 (не 403: «не назначен»
    // было бы ложью при недоступности данных).
    if (
      userRoles.includes("COURIER") &&
      !userRoles.includes("ADMIN") &&
      !userRoles.includes("SUPER_ADMIN") &&
      (newStatus === "IN_DELIVERY" || newStatus === "DELIVERED")
    ) {
      const { data: assignments, error: assignmentError } = await supabaseAdmin
        .from("deliveries")
        .select("id")
        .eq("order_id", orderId)
        .eq("courier_id", user.id)
        .limit(1);
      if (assignmentError) {
        console.error(
          "[orders/[id]] assignment check failed:",
          assignmentError.message
        );
        return NextResponse.json(
          { error: "Не удалось проверить назначение доставки" },
          { status: 500 }
        );
      }
      if (!assignments || assignments.length === 0) {
        return forbiddenResponse("Можно менять только назначенные вам доставки");
      }
    }

    // P1 (courier): синхронизация строки deliveries у перехода в DELIVERED.
    // Первопричина рассинхрона: courier/assign ставил orders.status=IN_DELIVERY,
    // но deliveries.status навсегда оставался 'assigned' — кабинет курьера
    // (фильтр deliveries.status='delivered') и API (orders.status) показывали
    // разные цифры, у доставки не заполнялись delivered_at/courier_earnings.
    //
    // A-2 (первопричина молчаливого пропуска синхронизации): раньше sync-чтение
    // шло через .maybeSingle() без деструктуризации error — при двух активных
    // доставках одного заказа PostgREST возвращал ошибку «multiple rows»,
    // data=null, sync молча пропускался (доставки навсегда активны,
    // courier_earnings=0) без единой записи в логе.
    //
    // Теперь инвариант «≤ 1 активной доставки на заказ» проверяется ДО
    // необратимого обновления заказа:
    //   • 0 активных — легально (самовывоз/заказы без доставки) → переход без sync;
    //   • 1 активная — штатный sync после обновления (CAS по активным статусам;
    //     повторный DELIVERED невозможен картой переходов; начисление НЕ
    //     суммируется — courier_earnings присваивается, а не инкрементируется);
    //   • >1 — аномалия данных: 409 с диагностикой ДО обновления заказа
    //     (частично завершённый процесс не создаётся); уникальный индекс /
    //     чистка данных — отдельным согласованием (не вслепую);
    //   • ошибка чтения — fail-closed 500 до обновления заказа.
    // Отчёт клиенту: поле deliverySync — честный статус синхронизации. Ошибка
    // sync-записи не роняет уже выполненный переход (статус заказа = источник
    // истины), но и не маскируется под успех.
    let deliverySync: "ok" | "skipped_no_delivery" | "failed" = "skipped_no_delivery";
    let activeDelivery: { id: string; status: string; cost: number | null } | null = null;
    if (newStatus === "DELIVERED") {
      const { data: activeRows, error: activeError } = await supabaseAdmin
        .from("deliveries")
        .select("id, status, cost")
        .eq("order_id", orderId)
        .in("status", ["assigned", "picked_up", "on_the_way"]);
      if (activeError) {
        console.error(
          "[orders/[id]] active deliveries read failed:",
          activeError.message
        );
        return NextResponse.json(
          { error: "Не удалось проверить доставки заказа (синхронизация отменена)" },
          { status: 500 }
        );
      }
      const rows = (activeRows || []) as { id: string; status: string; cost: number | null }[];
      if (rows.length > 1) {
        console.error(
          `[orders/[id]] DELIVERED blocked: ${rows.length} active deliveries for order ${orderId}:`,
          JSON.stringify(rows.map((d) => d.id))
        );
        return NextResponse.json(
          {
            error: `Нарушен инвариант данных: у заказа ${rows.length} активных доставок (допустимо 0 или 1). Переход отменён — требуется исправление данных.`,
          },
          { status: 409 }
        );
      }
      activeDelivery = rows[0] ?? null;
    }

    // Обновляем заказ
    const updateData: Record<string, string> = { status: newStatus };
    if (comment) updateData.notes = comment;

    // Timestamps для конкретных статусов
    if (newStatus === "CONFIRMED") updateData.confirmed_at = new Date().toISOString();
    if (newStatus === "IN_DELIVERY") updateData.shipped_at = new Date().toISOString();
    if (newStatus === "DELIVERED") updateData.delivered_at = new Date().toISOString();
    if (newStatus === "COMPLETED") updateData.completed_at = new Date().toISOString();
    if (newStatus === "CANCELLED") updateData.cancelled_at = new Date().toISOString();

    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from("orders")
      .update(updateData)
      .eq("id", orderId)
      .select()
      .single();

    if (updateError) {
      console.error("[orders/[id]] Update error:", updateError.message);
      return NextResponse.json({ error: "Ошибка обновления" }, { status: 500 });
    }

    // Этап 10 §A2: аудит-паритет с движком lifecycle (order_status_history
    // писался только transition-роутами P0.5, PATCH-путь историю терял).
    // FIX-TL: триггер orders_log_status (миграция 0006) удалён (0061) — он
    // дублировал каждую запись строкой с changed_by=NULL (auth.uid()
    // недоступен service-role/pg-пулу). Эта вставка — ЕДИНСТВЕННЫЙ писатель
    // истории для PATCH-переходов, с атрибуцией актёра. supabase-js не умеет
    // кросс-табличные транзакции: при ошибке журнала статус уже изменён —
    // не откатываем (статус = источник истины), фиксируем в логах.
    const { error: historyError } = await supabaseAdmin
      .from("order_status_history")
      .insert({
        order_id: orderId,
        status_from: order.status,
        status_to: newStatus,
        changed_by: user.id,
        comment: comment ?? null,
      });
    if (historyError) {
      console.error("[orders/[id]] history insert failed:", historyError.message);
    }

    // FIX-ZV13: уведомление покупателю о принятии заказа. Раньше ORDER_CONFIRMED
    // отправлял только POST /accept, а реальный UI кондитера («Подтвердить»)
    // ходит через PATCH — покупатель оставался без уведомления.
    // Семантика та же, что в accept: ровно один раз после успешного серверного
    // перехода PENDING → CONFIRMED; при ошибке API переход не уведомляет;
    // сбой отправки не откатывает статус (fail-safe).
    if (newStatus === "CONFIRMED" && order.status === "PENDING") {
      try {
        const { sendNotification } = await import("@/lib/notifications");
        await sendNotification({
          userId: order.user_id,
          template: "ORDER_CONFIRMED",
          vars: { orderNumber: order.number || orderId },
          data: { type: "order_confirmed", orderId },
        });
      } catch (notifyError) {
        console.error(
          "[orders/[id]] ORDER_CONFIRMED notification failed:",
          notifyError instanceof Error ? notifyError.message : notifyError
        );
      }
    }

    // n8n: order.status_changed (fail-safe, после успешного обновления)
    void emitEvent("order.status_changed", {
      orderId,
      from: order.status,
      to: newStatus,
    }).catch(() => {});

    // ops: event log (append-only, fail-safe)
    void recordEvent("order.status_changed", {
      entityType: "order",
      entityId: orderId,
      actorId: user.id,
      payload: { from: order.status, to: newStatus },
    });

    // P1 (courier) / A-2: sync-запись единственной активной доставки.
    // Инвариант и диагностика — выше (до обновления заказа); здесь — только
    // CAS-запись с честным отчётом deliverySync.
    if (activeDelivery) {
      try {
        const nowIso = new Date().toISOString();
        const { error: dErr } = await supabaseAdmin
          .from("deliveries")
          .update({
            status: "delivered",
            delivered_at: nowIso,
            // курьер получает стоимость доставки (схема 0002: courier_earnings).
            // A-3: канонический источник заработка — снимок на момент доставки;
            // присваивание (не инкремент) — повторная обработка не удваивает сумму.
            courier_earnings: Number(activeDelivery.cost || 0),
            updated_at: nowIso,
          })
          .eq("id", activeDelivery.id)
          .in("status", ["assigned", "picked_up", "on_the_way"]);
        if (dErr) {
          // A-2: ошибка деструктурирована и залогирована; статус перехода
          // честно помечен failed (не маскируем под успешную синхронизацию).
          deliverySync = "failed";
          console.error("[orders/[id]] deliveries sync failed:", dErr.message);
        } else {
          deliverySync = "ok";
        }
      } catch (syncErr) {
        deliverySync = "failed";
        console.error(
          "[orders/[id]] deliveries sync error:",
          (syncErr as Error)?.message
        );
      }
    }

    return NextResponse.json({
      order: updatedOrder,
      transition: { from: order.status, to: newStatus },
      // A-2: честный статус синхронизации доставки (ok / skipped_no_delivery /
      // failed) — отсутствие ошибки в ответе больше не выдаёт пропущенный sync
      // за успешный.
      ...(newStatus === "DELIVERED" ? { deliverySync } : {}),
    });
  } catch (error) {
    console.error("[orders/[id]] Unexpected:", (error as Error).message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: (error as Error).message },
      { status: 500 }
    );
  }
}

/** GET /api/orders/[id] — детали заказа */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: orderId } = await params;
    const user = await getUserFromRequest(request);

    if (!user) {
      return unauthorizedResponse();
    }

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select(`
        *,
        items:order_items(*),
        payment:payments(*),
        delivery:deliveries(*)
      `)
      .eq("id", orderId)
      .single();

    if (error || !order) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }

    // Проверяем права доступа
    const isOwner = order.user_id === user.id;
    const isConfectioner = order.confectioner_id === user.id;
    // P1 (courier-scope): COURIER удалён из привилегированного списка — сама
    // по себе роль курьера не даёт права читать чужие заказы (раньше любой
    // курьер мог получить полные детали любого заказа: items, payment,
    // delivery). Курьер допускается только к заказу, на который назначен.
    // Канонический маркер назначения — deliveries.courier_id (orders.courier_id
    // в реальной схеме БД не существует; deliveries приходят встроенными как
    // order.delivery[]). Сравнение — по серверным данным, не по payload.
    const isPrivileged = user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN", "SUPPORT"].includes(r)
    );
    const isCourierAssigned =
      user.roles.includes("COURIER") && isCourierAssignedToOrder(order, user.id);

    if (!isOwner && !isConfectioner && !isPrivileged && !isCourierAssigned) {
      return forbiddenResponse(
        user.roles.includes("COURIER")
          ? "Курьер не назначен на этот заказ"
          : "Нет доступа к этому заказу"
      );
    }

    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
