/**
 * /api/inventory/write-off — списание ингредиентов по заказу (Модуль «Склад»).
 *
 * POST { order_id?, items: [{ item_id, quantity }], reason? }
 *   → 201 { applied: [...], failed: [...] }
 *
 * Назначение:
 *   • штатный путь: { order_id, mode: "recipe" } — сервер получает рецептуру
 *     через order_items → products.recipe_id → recipe_ingredients, проверяет
 *     остатки, конвертирует единицы и списывает ингредиенты автоматически;
 *   • ручной путь: { order_id?, items: [{ item_id, quantity }] } — для
 *     корректировок и нестандартных списаний.
 *
 * Каждая позиция проходит через applyInventoryMovement (src/lib/inventory.ts)
 * как обычное OUT-движение: владение (owner_id === user.id, админ — обход),
 * остаток не уходит ниже нуля, журнал + update остатка, n8n "inventory.low".
 *
 * Батч применяется последовательно; при частичном успехе возвращаются оба
 * списка (applied/failed). Если не применилось НИЧЕГО — ошибка с HTTP-статусом
 * первой причины (403/404/409/500).
 *
 * Для order-bound ручного списания используется транзакционный RPC миграции
 * 0119; вне заказа допускаются только отдельные ручные корректировки.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getUserFromRequest } from "@/lib/auth";
import { unauthorizedResponse } from "@/lib/supabase/auth";
import { handleRouteError } from "@/lib/http-helpers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadOrderLite, canOperateOrder } from "@/lib/ops/order-access";
import { writeOffOrderRecipe } from "@/lib/ops/recipe-writeoff";
import {
  applyInventoryMovement,
  isInventoryAdmin,
  parseMovementQuantity,
  type InventoryActor,
  type ApplyMovementError,
} from "@/lib/inventory";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_WRITE_OFF_ITEMS = 50;

interface WriteOffRequestItem {
  item_id: string;
  quantity: number;
}

interface AppliedItem {
  item_id: string;
  item_name: string;
  movement_id: string;
  quantity: number;
  remaining: number;
  unit: string | null;
}

/**
 * Сигнатура батча-списания: отсортированные "item_id:quantity" — одинаковый
 * повторный/параллельный запрос даёт одинаковую сигнатуру и дедуплицируется
 * по uq_inventory_write_off_batch (миграция 0049).
 */
function batchSignature(items: WriteOffRequestItem[]): string {
  const canon = [...items]
    .map((i) => `${i.item_id}:${i.quantity}`)
    .sort()
    .join("|");
  return createHash("sha256").update(canon).digest("hex");
}

type AtomicWriteOffError = { status: number; body: Record<string, unknown> };

/** Safely recover structured details emitted by the transactional SQL RPC. */
function rpcErrorDetails(message: string, marker: string): Array<Record<string, unknown>> {
  const markerIndex = message.indexOf(marker);
  if (markerIndex < 0) return [];
  const start = message.indexOf("[", markerIndex + marker.length);
  const end = message.lastIndexOf("]");
  if (start < 0 || end < start) return [];
  try {
    const parsed: unknown = JSON.parse(message.slice(start, end + 1));
    return Array.isArray(parsed)
      ? parsed.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
      : [];
  } catch {
    return [];
  }
}

/** Map database-side atomic write-off errors to stable, actionable HTTP contracts. */
function atomicWriteOffError(message: string): AtomicWriteOffError {
  if (message.includes("snapshot_mismatch:")) {
    return {
      status: 422,
      body: {
        error: "WRITE_OFF_SNAPSHOT_MISMATCH",
        message: "Списание расходится с нормативом snapshot заказа",
        validation_mode: "snapshot",
        deviations: rpcErrorDetails(message, "snapshot_mismatch:"),
      },
    };
  }
  if (message.includes("snapshot_invalid:")) {
    const reason = message.slice(message.indexOf("snapshot_invalid:") + "snapshot_invalid:".length);
    return {
      status: 422,
      body: {
        error: "SNAPSHOT_INVALID",
        message: reason.includes("quantity_mismatch")
          ? "Snapshot не соответствует позициям заказа"
          : "Повреждён snapshot заказа; списание заблокировано",
      },
    };
  }
  if (message.includes("apply_failed:insufficient")) {
    const failed = rpcErrorDetails(message, "apply_failed:insufficient:");
    return {
      status: 409,
      body: {
        error: String(failed[0]?.error || "Недостаточно ингредиентов на складе"),
        failed,
      },
    };
  }
  if (message.includes("apply_failed:forbidden")) {
    const failed = rpcErrorDetails(message, "apply_failed:forbidden:");
    return {
      status: 403,
      body: {
        error: String(failed[0]?.error || "Нет доступа к позиции склада"),
        failed,
      },
    };
  }
  if (message.includes("apply_failed:not_found")) {
    const failed = rpcErrorDetails(message, "apply_failed:not_found:");
    return {
      status: 404,
      body: {
        error: String(failed[0]?.error || "Позиция склада не найдена"),
        failed,
      },
    };
  }
  if (message.includes("PGRST202")) {
    return {
      status: 503,
      body: {
        error: "Атомарное списание недоступно: примените миграцию 0119 и обновите PostgREST schema cache",
      },
    };
  }
  return { status: 503, body: { error: "Не удалось выполнить атомарное списание" } };
}

/** HTTP-статус и сообщение для ошибки применения движения */
function errorToResponse(error: ApplyMovementError): { status: number; message: string } {
  switch (error.kind) {
    case "not_found":
      return { status: 404, message: "Позиция не найдена" };
    case "forbidden":
      return { status: 403, message: "Нет доступа к этой позиции склада" };
    case "insufficient":
      return {
        status: 409,
        message: `Недостаточно на складе: доступно ${error.available}`,
      };
    default:
      return { status: 500, message: "Не удалось записать движение" };
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
    }

    // order_id — опциональная привязка к заказу (uuid)
    const orderId =
      typeof body.order_id === "string" && body.order_id.trim() ? body.order_id.trim() : null;
    if (orderId && !UUID_RE.test(orderId)) {
      return NextResponse.json({ error: "order_id должен быть uuid" }, { status: 400 });
    }

    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : `Списание по заказу${orderId ? ` ${orderId.slice(0, 8)}` : ""}`;

    // Привязанный к заказу write-off разрешён только назначенному
    // кондитеру/администратору и только в PREPARING.
    let order: Awaited<ReturnType<typeof loadOrderLite>> | null = null;
    if (orderId) {
      order = await loadOrderLite(orderId);
      if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
      if (!(await canOperateOrder(order, user.id))) {
        return NextResponse.json({ error: "Нет доступа к производству этого заказа" }, { status: 403 });
      }
      if (order.status !== "PREPARING") {
        return NextResponse.json({ error: "Списание возможно только во время производства" }, { status: 409 });
      }
    }

    // Основной производственный сценарий — единый сервис автоматически
    // рассчитывает и списывает рецепт. Он же используется этапом
    // ingredients_prepared, поэтому оба входа разделяют один idempotency key.
    let rawItems = Array.isArray(body.items) ? body.items : null;
    if (orderId && (body.mode === "recipe" || !rawItems)) {
      const result = await writeOffOrderRecipe(
        { id: user.id, roles: (user.roles as string[]) || [] },
        orderId
      );
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, details: result.details },
          { status: result.status }
        );
      }
      return NextResponse.json(
        {
          applied: result.applied,
          failed: result.failed,
          order_id: orderId,
          idempotent: result.idempotent,
          duplicate: result.idempotent,
          ...(result.idempotent ? { message: "Списание уже было выполнено ранее" } : {}),
        },
        { status: result.idempotent ? 200 : 201 }
      );
    }

    if (!rawItems || rawItems.length === 0) {
      return NextResponse.json(
        { error: "Передайте items[] или order_id для автоматического списания по рецепту" },
        { status: 400 }
      );
    }
    if (rawItems.length > MAX_WRITE_OFF_ITEMS) {
      return NextResponse.json(
        { error: `Слишком много позиций (макс ${MAX_WRITE_OFF_ITEMS})` },
        { status: 400 }
      );
    }

    const parsed: WriteOffRequestItem[] = [];
    for (const raw of rawItems) {
      const entry = raw as Record<string, unknown>;
      const itemId = typeof entry?.item_id === "string" ? entry.item_id.trim() : "";
      const quantity = parseMovementQuantity(entry?.quantity);
      if (!itemId || quantity === null) {
        return NextResponse.json(
          { error: "Каждый элемент items требует item_id и quantity (> 0)" },
          { status: 400 }
        );
      }
      parsed.push({ item_id: itemId, quantity });
    }

    const actor: InventoryActor = { id: user.id, roles: (user.roles as string[]) || [] };

    // Любое order-bound списание идёт через одну PostgreSQL-транзакцию:
    // блокировка заказа + проверка acceptance_snapshot + дедупликация +
    // все движения склада. Никаких check-then-act и частичных батчей.
    if (orderId) {
      const isAdmin = isInventoryAdmin(actor);
      const signature = batchSignature(parsed);
      const { data, error } = await supabaseAdmin.rpc("apply_order_write_off_atomic", {
        p_actor_id: user.id,
        p_inventory_owner_id: order?.confectioner_id || user.id,
        p_order_id: orderId,
        p_items: parsed,
        p_signature: signature,
        p_reason: reason,
        p_allow_overage: body.allow_overage === true && isAdmin,
        p_actor_is_admin: isAdmin,
      }) as unknown as {
        data: { applied?: AppliedItem[]; failed?: Array<{ item_id: string; error: string }>; idempotent?: boolean } | null;
        error: (Error & { code?: string }) | null;
      };

      if (error) {
        const mapped = atomicWriteOffError(`${error.code ?? ""} ${error.message ?? ""}`);
        console.error("[inventory/write-off] atomic RPC failed:", error.message);
        return NextResponse.json(mapped.body, { status: mapped.status });
      }
      if (!data) return NextResponse.json({ error: "RPC списания не вернул результат" }, { status: 503 });
      const applied = Array.isArray(data.applied) ? data.applied : [];
      const failed = Array.isArray(data.failed) ? data.failed : [];
      if (failed.length > 0) {
        return NextResponse.json(
          {
            applied,
            failed,
            order_id: orderId,
            idempotent: data.idempotent === true,
            duplicate: data.idempotent === true,
            ...(data.idempotent === true ? { message: "Списание уже было выполнено ранее" } : {}),
          },
          { status: applied.length > 0 ? 201 : 409 }
        );
      }
      return NextResponse.json(
        {
          applied,
          failed,
          order_id: orderId,
          idempotent: data.idempotent === true,
          duplicate: data.idempotent === true,
          ...(data.idempotent === true ? { message: "Списание уже было выполнено ранее" } : {}),
        },
        { status: data.idempotent ? 200 : 201 }
      );
    }

    // Вне заказа разрешены только отдельные ручные корректировки; они не
    // затрагивают acceptance snapshot и не обходят order-bound RPC.
    const applied: Array<{
      item_id: string;
      item_name: string;
      movement_id: string;
      quantity: number;
      remaining: number;
      unit: string | null;
    }> = [];
    const failed: Array<{ item_id: string; error: string }> = [];
    let firstError: ApplyMovementError | null = null;

    for (const entry of parsed) {
      const result = await applyInventoryMovement(actor, {
        item_id: entry.item_id,
        type: "OUT",
        quantity: entry.quantity,
        reason,
        order_id: orderId,
      });
      if (result.ok) {
        applied.push({
          item_id: result.item.id,
          item_name: result.item.name,
          movement_id: result.movement.id,
          quantity: entry.quantity,
          remaining: Number(result.item.quantity) || 0,
          unit: result.item.unit,
        });
      } else {
        if (!firstError) firstError = result.error;
        failed.push({
          item_id: entry.item_id,
          error: errorToResponse(result.error).message,
        });
      }
    }

    // Вне заказа обычная корректировка применяется по одной позиции.
    if (applied.length === 0 && firstError) {
      const { status, message } = errorToResponse(firstError);
      return NextResponse.json({ error: message, failed }, { status });
    }

    return NextResponse.json({ applied, failed, order_id: orderId }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/inventory/write-off",
      component: "inventory",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}
