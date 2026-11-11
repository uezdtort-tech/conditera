/**
 * write-off-validation.ts — серверная валидация количеств order-списания
 * против зафиксированного snapshot потребности заказа (Z-v30, Этап 5).
 *
 * ПРОБЛЕМА (зафиксирована Z-v29 §12 как последующий шаг): order-путь
 * POST /api/inventory/write-off (миграции 0048/0049) принимает произвольные
 * количества от клиента — идемпотентность (реестр по owner+order+signature)
 * дедуплицирует ПОВТОРЫ, но не связывает количество списания с потребностью
 * заказа. UI-префилл берётся из breakdown (snapshot), однако API доверяет
 * клиентскому числу: расхождение snapshot↔списание оставалось не проверяемым.
 *
 * РЕШЕНИЕ (минимальное, без изменения контракта 0048/0049 и без миграций):
 *   • order-списание по заказу СО snapshot валидируется против норматива:
 *     ожидаемое количество позиции склада = Σ (норма на 1 ед. × количество
 *     единиц товара) из metadata.acceptance_snapshot, переведённая в единицу
 *     складской позиции той же convertQty (src/lib/ops/units), что и breakdown;
 *   • из ожидаемого вычитается УЖЕ списанное по этому заказу (реестр
 *     inventory_write_offs, quantities в единицах склада) — прогрессивное
 *     списание частями остаётся рабочим, кумулятивное превышение блокируется;
 *   • расхождение (превышение / позиция вне состава snapshot / несовместимые
 *     единицы) → 422 с отклонениями; явное подтверждение оператора
 *     (allow_overage: true в теле запроса) пропускает списание как РУЧНУЮ
 *     корректировку: причина обязана быть в журнале движений (reason
 *     помечается), snapshot заказа НЕ переписывается;
 *   • легаси-заказ БЕЗ snapshot → прежнее поведение (валидации нет, явный
 *     режим "legacy" — история не выдумывается, текущий рецепт не подставляется);
 *   • повреждённый snapshot → SNAPSHOT_INVALID (fail-closed), списание по
 *     заказу не выполняется небезопасным путём; ручные корректировки вне
 *     заказа остаются доступны через POST /api/inventory/movements.
 *
 * Это НЕ бизнес-допуск: дельта 1e-6 — погрешность округления convertQty
 * (round6)/UI, а не разрешённое отклонение от норматива. Новый норматив
 * допуска (аналог 5% партийного пути) не вводится.
 */

import { getPool } from "@/lib/postgrest/pool";
import { convertQty } from "./units";
import {
  readAcceptanceSnapshot,
  validateSnapshotCoversOrder,
  type AcceptanceSnapshot,
} from "./snapshot";

/** Погрешность округления (не бизнес-допуск): round6 в convertQty + UI 1e-6. */
export const WRITE_OFF_ROUNDING_EPSILON = 1e-6;

export interface WriteOffDeviation {
  item_id: string;
  kind: "not_in_snapshot" | "unit_mismatch" | "overage";
  /** Ожидаемый доступный к списанию остаток норматива (единицы склада). */
  expected_remaining?: number | null;
  /** Переданное количество (единицы склада). */
  got?: number;
}

export interface SnapshotWriteOffValidation {
  /** "snapshot" — валидация выполнена; "legacy" — заказа/снапшота нет, пропуск. */
  mode: "snapshot" | "legacy";
  deviations: WriteOffDeviation[];
}

export type WriteOffValidationResult =
  | { ok: true; validation: SnapshotWriteOffValidation }
  | { ok: false; code: "SNAPSHOT_INVALID"; message: string };

/** Маркер позиции, чей норматив не переводим в единицу склада (fail-closed). */
const UNIT_MISMATCH = "UNIT_MISMATCH" as const;

/**
 * Провалидировать количества order-списания против snapshot заказа.
 * Читает: заказ (metadata, confectioner_id) → order_items (покрытие) →
 * активный склад владельца → реестр inventory_write_offs (уже списанное).
 */
export async function validateOrderWriteOffAgainstSnapshot(input: {
  orderId: string;
  /** Actor (для резолва склада, если у заказа нет confectioner_id). */
  actorId: string;
  items: Array<{ item_id: string; quantity: number }>;
}): Promise<WriteOffValidationResult> {
  const pool = getPool();

  // 1. Заказ: metadata + владелец склада.
  const orderRes = await pool.query<{
    confectioner_id: string | null;
    metadata: string | null;
  }>(
    `SELECT confectioner_id::text, metadata::text AS metadata
     FROM public.orders WHERE id = $1::uuid`,
    [input.orderId]
  );
  const orderRow = orderRes.rows[0];
  if (!orderRow) {
    // Заказ не найден — сохраняем прежнее поведение (order_path не проверял
    // существование заказа); валидировать нечего (нет snapshot) → legacy.
    return { ok: true, validation: { mode: "legacy", deviations: [] } };
  }

  let metadata: unknown = null;
  if (orderRow.metadata) {
    try {
      metadata = JSON.parse(orderRow.metadata);
    } catch {
      metadata = null;
    }
  }
  const parsed = readAcceptanceSnapshot(metadata);
  if (parsed.status === "absent") {
    // Легаси-заказ: нормативов нет — прежнее поведение, явная пометка режима.
    return { ok: true, validation: { mode: "legacy", deviations: [] } };
  }
  if (parsed.status === "invalid") {
    return {
      ok: false,
      code: "SNAPSHOT_INVALID",
      message: `Повреждён snapshot производственного состава заказа (${parsed.reason}) — нормативное списание заблокировано (fail-closed). Ручные корректировки — через /api/inventory/movements.`,
    };
  }
  const snapshot: AcceptanceSnapshot = parsed.snapshot;

  // 2. Покрытие: snapshot принадлежит ЭТОМУ заказу (товары и количества).
  const itemsRes = await pool.query<{
    product_id: string | null;
    quantity: number | string | null;
  }>(
    `SELECT product_id::text, quantity
     FROM public.order_items WHERE order_id = $1::uuid`,
    [input.orderId]
  );
  const orderProductItems = itemsRes.rows
    .filter((r) => r.product_id !== null)
    .map((r) => ({
      product_id: r.product_id as string,
      quantity: Number(r.quantity ?? 0),
    }));
  const coverage = validateSnapshotCoversOrder(snapshot, orderProductItems);
  if (!coverage.ok) {
    return {
      ok: false,
      code: "SNAPSHOT_INVALID",
      message: `Snapshot не соответствует позициям заказа (${coverage.reason}) — нормативное списание заблокировано (fail-closed).`,
    };
  }

  // 3. Активный склад владельца заказа (резолв норм по id/имени — строгий
  //    контракт breakdown: inventory_item_id, иначе точное имя).
  const ownerId = orderRow.confectioner_id ?? input.actorId;
  const invRes = await pool.query<{
    id: string;
    name: string;
    unit: string | null;
  }>(
    `SELECT id::text, name, unit
     FROM public.inventory_items
     WHERE owner_id = $1::uuid AND is_active`,
    [ownerId]
  );
  const invById = new Map(invRes.rows.map((r) => [r.id, r]));
  const invByName = new Map(
    invRes.rows.map((r) => [r.name.trim().toLowerCase(), r])
  );

  // 4. Ожидаемый норматив по позициям склада (единицы склада).
  //    Per-item (inventory item): складываем переведённые вклады всех норм,
  //    назначенных на эту позицию (напрямую или по имени).
  const expected = new Map<string, number | typeof UNIT_MISMATCH>();
  const addToExpected = (itemId: string, qty: number) => {
    const cur = expected.get(itemId);
    if (cur === UNIT_MISMATCH) return;
    expected.set(itemId, (cur ?? 0) + qty);
  };
  for (const snapItem of snapshot.items) {
    for (const norm of snapItem.ingredients) {
      const inv = norm.inventory_item_id
        ? invById.get(norm.inventory_item_id) ?? null
        : invByName.get(norm.name.trim().toLowerCase()) ?? null;
      if (!inv) continue; // позиция не на складе — в expected не входит (no_stock)
      const contribution = norm.qty * snapItem.quantity; // норма на 1 ед. × кол-во
      const converted = convertQty(contribution, norm.unit, inv.unit ?? "шт");
      if (converted === null) {
        expected.set(inv.id, UNIT_MISMATCH);
        continue;
      }
      addToExpected(inv.id, converted);
    }
  }

  // 5. Уже списанное по этому заказу (реестр 0049/0071; quantities в единицах
  //    склада — order-путь шлёт количества в единицах склада, batch-RPC
  //    конвертирует в единицу складской позиции до применения).
  const regRes = await pool.query<{ items: unknown }>(
    `SELECT items
     FROM public.inventory_write_offs
     WHERE owner_id = $1::uuid AND order_id = $2::uuid`,
    [ownerId, input.orderId]
  );
  const already = new Map<string, number>();
  for (const row of regRes.rows) {
    if (!Array.isArray(row.items)) continue;
    for (const raw of row.items) {
      const it = raw as { item_id?: unknown; quantity?: unknown };
      if (typeof it?.item_id !== "string" || typeof it?.quantity !== "number") continue;
      if (!Number.isFinite(it.quantity)) continue;
      already.set(it.item_id, (already.get(it.item_id) ?? 0) + it.quantity);
    }
  }

  // 6. Проверка переданных позиций.
  const deviations: WriteOffDeviation[] = [];
  for (const submitted of input.items) {
    const exp = expected.get(submitted.item_id);
    if (exp === undefined) {
      deviations.push({
        item_id: submitted.item_id,
        kind: "not_in_snapshot",
        expected_remaining: null,
        got: submitted.quantity,
      });
      continue;
    }
    if (exp === UNIT_MISMATCH) {
      deviations.push({
        item_id: submitted.item_id,
        kind: "unit_mismatch",
        expected_remaining: null,
        got: submitted.quantity,
      });
      continue;
    }
    const remaining = exp - (already.get(submitted.item_id) ?? 0);
    if (submitted.quantity > remaining + WRITE_OFF_ROUNDING_EPSILON) {
      deviations.push({
        item_id: submitted.item_id,
        kind: "overage",
        expected_remaining: Math.max(0, Math.round(remaining * 1e6) / 1e6),
        got: submitted.quantity,
      });
    }
  }

  return { ok: true, validation: { mode: "snapshot", deviations } };
}
