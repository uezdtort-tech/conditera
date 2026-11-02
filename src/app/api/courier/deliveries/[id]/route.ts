/**
 * PATCH /api/courier/deliveries/[id] — действие курьера над СВОЕЙ доставкой.
 *
 * Тело: { action: "pickup" } — забрать доставку.
 *   deliveries.status: 'assigned' → 'picked_up' (+ pickup_at).
 *   Завершение доставки (→ 'delivered') идёт существующим контрактом
 *   PATCH /api/orders/[orderId] {status:"DELIVERED"} (COURIER-переход с
 *   courier-guard'ом и записью order_status_history) — этот роут синхронизирует
 *   строку deliveries у того же перехода, второй писатель статусов не нужен.
 *
 * Безопасность (каждая операция):
 *   • действующая app-сессия (getUserFromRequest) → 401;
 *   • роль COURIER (requireRole) → 403;
 *   • принадлежность доставки этому курьеру (courier_id = user.id) → 403 чужая;
 *   • допустимость перехода из текущего статуса (CAS: .eq("status","assigned"))
 *     → 409 при гонке/повторе;
 *   • CSRF для изменяющих запросов — proxy.ts (double-submit cookie);
 *   • повторное выполнение: повторный pickup на 'picked_up' → 409 (CAS не
 *     найдёт строку в статусе 'assigned').
 *
 * Схема deliveries (0002_marketplace.sql:284–311):
 *   status DEFAULT 'assigned' — 'assigned' | 'picked_up' | 'on_the_way' | 'delivered' | 'failed'.
 *   Новые статусы не вводятся.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import { enforceRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PickupBody {
  action?: string;
}

type DeliveryRow = {
  id: string;
  order_id: string;
  courier_id: string | null;
  status: string;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    // Rate limit: mutate-паттерн assign-роута (тот же лимит api)
    const blocked = await enforceRateLimit(
      request,
      `courier-delivery:${getClientIP(request)}`,
      RATE_LIMITS.api.limit,
      RATE_LIMITS.api.windowMs
    );
    if (blocked) return blocked as unknown as NextResponse;

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Роль: только курьер
    const guard = await requireRole(user.id, "COURIER");
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const { id: deliveryId } = await params;
    if (!UUID_RE.test(deliveryId)) {
      return NextResponse.json({ error: "Некорректный id доставки" }, { status: 400 });
    }

    // safeJsonBody: без тела/битый JSON → 400 вместо 500
    let body: PickupBody | null = null;
    try {
      const raw = await request.json();
      body = (raw ?? null) as PickupBody | null;
    } catch {
      body = null;
    }
    if (body?.action !== "pickup") {
      return NextResponse.json(
        { error: "action обязателен: pickup" },
        { status: 400 }
      );
    }

    // Читаем доставку (принадлежность и статус)
    const { data: delivery, error: fetchErr } = await supabaseAdmin
      .from("deliveries")
      .select("id, order_id, courier_id, status")
      .eq("id", deliveryId)
      .maybeSingle() as { data: DeliveryRow | null; error: { message: string } | null };

    if (fetchErr) {
      console.error("[courier/deliveries] fetch error:", fetchErr.message);
      return NextResponse.json(
        { error: "Database query failed", details: fetchErr.message },
        { status: 500 }
      );
    }
    if (!delivery) {
      return NextResponse.json({ error: "Доставка не найдена" }, { status: 404 });
    }

    // Чужая доставка недоступна (не назначена этому курьеру)
    if (delivery.courier_id !== user.id) {
      return NextResponse.json(
        { error: "Можно менять только назначенные вам доставки" },
        { status: 403 }
      );
    }

    // Допустимый переход: забрать можно только назначенную (status='assigned')
    if (delivery.status !== "assigned") {
      return NextResponse.json(
        { error: `Недопустимый переход: забрать можно доставку в статусе assigned (текущий ${delivery.status})` },
        { status: 409 }
      );
    }

    // Атомарный CAS-переход: строка обязана остаться в 'assigned' под этим курьером.
    // Гонка/повтор → 0 строк → 409 (обновлённое состояние вернёт GET).
    const nowIso = new Date().toISOString();
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("deliveries")
      .update({ status: "picked_up", pickup_at: nowIso, updated_at: nowIso })
      .eq("id", deliveryId)
      .eq("courier_id", user.id)
      .eq("status", "assigned")
      .select("id, order_id, status, pickup_at")
      .maybeSingle() as {
      data: { id: string; order_id: string; status: string; pickup_at: string } | null;
      error: { message: string } | null;
    };

    if (updateErr) {
      console.error("[courier/deliveries] pickup error:", updateErr.message);
      return NextResponse.json(
        { error: "Database update failed", details: updateErr.message },
        { status: 500 }
      );
    }
    if (!updated) {
      // Гонка: другой запрос уже сменил статус (или курьер отозван)
      return NextResponse.json(
        { error: "Статус доставки уже изменён, обновите данные" },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      delivery: updated,
    });
  } catch (error: unknown) {
    console.error(
      "PATCH /api/courier/deliveries/[id] error:",
      (error as Error)?.message
    );
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
