/**
 * purchase-orders.ts — серверная бизнес-логика закупочных заказов (Z-v17).
 *
 * Единое место истины для:
 *  - матрицы статусных переходов (buyer/supplier) с CAS-обновлением;
 *  - атомарного резерва остатков supplier_products (SELECT ... FOR UPDATE);
 *  - идемпотентного создания заказа (idempotency_key + partial unique index);
 *  - журнала движений supplier_product_movements (RESERVE/RELEASE/OUT);
 *  - истории статусов purchase_order_status_history.
 *
 * Финансовые значения — целые копейки. Плавающая точка не используется.
 * Резерв: при SUBMITTED (жёсткий), освобождение при REJECTED/CANCELLED,
 * списание при DELIVERED (release + OUT).
 */
import { getPool } from "@/lib/postgrest/pool";
import type { Template } from "@/lib/notifications";

export type PurchaseOrderStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "CONFIRMED"
  | "REJECTED"
  | "PROCESSING"
  | "READY_FOR_SHIPMENT"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "DISPUTED";

export type Party = "buyer" | "supplier" | "admin";

/** Действия сторон (HTTP-агностично; route.ts мапит на ответы). */
export type OrderAction =
  | "submit"
  | "confirm"
  | "reject"
  | "process"
  | "ready_for_shipment"
  | "ship"
  | "confirm_delivery"
  | "cancel"
  | "dispute";

/** Матрица: party → action → допустимые исходные статусы. */
export const ACTION_TRANSITIONS: Record<
  Party,
  Partial<Record<OrderAction, PurchaseOrderStatus[]>>
> = {
  buyer: {
    submit: ["DRAFT"],
    cancel: ["DRAFT", "SUBMITTED", "CONFIRMED"],
    confirm_delivery: ["SHIPPED"],
    dispute: ["CONFIRMED", "PROCESSING", "READY_FOR_SHIPMENT", "SHIPPED"],
  },
  supplier: {
    confirm: ["SUBMITTED"],
    reject: ["SUBMITTED"],
    process: ["CONFIRMED"],
    ready_for_shipment: ["PROCESSING"],
    ship: ["READY_FOR_SHIPMENT"],
    dispute: ["CONFIRMED", "PROCESSING", "READY_FOR_SHIPMENT", "SHIPPED"],
  },
  admin: {
    // Администратор не вмешивается в статусную машину v17 (только просмотр).
  },
};

/** Целевой статус для действия. */
export const ACTION_TARGET: Record<OrderAction, PurchaseOrderStatus> = {
  submit: "SUBMITTED",
  confirm: "CONFIRMED",
  reject: "REJECTED",
  process: "PROCESSING",
  ready_for_shipment: "READY_FOR_SHIPMENT",
  ship: "SHIPPED",
  confirm_delivery: "DELIVERED",
  cancel: "CANCELLED",
  dispute: "DISPUTED",
};

export interface CreateOrderInput {
  supplierId: string;
  items: { productId: string; quantity: number }[];
  buyerComment?: string;
  deliveryMethod?: "delivery" | "pickup";
  deliveryAddress?: string;
  requestedDeliveryDate?: string;
  sourceOrderId?: string;
  idempotencyKey?: string;
}

export type CreateOrderResult =
  | {
      ok: true;
      order: {
        id: string;
        number: string;
        status: PurchaseOrderStatus;
        subtotal: number;
        items: {
          productId: string;
          productName: string;
          unit: string;
          quantity: number;
          unitPrice: number;
          lineTotal: number;
        }[];
      };
      existing?: boolean;
    }
  | { ok: false; httpStatus: number; error: string; details?: unknown };

type Row = Record<string, unknown>;

function fail(httpStatus: number, error: string, details?: unknown): CreateOrderResult {
  return { ok: false, httpStatus, error, details };
}

/** Валидация кратности: quantity = min_order_qty + k * order_step, k >= 0. */
export function isQuantityCompliant(
  quantity: number,
  minOrderQty: number,
  orderStep: number
): boolean {
  if (!Number.isInteger(quantity) || quantity < 1) return false;
  const moq = Math.max(1, minOrderQty || 1);
  const step = Math.max(1, orderStep || 1);
  if (quantity < moq) return false;
  return (quantity - moq) % step === 0;
}

/** Генерация номера заказа выполняется в БД через sequence (гонкобезопасно). */

/**
 * Создание закупочного заказа.
 * Транзакция: блокировка товаров поставщика (FOR UPDATE), проверка
 * публикации/одобрения поставщика/MOQ/кратности/остатка, резерв, вставка
 * заказа + позиций (snapshot цены) + истории.
 * Идемпотентность: idempotency_key + partial unique index; при гонке 23505
 * возвращается уже созданный заказ (existing: true).
 */
export async function createPurchaseOrder(
  buyerId: string,
  input: CreateOrderInput
): Promise<CreateOrderResult> {
  if (!input?.supplierId || typeof input.supplierId !== "string") {
    return fail(400, "Укажите supplierId");
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return fail(400, "Список товаров пуст");
  }
  if (input.items.length > 50) {
    return fail(400, "Слишком много позиций (максимум 50)");
  }
  for (const it of input.items) {
    if (!it?.productId || !Number.isInteger(it.quantity) || it.quantity < 1) {
      return fail(400, "Некорректная позиция заказа");
    }
  }
  const method = input.deliveryMethod ?? "delivery";
  if (!["delivery", "pickup"].includes(method)) {
    return fail(400, "Недопустимый способ получения");
  }
  if (method === "delivery" && !input.deliveryAddress?.trim()) {
    return fail(400, "Для доставки укажите адрес");
  }
  if (input.deliveryMethod === "pickup" && !input.supplierId) {
    return fail(400, "Укажите поставщика");
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    // Идемпотентный повтор: заказ с таким ключом уже существует.
    if (input.idempotencyKey) {
      const existing = await client.query(
        `SELECT id, number, status::text AS status, subtotal
           FROM purchase_orders WHERE idempotency_key = $1 AND buyer_id = $2 LIMIT 1`,
        [input.idempotencyKey, buyerId]
      );
      if (existing.rows[0]) {
        const order = existing.rows[0] as Record<string, any>;
        const items = await client.query(
          `SELECT product_id, product_name, unit, quantity, unit_price, line_total
             FROM purchase_order_items WHERE order_id = $1 ORDER BY created_at`,
          [order.id]
        );
        return {
          ok: true,
          existing: true,
          order: {
            id: order.id,
            number: order.number,
            status: order.status,
            subtotal: order.subtotal,
            items: items.rows.map((r: Row) => ({
              productId: String(r.product_id),
              productName: String(r.product_name),
              unit: String(r.unit),
              quantity: Number(r.quantity),
              unitPrice: Number(r.unit_price),
              lineTotal: Number(r.line_total),
            })),
          },
        };
      }
    }

    await client.query("BEGIN");

    // Поставщик должен быть одобрен и активен.
    const supplier = await client.query(
      `SELECT id, "userId", "companyName", "verificationStatus", "isActive"
         FROM supplier_profiles WHERE "userId" = $1 LIMIT 1 FOR UPDATE`,
      [input.supplierId]
    );
    const sup = supplier.rows[0];
    if (!sup) return await rollbackWith(client, fail(404, "Поставщик не найден"));
    if (sup.verificationStatus !== "approved" || !sup.isActive) {
      return await rollbackWith(client, fail(409, "Поставщик недоступен для заказов"));
    }
    // Самозаказ поставщика у себя запрещён на уровне buyer≠supplier.
    if (input.supplierId === buyerId) {
      return await rollbackWith(client, fail(409, "Нельзя оформить закупку у себя"));
    }

    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const locked = await client.query(
      `SELECT id, product_name, unit, price, quantity, reserved_quantity,
              min_order_qty, order_step, status, is_active
         FROM supplier_products
        WHERE id = ANY($1::uuid[]) AND supplier_id = $2
        FOR UPDATE`,
      [productIds, input.supplierId]
    );
    const byId = new Map<string, Row>(
      locked.rows.map((r: Row) => [String(r.id), r])
    );

    interface PreparedLine {
      productId: string;
      productName: string;
      unit: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
    }
    const lines: PreparedLine[] = [];
    let subtotal = 0;

    for (const it of input.items) {
      const p = byId.get(it.productId);
      if (!p) {
        return await rollbackWith(
          client,
          fail(404, `Товар ${it.productId} не найден у этого поставщика`)
        );
      }
      if (p.status !== "published" || p.is_active !== true) {
        return await rollbackWith(
          client,
          fail(409, `Товар «${p.product_name}» недоступен для заказа`)
        );
      }
      if (!isQuantityCompliant(it.quantity, Number(p.min_order_qty), Number(p.order_step))) {
        return await rollbackWith(
          client,
          fail(
            409,
            `Количество для «${p.product_name}» должно быть от ${p.min_order_qty} ${p.unit} с шагом ${p.order_step}`
          )
        );
      }
      const available = Number(p.quantity) - Number(p.reserved_quantity);
      if (it.quantity > available) {
        return await rollbackWith(
          client,
          fail(409, `Недостаточно остатка «${p.product_name}»: доступно ${available} ${p.unit}`)
        );
      }
      const unitPrice = Number(p.price); // серверная цена, клиентская не доверяется
      const lineTotal = unitPrice * it.quantity;
      subtotal += lineTotal;
      lines.push({
        productId: it.productId,
        productName: String(p.product_name),
        unit: String(p.unit),
        quantity: it.quantity,
        unitPrice,
        lineTotal,
      });
    }

    // Резерв (жёсткий, в рамках транзакции).
    for (const line of lines) {
      const upd = await client.query(
        `UPDATE supplier_products
            SET reserved_quantity = reserved_quantity + $2, updated_at = NOW()
          WHERE id = $1 AND quantity - reserved_quantity >= $2
          RETURNING id`,
        [line.productId, line.quantity]
      );
      if (upd.rowCount === 0) {
        return await rollbackWith(
          client,
          fail(409, `Остаток изменился, повторите заказ (товар «${line.productName}»)`)
        );
      }
    }

    // Номер заказа через sequence (гонка безопасна).
    const seq = await client.query(
      `SELECT 'PO-' || to_char(NOW(), 'YYYY') || '-' ||
              lpad(nextval('purchase_orders_number_seq')::text, 4, '0') AS num`
    );
    const number = String(seq.rows[0]?.num ?? "");
    if (!number) {
      return await rollbackWith(client, fail(500, "Не удалось сгенерировать номер заказа"));
    }

    const inserted = await client.query(
      `INSERT INTO purchase_orders
         (number, buyer_id, supplier_id, status, buyer_comment, delivery_method,
          delivery_address, requested_delivery_date, source_order_id,
          idempotency_key, subtotal)
       VALUES ($1,$2,$3,'SUBMITTED',$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, number, status::text AS status, subtotal`,
      [
        number,
        buyerId,
        input.supplierId,
        input.buyerComment?.slice(0, 2000) ?? null,
        method,
        method === "delivery" ? input.deliveryAddress?.slice(0, 500) ?? null : null,
        input.requestedDeliveryDate || null,
        input.sourceOrderId || null,
        input.idempotencyKey || null,
        subtotal,
      ]
    );
    const order = inserted.rows[0] as Record<string, any>;

    for (const line of lines) {
      await client.query(
        `INSERT INTO purchase_order_items
           (order_id, product_id, product_name, unit, quantity, unit_price, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          order.id,
          line.productId,
          line.productName,
          line.unit,
          line.quantity,
          line.unitPrice,
          line.lineTotal,
        ]
      );
      await client.query(
        `INSERT INTO supplier_product_movements
           (product_id, supplier_id, type, quantity, order_id, reason, created_by)
         VALUES ($1,$2,'RESERVE',$3,$4,'Закупочный заказ',$5)`,
        [line.productId, input.supplierId, line.quantity, order.id, buyerId]
      );
    }

    await client.query(
      `INSERT INTO purchase_order_status_history
         (order_id, from_status, to_status, changed_by, changed_by_role, comment)
       VALUES ($1, NULL, 'SUBMITTED', $2, 'buyer', $3)`,
      [order.id, buyerId, "Заказ оформлен"]
    );

    await client.query("COMMIT");

    return {
      ok: true,
      order: {
        id: order.id,
        number: order.number,
        status: order.status,
        subtotal: Number(order.subtotal),
        items: lines,
      },
    };
  } catch (e: any) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* noop */
    }
    // Гонка идемпотентности: уникальный индекс.
    if (e?.code === "23505" && input.idempotencyKey) {
      const existing = await client.query(
        `SELECT id, number, status::text AS status, subtotal
           FROM purchase_orders WHERE idempotency_key = $1 AND buyer_id = $2 LIMIT 1`,
        [input.idempotencyKey, buyerId]
      );
      if (existing.rows[0]) {
        const o = existing.rows[0] as Record<string, any>;
        const items = await client.query(
          `SELECT product_id, product_name, unit, quantity, unit_price, line_total
             FROM purchase_order_items WHERE order_id = $1 ORDER BY created_at`,
          [o.id]
        );
        return {
          ok: true,
          existing: true,
          order: {
            id: o.id,
            number: o.number,
            status: o.status,
            subtotal: Number(o.subtotal),
            items: items.rows.map((r: Row) => ({
              productId: String(r.product_id),
              productName: String(r.product_name),
              unit: String(r.unit),
              quantity: Number(r.quantity),
              unitPrice: Number(r.unit_price),
              lineTotal: Number(r.line_total),
            })),
          },
        };
      }
    }
    return fail(500, "Ошибка создания заказа", e?.message);
  } finally {
    client.release();
  }
}

async function rollbackWith(
  client: { query: (sql: string) => Promise<unknown> },
  result: CreateOrderResult
): Promise<CreateOrderResult> {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* noop */
  }
  return result;
}

/**
 * Освободить резерв по заказу (REJECTED / CANCELLED).
 * Количество к освобождению = SUM(RESERVE) - SUM(RELEASE) - SUM(OUT) по movements.
 * Возвращает освобождённые позиции или ошибку.
 */
export async function releaseReservationForOrder(
  client: { query: (sql: string, params?: unknown[]) => Promise<any> },
  orderId: string,
  actorId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  // FOR UPDATE несовместим с GROUP BY — агрегат резерва вынесен в подзапрос.
  const items = await client.query(
    `SELECT poi.id, poi.product_id, poi.quantity, sp.supplier_id,
            COALESCE((SELECT SUM(CASE m.type WHEN 'RESERVE' THEN m.quantity
                                             WHEN 'RELEASE' THEN -m.quantity
                                             WHEN 'OUT' THEN -m.quantity ELSE 0 END)
                        FROM supplier_product_movements m
                       WHERE m.order_id = $1 AND m.product_id = poi.product_id), 0) AS reserved_now
       FROM purchase_order_items poi
       JOIN supplier_products sp ON sp.id = poi.product_id
      WHERE poi.order_id = $1
      FOR UPDATE OF sp`,
    [orderId]
  );
  for (const it of items.rows) {
    const reserved = Number(it.reserved_now);
    if (reserved > 0) {
      const upd = await client.query(
        `UPDATE supplier_products
            SET reserved_quantity = GREATEST(reserved_quantity - $2, 0), updated_at = NOW()
          WHERE id = $1 RETURNING id`,
        [it.product_id, reserved]
      );
      if (upd.rowCount === 0) {
        return { ok: false, error: `Не удалось освободить резерв товара ${it.product_id}` };
      }
      await client.query(
        `INSERT INTO supplier_product_movements
           (product_id, supplier_id, type, quantity, order_id, reason, created_by)
         VALUES ($1,$2,'RELEASE',$3,$4,'Резерв освобождён',$5)`,
        [it.product_id, it.supplier_id, reserved, orderId, actorId]
      );
    }
  }
  return { ok: true };
}

/**
 * Списание при доставке (DELIVERED): release резерва + OUT со склада
 * по согласованным количествам (confirmed_quantity ?? quantity).
 */
export async function writeOffDeliveredOrder(
  client: { query: (sql: string, params?: unknown[]) => Promise<any> },
  orderId: string,
  actorId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const items = await client.query(
    `SELECT poi.id, poi.product_id,
            COALESCE(poi.confirmed_quantity, poi.quantity) AS qty,
            sp.supplier_id,
            COALESCE((SELECT SUM(CASE m.type WHEN 'RESERVE' THEN m.quantity
                                             WHEN 'RELEASE' THEN -m.quantity
                                             WHEN 'OUT' THEN -m.quantity ELSE 0 END)
                        FROM supplier_product_movements m
                       WHERE m.order_id = $1 AND m.product_id = poi.product_id), 0) AS reserved_now
       FROM purchase_order_items poi
       JOIN supplier_products sp ON sp.id = poi.product_id
      WHERE poi.order_id = $1
      FOR UPDATE OF sp`,
    [orderId]
  );
  for (const it of items.rows) {
    const qty = Number(it.qty);
    const reserved = Number(it.reserved_now);
    if (reserved > 0) {
      const rel = await client.query(
        `UPDATE supplier_products
            SET reserved_quantity = GREATEST(reserved_quantity - $2, 0), updated_at = NOW()
          WHERE id = $1 RETURNING id`,
        [it.product_id, reserved]
      );
      if (rel.rowCount === 0) {
        return { ok: false, error: `Ошибка освобождения резерва ${it.product_id}` };
      }
      await client.query(
        `INSERT INTO supplier_product_movements
           (product_id, supplier_id, type, quantity, order_id, reason, created_by)
         VALUES ($1,$2,'RELEASE',$3,$4,'Доставлено: резерв снят',$5)`,
        [it.product_id, it.supplier_id, reserved, orderId, actorId]
      );
    }
    const out = await client.query(
      `UPDATE supplier_products
          SET quantity = quantity - $2, updated_at = NOW()
        WHERE id = $1 AND quantity >= $2 RETURNING id`,
      [it.product_id, qty]
    );
    if (out.rowCount === 0) {
      return { ok: false, error: `Недостаточно остатка для списания ${it.product_id}` };
    }
    await client.query(
      `INSERT INTO supplier_product_movements
         (product_id, supplier_id, type, quantity, order_id, reason, created_by)
       VALUES ($1,$2,'OUT',$3,$4,'Доставлено: списание',$5)`,
      [it.product_id, it.supplier_id, qty, orderId, actorId]
    );
  }
  return { ok: true };
}

export interface TransitionParams {
  orderId: string;
  actorId: string;
  actorParty: Party;
  actorRole: string; // для истории
  action: OrderAction;
  comment?: string;
  rejectionReason?: string;
  promisedShipmentDate?: string;
  /** Подтверждение с корректировкой количеств: [{itemId, quantity}] */
  confirmedItems?: { itemId: string; quantity: number }[];
}

export type TransitionResult =
  | {
      ok: true;
      order: { id: string; number: string; status: PurchaseOrderStatus };
      notifiedUserId?: string;
      supplierId: string;
      buyerId: string;
    }
  | { ok: false; httpStatus: number; error: string; details?: unknown };

/**
 * Смена статуса с CAS: UPDATE ... WHERE id = $1 AND status = ANY($expected).
 * Проигравший гонку получает 409. Побочные эффекты (резерв/освобождение/
 * списание) выполняются в той же транзакции, что и смена статуса.
 */
export async function transitionPurchaseOrder(
  params: TransitionParams
): Promise<TransitionResult> {
  const { orderId, actorId, actorParty, actorRole, action } = params;
  const allowedFrom = ACTION_TRANSITIONS[actorParty]?.[action];
  const target = ACTION_TARGET[action];
  if (!allowedFrom || allowedFrom.length === 0) {
    return { ok: false, httpStatus: 403, error: "Действие недоступно для вашей роли" };
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Блокируем заказ и проверяем сторону.
    const locked = await client.query(
      `SELECT id, number, buyer_id, supplier_id, status::text AS status
         FROM purchase_orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const order = locked.rows[0] as Record<string, any>;
    if (!order) {
      await client.query("ROLLBACK");
      return { ok: false, httpStatus: 404, error: "Заказ не найден" };
    }
    const isBuyer = order.buyer_id === actorId;
    const isSupplier = order.supplier_id === actorId;
    const isAdmin = actorParty === "admin";
    if (!isBuyer && !isSupplier && !isAdmin) {
      await client.query("ROLLBACK");
      return { ok: false, httpStatus: 403, error: "Нет доступа к заказу" };
    }
    const party: Party = isAdmin ? "admin" : isBuyer ? "buyer" : "supplier";

    const fromList = ACTION_TRANSITIONS[party]?.[action];
    if (!fromList?.includes(order.status as PurchaseOrderStatus)) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        httpStatus: 409,
        error: `Действие «${action}» недопустимо из статуса ${order.status}`,
      };
    }

    // Подтверждение с корректировкой количеств (поставщик).
    let confirmedSubtotal: number | null = null;
    if (action === "confirm" && params.confirmedItems?.length) {
      const items = await client.query(
        `SELECT poi.id, poi.quantity, poi.unit_price, poi.line_total,
                COALESCE((SELECT SUM(CASE m.type WHEN 'RESERVE' THEN m.quantity
                                                 WHEN 'RELEASE' THEN -m.quantity
                                                 WHEN 'OUT' THEN -m.quantity ELSE 0 END)
                            FROM supplier_product_movements m
                           WHERE m.order_id = $1 AND m.product_id = poi.product_id), 0) AS reserved_now
           FROM purchase_order_items poi
           JOIN supplier_products sp ON sp.id = poi.product_id
          WHERE poi.order_id = $1 FOR UPDATE OF sp`,
        [orderId]
      );
      const byItemId = new Map(params.confirmedItems.map((c) => [c.itemId, c.quantity]));
      let sum = 0;
      for (const it of items.rows) {
        const requested = byItemId.get(String(it.id));
        // Не указанная в корректировке позиция подтверждается полностью.
        const confirmed =
          requested === undefined ? Number(it.quantity) : Number(requested);
        if (
          !Number.isInteger(confirmed) ||
          confirmed < 0 ||
          confirmed > Number(it.quantity)
        ) {
          await client.query("ROLLBACK");
          return {
            ok: false,
            httpStatus: 400,
            error: `Некорректное согласованное количество для позиции ${it.id}`,
          };
        }
        const reservedNow = Number(it.reserved_now);
        const diff = reservedNow - confirmed;
        if (diff > 0) {
          // Поставщик не может исполнить полностью — освобождаем разницу.
          const upd = await client.query(
            `UPDATE supplier_products
                SET reserved_quantity = GREATEST(reserved_quantity - $2, 0), updated_at = NOW()
              WHERE id = (
                SELECT product_id FROM purchase_order_items WHERE id = $1
              ) RETURNING id`,
            [it.id, diff]
          );
          if (upd.rowCount === 0) {
            await client.query("ROLLBACK");
            return { ok: false, httpStatus: 409, error: "Ошибка корректировки резерва" };
          }
          await client.query(
            `INSERT INTO supplier_product_movements
               (product_id, supplier_id, type, quantity, order_id, reason, created_by)
             SELECT product_id, (SELECT supplier_id FROM purchase_orders WHERE id = $1),
                    'RELEASE', $3, $1, 'Подтверждение: корректировка объёма', $2
               FROM purchase_order_items WHERE id = $4`,
            [orderId, actorId, diff, it.id]
          );
        }
        if (confirmed > 0) {
          await client.query(
            `UPDATE purchase_order_items SET confirmed_quantity = $2 WHERE id = $1`,
            [it.id, confirmed]
          );
          sum += confirmed * Number(it.unit_price);
        }
      }
      confirmedSubtotal = sum;
    }

    // CAS-обновление статуса.
    const cas = await client.query(
      `UPDATE purchase_orders SET
          status = $2::purchase_order_status,
          updated_at = NOW(),
          confirmed_at = CASE WHEN $2 = 'CONFIRMED' THEN NOW() ELSE confirmed_at END,
          rejected_at = CASE WHEN $2 = 'REJECTED' THEN NOW() ELSE rejected_at END,
          shipped_at = CASE WHEN $2 = 'SHIPPED' THEN NOW() ELSE shipped_at END,
          delivered_at = CASE WHEN $2 = 'DELIVERED' THEN NOW() ELSE delivered_at END,
          cancelled_at = CASE WHEN $2 = 'CANCELLED' THEN NOW() ELSE cancelled_at END,
          rejection_reason = CASE WHEN $2 = 'REJECTED' THEN $4::text ELSE rejection_reason END,
          supplier_comment = CASE WHEN $5::text IS NOT NULL THEN $5::text ELSE supplier_comment END,
          promised_shipment_date = COALESCE($6::date, promised_shipment_date),
          confirmed_subtotal = COALESCE($7::integer, confirmed_subtotal)
        WHERE id = $1 AND status::text = ANY($3::text[])
        RETURNING id, number, status::text AS status, buyer_id, supplier_id`,
      [
        orderId,
        target,
        fromList,
        params.rejectionReason?.slice(0, 2000) ?? null,
        action === "confirm" || action === "ship" ? params.comment?.slice(0, 2000) ?? null : null,
        params.promisedShipmentDate || null,
        confirmedSubtotal,
      ]
    );
    if (cas.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, httpStatus: 409, error: "Статус изменён другим запросом" };
    }
    const updated = cas.rows[0] as Record<string, any>;

    // Побочные эффекты в той же транзакции.
    if (action === "reject" || action === "cancel") {
      const rel = await releaseReservationForOrder(client, orderId, actorId);
      if (!rel.ok) {
        await client.query("ROLLBACK");
        return { ok: false, httpStatus: 409, error: rel.error };
      }
    }
    if (action === "confirm_delivery") {
      const wo = await writeOffDeliveredOrder(client, orderId, actorId);
      if (!wo.ok) {
        await client.query("ROLLBACK");
        return { ok: false, httpStatus: 409, error: wo.error };
      }
    }

    await client.query(
      `INSERT INTO purchase_order_status_history
         (order_id, from_status, to_status, changed_by, changed_by_role, comment)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        orderId,
        order.status,
        target,
        actorId,
        actorRole,
        params.rejectionReason || params.comment || null,
      ]
    );

    await client.query("COMMIT");

    const counterpartyId =
      party === "buyer" ? String(updated.supplier_id) : String(updated.buyer_id);
    return {
      ok: true,
      order: { id: updated.id, number: updated.number, status: updated.status },
      notifiedUserId: counterpartyId,
      supplierId: String(updated.supplier_id),
      buyerId: String(updated.buyer_id),
    };
  } catch (e: any) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* noop */
    }
    return { ok: false, httpStatus: 500, error: "Ошибка смены статуса", details: e?.message };
  } finally {
    client.release();
  }
}

/** Шаблоны уведомлений по действию (используются в route.ts). */
export function notificationForAction(
  action: OrderAction,
  number: string,
  extra?: { reason?: string }
): { template: Template; title: string; body: string } {
  const map: Record<string, { template: Template; title: string; body: string }> = {
    submit: {
      template: "ORDER_CREATED",
      title: `Новый закупочный заказ ${number}`,
      body: `Кондитер оформил закупочный заказ ${number}. Требуется подтверждение.`,
    },
    confirm: {
      template: "ORDER_CONFIRMED",
      title: `Заказ ${number} подтверждён`,
      body: `Поставщик подтвердил закупочный заказ ${number}.`,
    },
    reject: {
      template: "ORDER_CANCELLED",
      title: `Заказ ${number} отклонён`,
      body: `Поставщик отклонил заказ ${number}. Причина: ${extra?.reason ?? "—"}`,
    },
    process: {
      template: "ORDER_IN_PRODUCTION",
      title: `Заказ ${number} в обработке`,
      body: `Поставщик приступил к обработке заказа ${number}.`,
    },
    ready_for_shipment: {
      template: "ORDER_READY",
      title: `Заказ ${number} готов к отгрузке`,
      body: `Поставщик отметил готовность заказа ${number} к отгрузке.`,
    },
    ship: {
      template: "ORDER_OUT_FOR_DELIVERY",
      title: `Заказ ${number} отгружен`,
      body: `Поставщик отгрузил заказ ${number}.`,
    },
    confirm_delivery: {
      template: "ORDER_DELIVERED",
      title: `Заказ ${number} доставлен`,
      body: `Покупатель подтвердил получение заказа ${number}. Остатки списаны.`,
    },
    cancel: {
      template: "ORDER_CANCELLED",
      title: `Заказ ${number} отменён`,
      body: `Закупочный заказ ${number} отменён покупателем. Резерв освобождён.`,
    },
    dispute: {
      template: "ORDER_STATUS_CHANGED",
      title: `По заказу ${number} открыт спор`,
      body: `По закупочному заказу ${number} открыт спор. Комментарий: ${extra?.reason ?? "—"}`,
    },
  };
  return map[action] ?? { template: "ORDER_STATUS_CHANGED", title: number, body: number };
}
