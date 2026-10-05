/**
 * /api/inventory/write-off — списание ингредиентов по заказу (Модуль «Склад»).
 *
 * POST { order_id?, items: [{ item_id, quantity }], reason? }
 *   → 201 { applied: [...], failed: [...] }
 *
 * Назначение: кондитер при готовке (заказ в PREPARING) списывает реальные
 * ингредиенты со своего склада. Рецепт→заказ НЕ линкуется автоматически
 * (в БД нет связи order↔recipe) — кондитер передаёт список позиций сам;
 * в будущем UI может подставлять ингредиенты выбранного рецепта.
 *
 * Каждая позиция проходит через applyInventoryMovement (src/lib/inventory.ts)
 * как обычное OUT-движение: владение (owner_id === user.id, админ — обход),
 * остаток не уходит ниже нуля, журнал + update остатка, n8n "inventory.low".
 *
 * Батч применяется последовательно; при частичном успехе возвращаются оба
 * списка (applied/failed). Если не применилось НИЧЕГО — ошибка с HTTP-статусом
 * первой причины (403/404/409/500).
 *
 * Идемпотентность (миграция 0049, реестр inventory_write_offs): повторная
 * или параллельная отправка того же батча с тем же order_id возвращает
 * сохранённый результат (200, idempotent:true) — двойное списание невозможно.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getUserFromRequest } from "@/lib/auth";
import { unauthorizedResponse } from "@/lib/supabase/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  applyInventoryMovement,
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

/** Найти уже выполненное списание этого же батча (идемпотентный повтор) */
async function findExistingWriteOff(ownerId: string, orderId: string, signature: string) {
  const { data } = await supabaseAdmin
    .from("inventory_write_offs")
    .select("id, items, result, created_at")
    .eq("owner_id", ownerId)
    .eq("order_id", orderId)
    .eq("signature", signature)
    .maybeSingle();
  return (data as { id: string; items: unknown; result: unknown; created_at: string } | null) ?? null;
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

    // items: [{ item_id, quantity }]
    const rawItems = Array.isArray(body.items) ? body.items : null;
    if (!rawItems || rawItems.length === 0) {
      return NextResponse.json(
        { error: "items обязателен (непустой массив { item_id, quantity })" },
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

    // === Идемпотентность (миграция 0049): ретрай/двойная отправка того же
    // батча по заказу возвращает сохранённый результат — движения не пишутся
    // второй раз. Списания без order_id не дедуплицируются (нет ключа).
    const signature = orderId ? batchSignature(parsed) : null;
    if (orderId && signature) {
      const existing = await findExistingWriteOff(user.id, orderId, signature);
      if (existing) {
        const saved = (existing.result ?? {}) as { applied?: AppliedItem[]; failed?: unknown[] };
        return NextResponse.json(
          {
            applied: saved.applied ?? [],
            failed: saved.failed ?? [],
            order_id: orderId,
            idempotent: true,
            duplicate: true,
            message: "Списание по этому заказу уже было выполнено ранее",
          },
          { status: 200 }
        );
      }
    }

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

    // Ни одна позиция не списана — возвращаем ошибку первой причины
    if (applied.length === 0 && firstError) {
      const { status, message } = errorToResponse(firstError);
      return NextResponse.json({ error: message, failed }, { status });
    }

    // Фиксируем выполненный батч в реестре (0049): повторные отправки
    // получат сохранённый результат. 23505 — параллельный запрос успел
    // первым: возвращаем его результат вместо ошибки.
    if (orderId && signature) {
      const { error: regErr } = await supabaseAdmin.from("inventory_write_offs").insert({
        owner_id: user.id,
        order_id: orderId,
        signature,
        items: parsed,
        result: { applied, failed },
      });
      if (regErr && (regErr as { code?: string }).code === "23505") {
        const raced = await findExistingWriteOff(user.id, orderId, signature);
        if (raced) {
          const saved = (raced.result ?? {}) as { applied?: AppliedItem[]; failed?: unknown[] };
          return NextResponse.json(
            {
              applied: saved.applied ?? [],
              failed: saved.failed ?? [],
              order_id: orderId,
              idempotent: true,
              duplicate: true,
              message: "Списание по этому заказу уже было выполнено ранее",
            },
            { status: 200 }
          );
        }
      } else if (regErr) {
        // Батч уже применён; не откатываем — журнал в inventory_movements полон.
        // Логируем и возвращаем обычный успех (реестр — оптимизация, не источник истины).
        console.error("[inventory/write-off] registry insert failed:", regErr.message);
      }
    }

    return NextResponse.json({ applied, failed, order_id: orderId }, { status: 201 });
  } catch (error) {
    console.error("[inventory/write-off] POST error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
