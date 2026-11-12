/**
 * /api/inventory/write-off — списание ингредиентов со склада (Модуль «Склад»).
 *
 * Два режима POST:
 *
 * 1) Order-путь (существующий, Миграции 0048/0049 — НЕ менять контракт):
 *    { order_id, items: [{ item_id, quantity }] }
 *      → 201 { applied: [...], failed: [...] }
 *    Кондитер при готовке (заказ в PREPARING) списывает реальные ингредиенты.
 *    Идемпотентность — реестр inventory_write_offs по (owner, order, signature);
 *    повторная/параллельная отправка → 200 idempotent:true (0049).
 *    Z-v30: количества НОВОГО батча валидируются против зафиксированного
 *    metadata.acceptance_snapshot заказа (src/lib/ops/write-off-validation.ts):
 *    превышение/вне состава/несовместимые единицы → 422
 *    WRITE_OFF_SNAPSHOT_MISMATCH; явное подтверждение оператора
 *    (allow_overage: true + причина) пропускает как ручную корректировку
 *    с пометкой в журнале движений. Легаси-заказы (без snapshot) — прежнее
 *    поведение; повреждённый snapshot → 422 SNAPSHOT_INVALID (fail-closed).
 *    Z-v32 (ZV31-002): order-путь выполняется ОДНИМ БД-RPC
 *    apply_order_write_off_atomic (миграция 0081) — одна транзакция:
 *    FOR UPDATE строки заказа (сериализация всех списаний заказа),
 *    реестр-первым (дедупликация сигнатуры ДО применения движений),
 *    перепроверка snapshot и остатков В ТРАНЗАКЦИИ, блокировка позиций
 *    FOR UPDATE по отсортированному item_id, движения + реестр атомарны.
 *    Устранён TOCTOU прежней схемы «валидация приложением →
 *    по-позиционное применение → INSERT реестра»: два параллельных списания
 *    одного заказа больше не могут оба пройти проверку. Списания БЕЗ order_id
 *    (нет бизнес-ключа) идут прежним per-item путём 0048 без дедупликации.
 *
 * 2) Batch-путь (RECIPE-02/05, RA.11): { batch_id, items: [{ item_id, quantity, unit? }] }
 *      → 200/201 { batch_id, applied: [...], idempotent? }
 *    Списание производственной партии — ТОЛЬКО через БД-RPC
 *    apply_inventory_write_off_batch (миграция 0071, РЕШ-7/RA.11.3):
 *    реестр-первым, одна транзакция, полный откат при любой ошибке позиции,
 *    GRANT EXECUTE только service_role. Сервер (не клиент):
 *      • проверяет ownership и статус партии (списание разрешено только
 *        planned/in_progress; completed/cancelled → 409);
 *      • валидирует items против НОРМ card_version (qty_per_unit × planned_qty
 *        с учётом waste_pct и конвертации единиц; допуск 5% — BATCH_QTY_TOLERANCE);
 *      • считает signature = sha256 отсортированных "item_id:quantity";
 *      • генерирует idempotency_key = `pb:{batch_id}` (RA.11.2);
 *      • вызывает RPC одной попыткой — ответ функции содержит
 *        идемпотентную семантику (конфликт ключей → replay, движения
 *        НЕ применяются повторно).
 *    Статус партии RPC/списание НЕ меняют — completed ставит
 *    PATCH /api/production/batches/[id] (гейт «партия без списания», RB.15).
 *
 * Алиасы полей позиции (batch-путь): item_id|inventory_item_id, quantity|qty.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getUserFromRequest } from "@/lib/auth";
import { unauthorizedResponse } from "@/lib/supabase/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  applyInventoryMovement,
  parseMovementQuantity,
  isInventoryAdmin,
  type InventoryActor,
  type ApplyMovementError,
} from "@/lib/inventory";
import { convertQty } from "@/lib/recipes/cost";
import type { BatchRow } from "@/lib/recipes/production";
import { handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_WRITE_OFF_ITEMS = 50;

/**
 * Допуск расхождения списания против норм партии (доля от ожидаемого):
 * 5% покрывает округление/фактический расход; большее расхождение → 422.
 */
const BATCH_QTY_TOLERANCE = 0.05;
/** Минимальный абсолютный допуск (для крошечных норм) */
const BATCH_QTY_TOLERANCE_ABS = 0.001;

interface WriteOffRequestItem {
  item_id: string;
  quantity: number;
}

/**
 * Сигнатура батча-списания: отсортированные "item_id:quantity" — одинаковый
 * повторный/параллельный запрос даёт одинаковую сигнатуру и дедуплицируется
 * по uq_inventory_write_off_batch (миграция 0049) / в RPC 0081 (реестр-первым).
 */
function batchSignature(items: WriteOffRequestItem[]): string {
  const canon = [...items]
    .map((i) => `${i.item_id}:${i.quantity}`)
    .sort()
    .join("|");
  return createHash("sha256").update(canon).digest("hex");
}

/** Результат RPC apply_order_write_off_atomic (0081) */
interface RpcOrderWriteOffResult {
  idempotent?: boolean;
  applied?: unknown[];
  failed?: unknown[];
  order_id?: string | null;
  validation_mode?: "snapshot" | "legacy";
  overage_confirmed?: boolean;
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

/**
 * Ошибка RPC apply_order_write_off_atomic (0081) → HTTP-ответ.
 * Сообщения RAISE в 0081: [order_write_off] <kind>[:<payload>].
 * Коды ответа — СУЩЕСТВУЮЩИЕ (422 WRITE_OFF_SNAPSHOT_MISMATCH /
 * SNAPSHOT_INVALID / 409 недостаточно / 403 / 404); формат 422 с deviations
 * не меняется (паритет прежней TS-валидации Z-v30).
 */
function orderRpcErrorToResponse(
  rpcMessage: string,
  orderId: string | null
): NextResponse {
  const marker = "[order_write_off] ";
  const idx = rpcMessage.indexOf(marker);
  const tail = idx >= 0 ? rpcMessage.slice(idx + marker.length) : rpcMessage;

  if (tail.startsWith("snapshot_mismatch:")) {
    let deviations: unknown = [];
    try {
      deviations = JSON.parse(tail.slice("snapshot_mismatch:".length));
    } catch {
      deviations = [];
    }
    return NextResponse.json(
      {
        error: "WRITE_OFF_SNAPSHOT_MISMATCH",
        message:
          "Количество списания расходится с зафиксированным snapshot потребности заказа (Z-v30). Легитимная ручная корректировка требует явного подтверждения: allow_overage: true и причина.",
        deviations,
        validation_mode: "snapshot",
      },
      { status: 422 }
    );
  }

  if (tail.startsWith("snapshot_invalid:")) {
    const reason = tail.slice("snapshot_invalid:".length);
    const coverageReasons = ["product_set_mismatch", "quantity_mismatch"];
    const message = coverageReasons.some((r) => reason.startsWith(r))
      ? `Snapshot не соответствует позициям заказа (${reason}) — нормативное списание заблокировано (fail-closed).`
      : `Повреждён snapshot производственного состава заказа (${reason}) — нормативное списание заблокировано (fail-closed). Ручные корректировки — через /api/inventory/movements.`;
    return NextResponse.json({ error: "SNAPSHOT_INVALID", message }, { status: 422 });
  }

  if (tail.startsWith("apply_failed:")) {
    const rest = tail.slice("apply_failed:".length);
    const sep = rest.indexOf(":");
    const kind = sep >= 0 ? rest.slice(0, sep) : rest;
    let failed: unknown = [];
    if (sep >= 0) {
      try {
        failed = JSON.parse(rest.slice(sep + 1));
      } catch {
        failed = [];
      }
    }
    const firstError =
      (Array.isArray(failed) &&
        typeof (failed[0] as { error?: string } | undefined)?.error === "string" &&
        (failed[0] as { error: string }).error) ||
      "Не удалось записать движение";
    const status = kind === "insufficient" ? 409 : kind === "forbidden" ? 403 : kind === "not_found" ? 404 : 500;
    return NextResponse.json({ error: firstError, failed }, { status });
  }

  if (tail.startsWith("bad_item")) {
    return NextResponse.json(
      { error: "Каждый элемент items требует item_id и quantity (> 0)" },
      { status: 400 }
    );
  }

  console.error("[inventory/write-off] order RPC failed:", rpcMessage);
  return NextResponse.json({ error: "Не удалось записать движение", order_id: orderId }, { status: 500 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
    }

    // ── Batch-путь (RECIPE-02/RA.11): batch_id присутствует → списание партии
    //    через БД-RPC apply_inventory_write_off_batch. Существующий order-путь
    //    ниже не затронут (совместимость контракта 0049 и тестов). ──
    const batchIdRaw =
      typeof body.batch_id === "string" && body.batch_id.trim() ? body.batch_id.trim() : null;
    if (batchIdRaw) {
      if (!UUID_RE.test(batchIdRaw)) {
        return NextResponse.json({ error: "batch_id должен быть uuid" }, { status: 400 });
      }
      const actor: InventoryActor = { id: user.id, roles: (user.roles as string[]) || [] };
      return await handleBatchWriteOff(actor, batchIdRaw, body);
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
    const signature = orderId ? batchSignature(parsed) : null;

    // === Z-v32 (ZV31-002): order-путь — ОДИН атомарный БД-RPC (0081).
    // Внутри одной транзакции: FOR UPDATE строки заказа (сериализация
    // параллельных списаний одного заказа), реестр-первым (идемпотентный
    // replay ДО применения движений), перепроверка snapshot и уже списанного
    // под блокировкой (кумулятивный TOCTOU устранён на уровне PostgreSQL),
    // FOR UPDATE складских позиций в отсортированном порядке item_id,
    // guard «остаток ≥ 0», движения + реестр. Частичный успех сохранён
    // (applied+failed); полный провал и расхождение со snapshot → полный
    // откат, ошибки поверхруются существующими кодами (orderRpcErrorToResponse).
    // Списания БЕЗ order_id (нет бизнес-ключа дедупликации) — прежний
    // per-item путь 0048 ниже, контракт не меняется.
    if (orderId && signature) {
      const { data: rpcData, error: rpcErr } = (await supabaseAdmin.rpc(
        "apply_order_write_off_atomic",
        {
          p_owner_id: user.id,
          p_order_id: orderId,
          p_items: parsed,
          p_signature: signature,
          p_reason: reason,
          p_allow_overage: body.allow_overage === true,
          p_actor_is_admin: isInventoryAdmin(actor),
        }
      )) as unknown as {
        data: RpcOrderWriteOffResult | null;
        error: (Error & { code?: string }) | null;
      };

      if (rpcErr && rpcErr.code === "PGRST202") {
        // fail-closed: RPC отсутствует — списание НЕ выполняем небезопасным путём
        console.error(
          "[inventory/write-off] apply_order_write_off_atomic RPC отсутствует — fail-closed (примените миграцию 0081)"
        );
        return NextResponse.json(
          { error: "Списание по заказу недоступно (примените миграцию 0081)" },
          { status: 500 }
        );
      }
      if (rpcErr) {
        return orderRpcErrorToResponse(rpcErr.message, orderId);
      }
      if (!rpcData) {
        console.error("[inventory/write-off] order RPC returned no data");
        return NextResponse.json({ error: "Не удалось записать движение", order_id: orderId }, { status: 500 });
      }

      if (rpcData.idempotent === true) {
        // Идемпотентный replay: возвращаем сохранённый результат (0049-семантика)
        return NextResponse.json(
          {
            applied: rpcData.applied ?? [],
            failed: rpcData.failed ?? [],
            order_id: orderId,
            idempotent: true,
            duplicate: true,
            message: "Списание по этому заказу уже было выполнено ранее",
          },
          { status: 200 }
        );
      }

      return NextResponse.json(
        { applied: rpcData.applied ?? [], failed: rpcData.failed ?? [], order_id: orderId },
        { status: 201 }
      );
    }

    // === Списания БЕЗ order_id: прежний per-item путь (0048, без дедупликации) ===
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
        order_id: null,
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

    return NextResponse.json({ applied, failed, order_id: orderId }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/inventory/write-off",
      component: "inventory",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}

// ============================================================================
// Batch-путь (RECIPE-02/05, RA.11): списание производственной партии.
// Единственный путь — БД-RPC apply_inventory_write_off_batch (0071, РЕШ-7):
// реестр-первым, одна транзакция, полный откат при ошибке позиции.
// Клиенту НЕ доверяются: owner_id, статус партии, qty норм, idempotency_key.
// ============================================================================

interface BatchSnapshotNorm {
  inventory_item_id: string;
  qty_per_unit: number;
  unit: string;
  waste_pct?: number | null;
  is_optional?: boolean | null;
}

interface RpcWriteOffResult {
  idempotent?: boolean;
  write_off_id?: string;
  result?: { applied?: Array<{ item_id: string; movement_id: string; quantity: number; new_qty: number }>; applied_at?: string };
}

/** Ошибка RPC → HTTP-статус/сообщение (сообщения RAISE в 0071:129-211) */
function batchRpcErrorToResponse(rpcMessage: string): { status: number; error: string } {
  const marker = "[write_off_batch] ";
  const idx = rpcMessage.indexOf(marker);
  const tail = idx >= 0 ? rpcMessage.slice(idx + marker.length) : rpcMessage;
  if (tail.startsWith("insufficient:")) {
    return { status: 409, error: "Недостаточно остатка на складе для списания партии (полный откат)" };
  }
  if (tail.startsWith("unit_mismatch:")) {
    return { status: 422, error: "Единица измерения позиции не совпадает со складской" };
  }
  if (tail.startsWith("forbidden_item:")) {
    return { status: 403, error: "Позиция склада не принадлежит владельцу партии" };
  }
  if (tail.startsWith("not_found:")) {
    return { status: 404, error: "Позиция склада не найдена" };
  }
  if (tail.startsWith("bad_item:")) {
    return { status: 400, error: "Некорректная позиция списания" };
  }
  return { status: 500, error: "Не удалось выполнить списание партии" };
}

/**
 * Списание партии: ownership → статус-гейт → валидация против норм
 * card_version → RPC (одна попытка; идемпотентность внутри функции).
 */
async function handleBatchWriteOff(
  actor: InventoryActor,
  batchId: string,
  body: Record<string, unknown>
): Promise<NextResponse> {
  // --- items: [{ item_id|inventory_item_id, quantity|qty, unit? }] ---
  const rawItems = Array.isArray(body.items) ? body.items : null;
  if (!rawItems || rawItems.length === 0) {
    return NextResponse.json(
      { error: "items обязателен (непустой массив { item_id, quantity, unit? })" },
      { status: 400 }
    );
  }
  if (rawItems.length > MAX_WRITE_OFF_ITEMS) {
    return NextResponse.json(
      { error: `Слишком много позиций (макс ${MAX_WRITE_OFF_ITEMS})` },
      { status: 400 }
    );
  }
  interface ParsedBatchItem {
    item_id: string;
    quantity: number;
    unit: string | null;
  }
  const sent: ParsedBatchItem[] = [];
  for (const raw of rawItems) {
    const entry = raw as Record<string, unknown>;
    const itemId =
      typeof entry?.item_id === "string" && entry.item_id.trim()
        ? entry.item_id.trim()
        : typeof entry?.inventory_item_id === "string" && entry.inventory_item_id.trim()
          ? (entry.inventory_item_id as string).trim()
          : "";
    const quantity = parseMovementQuantity(entry?.quantity ?? entry?.qty);
    if (!itemId || quantity === null) {
      return NextResponse.json(
        { error: "Каждый элемент items требует item_id (или inventory_item_id) и quantity > 0" },
        { status: 400 }
      );
    }
    const unit =
      typeof entry?.unit === "string" && entry.unit.trim() ? entry.unit.trim().slice(0, 50) : null;
    sent.push({ item_id: itemId, quantity, unit });
  }

  // --- Партия: ownership + статус-гейт (RA.11: списание только planned/in_progress) ---
  const { data: batchRow, error: batchErr } = await supabaseAdmin
    .from("recipe_production_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();
  if (batchErr) {
    console.error("[inventory/write-off] batch load failed:", batchErr.message);
    return NextResponse.json({ error: "Ошибка загрузки партии" }, { status: 500 });
  }
  if (!batchRow) {
    return NextResponse.json({ error: "Партия не найдена" }, { status: 404 });
  }
  const batch = batchRow as unknown as BatchRow;
  // Владение: владелец партии (админ склада — обход, как в order-пути)
  if (batch.owner_id !== actor.id && !isInventoryAdmin(actor)) {
    return NextResponse.json({ error: "Доступ только у владельца партии" }, { status: 403 });
  }
  if (batch.status === "completed") {
    return NextResponse.json(
      { error: "Партия уже завершена — повторное списание запрещено (уникальность batch_id)" },
      { status: 409 }
    );
  }
  if (batch.status === "cancelled") {
    return NextResponse.json({ error: "Партия отменена — списание запрещено" }, { status: 409 });
  }

  // --- Нормы из НЕИЗМЕНЯЕМОГО снапшота card_version (RB.15: списание без
  //     card_version запрещено; снапшот — источник норм версии, 0070:130-139) ---
  const { data: versionRow, error: verErr } = await supabaseAdmin
    .from("recipe_production_card_versions")
    .select("id, snapshot")
    .eq("id", batch.card_version_id)
    .maybeSingle();
  if (verErr) {
    console.error("[inventory/write-off] card version load failed:", verErr.message);
    return NextResponse.json({ error: "Ошибка загрузки версии карты" }, { status: 500 });
  }
  if (!versionRow) {
    return NextResponse.json({ error: "Версия карты партии не найдена" }, { status: 404 });
  }
  const snapshot = (versionRow as { snapshot: unknown }).snapshot as
    | { ingredients?: unknown }
    | null;
  const rawNorms = snapshot && Array.isArray(snapshot.ingredients) ? snapshot.ingredients : null;
  if (!rawNorms || rawNorms.length === 0) {
    console.error("[inventory/write-off] card version snapshot has no ingredients");
    return NextResponse.json(
      { error: "Снапшот версии карты не содержит норм — списание запрещено" },
      { status: 500 }
    );
  }
  const norms = new Map<string, BatchSnapshotNorm>();
  for (const rawNorm of rawNorms) {
    const n = rawNorm as Record<string, unknown>;
    if (typeof n.inventory_item_id !== "string" || !n.inventory_item_id) continue;
    const qtyPerUnit = Number(n.qty_per_unit);
    if (!Number.isFinite(qtyPerUnit) || qtyPerUnit <= 0) continue;
    norms.set(n.inventory_item_id, {
      inventory_item_id: n.inventory_item_id,
      qty_per_unit: qtyPerUnit,
      unit: typeof n.unit === "string" ? n.unit : "шт",
      waste_pct: Number(n.waste_pct) || 0,
      is_optional: n.is_optional === true,
    });
  }

  // --- Складские позиции (единицы/владение для конвертации и обогащения ответа) ---
  const normItemIds = [...norms.keys()];
  const { data: invRows, error: invErr } = await supabaseAdmin
    .from("inventory_items")
    .select("id, name, unit, owner_id")
    .in("id", normItemIds);
  if (invErr) {
    console.error("[inventory/write-off] inventory load failed:", invErr.message);
    return NextResponse.json({ error: "Ошибка загрузки склада" }, { status: 500 });
  }
  const invById = new Map(
    ((invRows ?? []) as Array<{ id: string; name: string | null; unit: string | null; owner_id: string }>).map(
      (i) => [i.id, i]
    )
  );

  // --- Валидация items против норм (planned_qty — из БД, не от клиента) ---
  const plannedQty = Number(batch.planned_qty);
  if (!Number.isFinite(plannedQty) || plannedQty <= 0) {
    return NextResponse.json({ error: "Некорректный объём партии" }, { status: 500 });
  }

  const seenItems = new Set<string>();
  const rpcItems: Array<{ item_id: string; quantity: number; unit?: string }> = [];
  const deviations: Array<{ item_id: string; expected: number; got: number; unit: string }> = [];

  for (const s of sent) {
    if (seenItems.has(s.item_id)) {
      return NextResponse.json(
        { error: `Дублирующаяся позиция в items: ${s.item_id}` },
        { status: 422 }
      );
    }
    seenItems.add(s.item_id);

    const norm = norms.get(s.item_id);
    if (!norm) {
      // Избыточный/чужой item: не входит в нормы версии карты
      return NextResponse.json(
        {
          error: "Позиция не входит в нормы партии (избыточный или чужой item)",
          inventory_item_id: s.item_id,
        },
        { status: 422 }
      );
    }

    // Приводим отправленное количество к единице НОРМЫ
    let sentInNormUnits = s.quantity;
    if (s.unit && s.unit.toLowerCase() !== norm.unit.toLowerCase()) {
      const conv = convertQty(s.quantity, s.unit, norm.unit);
      if (!conv.ok) {
        return NextResponse.json(
          {
            error: "Единица позиции не соизмерима с единицей нормы (масса↔объём не конвертируется)",
            inventory_item_id: s.item_id,
          },
          { status: 422 }
        );
      }
      sentInNormUnits = conv.qty;
    }

    // Ожидание: qty_per_unit × planned_qty с учётом потерь (RA.12.5)
    const waste = Math.min(Math.max(Number(norm.waste_pct) || 0, 0), 100);
    const expected = norm.qty_per_unit * (1 + waste / 100) * plannedQty;
    const tolerance = Math.max(expected * BATCH_QTY_TOLERANCE, BATCH_QTY_TOLERANCE_ABS);
    if (Math.abs(sentInNormUnits - expected) > tolerance) {
      deviations.push({
        item_id: s.item_id,
        expected: Math.round(expected * 1000) / 1000,
        got: Math.round(sentInNormUnits * 1000) / 1000,
        unit: norm.unit,
      });
      continue;
    }

    // Приводим количество к единице СКЛАДСКОЙ позиции (RPC сверяет unit с БД, 0071:203-206)
    const inv = invById.get(s.item_id);
    const itemUnit = inv?.unit ?? null;
    let rpcQty = sentInNormUnits;
    if (itemUnit && itemUnit.toLowerCase() !== norm.unit.toLowerCase()) {
      const conv = convertQty(sentInNormUnits, norm.unit, itemUnit);
      if (!conv.ok) {
        return NextResponse.json(
          {
            error: "Единица нормы не соизмерима с единицей складской позиции",
            inventory_item_id: s.item_id,
          },
          { status: 422 }
        );
      }
      rpcQty = conv.qty;
    }
    rpcItems.push({
      item_id: s.item_id,
      quantity: Math.round(rpcQty * 1_000_000) / 1_000_000,
      ...(itemUnit ? { unit: itemUnit } : {}),
    });
  }

  if (deviations.length > 0) {
    return NextResponse.json(
      {
        error:
          "Расхождение списания с нормами партии сверх допуска (5%): скорректируйте количества",
        deviations,
      },
      { status: 422 }
    );
  }

  // Обязательные (не optional) нормы должны присутствовать в списании:
  // партия списывается ОДИН раз (UNIQUE batch_id в 0071), частичная докатка
  // новым ключом не поддерживается — передаётся полный комплект обязательных норм.
  const missingRequired = [...norms.values()]
    .filter((n) => n.is_optional !== true && !seenItems.has(n.inventory_item_id))
    .map((n) => n.inventory_item_id);
  if (missingRequired.length > 0) {
    return NextResponse.json(
      {
        error: "Не все обязательные нормы переданы в списании",
        missing_inventory_item_ids: missingRequired,
      },
      { status: 422 }
    );
  }

  // --- signature + idempotency_key (СЕРВЕР, RA.11.2) ---
  const signature = batchSignature(
    rpcItems.map((i) => ({ item_id: i.item_id, quantity: i.quantity }))
  );
  const idempotencyKey = `pb:${batch.id}`;

  // --- RPC: ОДНА попытка; идемпотентная семантика внутри функции (RA.11.3) ---
  const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc(
    "apply_inventory_write_off_batch",
    {
      p_owner_id: batch.owner_id, // из БД (владелец партии), не от клиента
      p_items: rpcItems, // [{item_id, quantity, unit}] — формат 0071:105/182-184
      p_order_id: batch.order_id ?? null,
      p_batch_id: batch.id,
      p_idempotency_key: idempotencyKey,
      p_signature: signature,
    }
  ) as unknown as { data: RpcWriteOffResult | null; error: (Error & { code?: string }) | null };

  if (rpcErr && (rpcErr as { code?: string }).code === "PGRST202") {
    // fail-closed: RPC отсутствует — списание НЕ выполняем небезопасным путём
    console.error(
      "[inventory/write-off] apply_inventory_write_off_batch RPC отсутствует — fail-closed (примените миграцию 0071)"
    );
    return NextResponse.json(
      { error: "Списание партии недоступно (примените миграцию 0071)" },
      { status: 500 }
    );
  }
  if (rpcErr) {
    const mapped = batchRpcErrorToResponse(rpcErr.message);
    console.error("[inventory/write-off] batch RPC failed:", rpcErr.message);
    // Любая ошибка позиции = полный откат в БД (ни движений, ни реестра) — RA.11.4
    return NextResponse.json({ error: mapped.error, batch_id: batch.id }, { status: mapped.status });
  }
  if (!rpcData) {
    console.error("[inventory/write-off] batch RPC returned no data");
    return NextResponse.json({ error: "Не удалось выполнить списание партии" }, { status: 500 });
  }

  const appliedRaw = rpcData.result?.applied ?? [];
  const applied = appliedRaw.map((a) => ({
    item_id: a.item_id,
    item_name: invById.get(a.item_id)?.name ?? null,
    movement_id: a.movement_id,
    quantity: Number(a.quantity),
    remaining: Number(a.new_qty),
    unit: invById.get(a.item_id)?.unit ?? null,
  }));

  return NextResponse.json(
    {
      batch_id: batch.id,
      card_version_id: batch.card_version_id,
      order_id: batch.order_id ?? null,
      applied,
      write_off_id: rpcData.write_off_id ?? null,
      idempotent: rpcData.idempotent === true,
      ...(rpcData.idempotent === true
        ? { message: "Списание этой партии уже было выполнено ранее (идемпотентный replay)" }
        : {}),
    },
    { status: rpcData.idempotent === true ? 200 : 201 }
  );
}
