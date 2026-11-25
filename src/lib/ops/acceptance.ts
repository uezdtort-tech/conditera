/**
 * acceptance.ts — Acceptance Engine P0.5 (ТЗ §8, §19, §20, §29).
 *
 * Отвечает на вопрос «Можем ли мы принять этот заказ на указанную дату?» —
 * СТРУКТУРИРОВАННО (не true/false):
 *
 *   canAccept: boolean
 *   availability: available | available_with_warning | unavailable
 *   risk: GREEN | YELLOW | ORANGE | RED
 *   reasons: конкретные причины (LOW_STOCK, CAPACITY_EXCEEDED, ...)
 *   suggestions: детерминированные подсказки (перенести время, закупка, другой кондитер)
 *
 * Связывает СУЩЕСТВУЮЩИЕ сущности (ТЗ §19):
 *   ingredients  ← computeIngredientNeeds (src/lib/ops/breakdown.ts)
 *   capacity     ← src/lib/ops/capacity.ts (резервы, окна)
 *   deadline     ← src/lib/ops/deadline.ts + production-duration.ts
 *   procurement  ← purchase_drafts.expected_eta (ТЗ §20)
 *
 * Детерминировано, без LLM (ТЗ §54).
 */

import { getPool } from "@/lib/postgrest/pool";
import { computeIngredientNeeds, type BreakdownIngredient } from "./breakdown";
import {
  readAcceptanceSnapshot,
  validateSnapshotCoversOrder,
  type AcceptanceSnapshot,
  type AcceptanceSnapshotIngredient,
} from "./snapshot";
import {
  estimateOrderProductionMinutes,
  type OrderItemForEstimate,
} from "./production-duration";
import { computeDeadlineAt, computeLatestSafeStart, minuteToHHMM } from "./deadline";
import { findAvailableWindow, getCapacityDay, findFreeWindow, type FreeWindow } from "./capacity";
import type { RiskLevel, RiskReasonCode } from "./lifecycle-config";

export type Availability = "available" | "available_with_warning" | "unavailable";

export interface AcceptanceReason {
  code: RiskReasonCode | "PURCHASE_ETA_MISSING" | "PURCHASE_ETA_AFTER_DEADLINE" | "DELIVERY_DATE_MISSING" | "RECIPE_MISSING" | "LOW_STOCK" | "CAN_ACCEPT_WITH_PURCHASE" | "INVENTORY_UNIT_MISMATCH" | "SNAPSHOT_INVALID";
  message: string;
}

export interface AcceptanceSuggestion {
  code:
    | "MOVE_DELIVERY_TIME"
    | "ASSIGN_ANOTHER_CONFECTIONER"
    | "CREATE_PURCHASE"
    | "SET_PURCHASE_ETA"
    | "CONFIGURE_PRODUCT_TIME"
    | "CHECK_LATER";
  message: string;
  /** Предлагаемое окно/время, если есть. */
  alternativeAt?: string | null;
}

export interface AcceptanceOwnerResult {
  confectionerId: string | null;
  confectionerName: string | null;
  items: string[];
  productionMinutes: number;
  estimateSource: string;
  estimateApproximate: boolean;
  inventory: {
    canProduce: boolean;
    shortageCount: number;
    shortages: Array<{ name: string; shortage: number | null; unit: string }>;
  };
  capacity: {
    checked: boolean;
    fits: boolean | null;
    utilizationPercent: number | null;
    freeMinutes: number | null;
    window: { start: string; end: string } | null;
  };
  deadline: {
    deliveryDate: string | null;
    deadlineAt: string | null;
    latestSafeStartAt: string | null;
    productionMinutes: number;
    marginMinutes: number | null;
  };
  purchase: {
    hasShortages: boolean;
    earliestEta: string | null;
    etaBeforeProductionStart: boolean | null;
  };
}

export interface AcceptanceResult {
  canAccept: boolean;
  availability: Availability;
  risk: RiskLevel;
  reasons: AcceptanceReason[];
  suggestions: AcceptanceSuggestion[];
  owners: AcceptanceOwnerResult[];
  /** Ближайшие свободные окна (для подсказки клиенту, ТЗ §29). */
  alternativeWindows: Array<{ confectionerId: string | null; date: string; start: string; end: string }>;
  /**
   * Z-v29: источник потребности. "snapshot" — заказ рассчитан по своему
   * неизменяемому снимку; "live" — легаси-заказ без snapshot (текущий рецепт).
   * Для гипотетических проверок (checkout-гейт) поле не выставляется.
   */
  needSource?: "live" | "snapshot";
}

// ---------------------------------------------------------------------------
// Загрузка данных позиций (products ← recipes ← categories)
// ---------------------------------------------------------------------------

export interface LoadedItem {
  productId: string | null;
  title: string;
  quantity: number;
  recipeId: string | null;
  ownerId: string | null;
  productionTimeHours: number | null;
  recipePrepMinutes: number | null;
  recipeCookMinutes: number | null;
  categorySlug: string | null;
  /**
   * Z-v29: нормы на 1 единицу из snapshot исторического заказа. Если заданы
   * (включая пустой массив), текущий рецепт для этой позиции НЕ читается.
   */
  ingredientNorms?: AcceptanceSnapshotIngredient[];
}

/**
 * Загрузить позиции заказа с данными для оценки (один SQL).
 */
export async function loadOrderItemsData(orderId: string): Promise<{
  items: LoadedItem[];
  assignedConfectionerId: string | null;
  deliveryDate: string | null;
  deliveryTimeWindow: string | null;
  deliveryTime: string | null;
  orderNumber: string | null;
  /** Z-v29: "snapshot" — потребность из снимка заказа; "live" — легаси-путь. */
  needSource: "live" | "snapshot";
  /** Z-v29: непусто, если snapshot ЕСТЬ, но повреждён/не соответствует заказу (fail-closed). */
  snapshotError: string | null;
} | null> {
  const pool = getPool();
  const res = await pool.query<{
    number: string;
    confectioner_id: string | null;
    delivery_date: string | null;
    delivery_time_window: string | null;
    delivery_time: string | null;
    product_id: string | null;
    title: string | null;
    quantity: number | string | null;
    recipe_id: string | null;
    production_time_hours: number | null;
    prep_time_minutes: number | null;
    cook_time_minutes: number | null;
    category_slug: string | null;
    metadata: string | null;
  }>(
    `SELECT o.number, o.confectioner_id::text,
            to_char(o.delivery_date, 'YYYY-MM-DD') AS delivery_date,
            o.delivery_time_window, o.delivery_time,
            oi.product_id::text,
            COALESCE(NULLIF(oi.product_title, ''), NULLIF(oi.title, ''), p.title, 'Товар') AS title,
            oi.quantity,
            p.recipe_id::text, p.production_time_hours,
            r.prep_time_minutes, r.cook_time_minutes,
            c.slug AS category_slug,
            o.metadata::text AS metadata
     FROM public.orders o
     LEFT JOIN public.order_items oi ON oi.order_id = o.id
     LEFT JOIN public.products p ON p.id = oi.product_id
     LEFT JOIN public.recipes r ON r.id = p.recipe_id
     LEFT JOIN public.product_categories c ON c.id = p.category_id
     WHERE o.id = $1::uuid`,
    [orderId]
  );
  if (res.rowCount === 0) return null;
  const first = res.rows[0];
  const items: LoadedItem[] = res.rows
    .filter((r) => r.product_id !== null || r.title !== null)
    .map((r) => ({
      productId: r.product_id,
      title: r.title ?? "Товар",
      quantity: Number(r.quantity ?? 1),
      recipeId: r.recipe_id,
      ownerId: null, // у позиции нет своего исполнителя — производит назначенный
      productionTimeHours: r.production_time_hours,
      recipePrepMinutes: r.prep_time_minutes,
      recipeCookMinutes: r.cook_time_minutes,
      categorySlug: r.category_slug,
    }));

  // --- Z-v29: snapshot исторической потребности ---
  // Валидный snapshot → нормы/параметры берутся ИЗ НЕГО (правка рецепта
  // после оформления не влияет на этот заказ). Повреждённый → snapshotError
  // (fail-closed у checkAcceptance). Отсутствующий → легаси live (needSource="live").
  let needSource: "live" | "snapshot" = "live";
  let snapshotError: string | null = null;
  let metadata: unknown = null;
  if (first.metadata) {
    try {
      metadata = JSON.parse(first.metadata);
    } catch {
      metadata = null;
    }
  }
  const parsed = readAcceptanceSnapshot(metadata);
  if (parsed.status === "invalid") {
    snapshotError = parsed.reason;
  } else if (parsed.status === "valid") {
    const snapshot: AcceptanceSnapshot = parsed.snapshot;
    const snapshotByProduct = new Map(snapshot.items.map((si) => [si.product_id, si]));
    const orderProductItems = items
      .filter((i) => i.productId !== null)
      .map((i) => ({ product_id: i.productId as string, quantity: i.quantity }));
    const coverage = validateSnapshotCoversOrder(snapshot, orderProductItems);
    if (!coverage.ok) {
      snapshotError = coverage.reason;
    } else {
      needSource = "snapshot";
      for (const item of items) {
        if (!item.productId) continue; // custom/удалённый товар — без snapshot-норм
        const si = snapshotByProduct.get(item.productId);
        if (!si) continue;
        // Нормы — из snapshot; параметры производства — тоже зафиксированы
        // (иначе правка рецепта меняла бы срок/мощность исторического заказа).
        item.ingredientNorms = si.ingredients;
        item.recipeId = si.recipe_id;
        item.productionTimeHours = si.production_time_hours;
        item.recipePrepMinutes = si.prep_time_minutes;
        item.recipeCookMinutes = si.cook_time_minutes;
        item.categorySlug = si.category_slug;
      }
    }
  }

  return {
    items,
    assignedConfectionerId: first.confectioner_id,
    deliveryDate: first.delivery_date,
    deliveryTimeWindow: first.delivery_time_window,
    deliveryTime: first.delivery_time,
    orderNumber: first.number,
    needSource,
    snapshotError,
  };
}

/**
 * Загрузить гипотетические позиции (checkout/конструктор): product_id × quantity.
 */
export async function loadProductItemsData(
  items: Array<{ productId: string; quantity: number }>
): Promise<LoadedItem[]> {
  const pool = getPool();
  const ids = items.map((i) => i.productId).filter(Boolean);
  if (ids.length === 0) return [];
  const res = await pool.query<{
    id: string;
    title: string;
    confectioner_id: string | null;
    recipe_id: string | null;
    production_time_hours: number | null;
    prep_time_minutes: number | null;
    cook_time_minutes: number | null;
    category_slug: string | null;
  }>(
    `SELECT p.id::text, p.title, p.confectioner_id::text,
            p.recipe_id::text, p.production_time_hours,
            r.prep_time_minutes, r.cook_time_minutes,
            c.slug AS category_slug
     FROM public.products p
     LEFT JOIN public.recipes r ON r.id = p.recipe_id
     LEFT JOIN public.product_categories c ON c.id = p.category_id
     WHERE p.id = ANY($1::uuid[])`,
    [ids]
  );
  const byId = new Map(res.rows.map((r) => [r.id, r]));
  return items
    .map((i) => {
      const p = byId.get(i.productId);
      if (!p) return null;
      return {
        productId: p.id,
        title: p.title,
        quantity: Math.max(1, i.quantity),
        recipeId: p.recipe_id,
        ownerId: p.confectioner_id,
        productionTimeHours: p.production_time_hours,
        recipePrepMinutes: p.prep_time_minutes,
        recipeCookMinutes: p.cook_time_minutes,
        categorySlug: p.category_slug,
      } as LoadedItem;
    })
    .filter((x): x is LoadedItem => x !== null);
}

// ---------------------------------------------------------------------------
// ETA закупок (ТЗ §20)
// ---------------------------------------------------------------------------

async function earliestPurchaseEta(
  ownerId: string,
  shortages: BreakdownIngredient[]
): Promise<Date | null> {
  if (shortages.length === 0) return null;
  const pool = getPool();
  const names = shortages.map((s) => s.name.trim().toLowerCase());
  const invIds = shortages.map((s) => s.inventory_item_id).filter((x): x is string => Boolean(x));
  // ВАЖНО: lower() встроенного PG не обрабатывает кириллицу (C-коллация:
  // lower('Ягоды')='Ягоды'), поэтому сравниваем и оригинал, и JS-variant.
  const originals = shortages.map((s) => s.name.trim());
  const nameVariants = [...new Set([...originals, ...names])];
  const res = await pool.query<{ eta: Date }>(
    `SELECT MIN(d.expected_eta) AS eta
     FROM public.purchase_drafts d
     JOIN public.purchase_draft_items i ON i.draft_id = d.id
     WHERE d.owner_id = $1::uuid
       AND d.status IN ('draft','sent')
       AND d.expected_eta IS NOT NULL
       AND (
         (i.inventory_item_id IS NOT NULL AND i.inventory_item_id::text = ANY($2::text[]))
         OR trim(i.name) = ANY($3::text[])
         OR lower(trim(i.name)) = ANY($3::text[])
       )`,
    [ownerId, invIds, nameVariants]
  );
  return res.rows[0]?.eta ?? null;
}

// ---------------------------------------------------------------------------
// Основной расчёт
// ---------------------------------------------------------------------------

export interface AcceptanceInput {
  items: LoadedItem[];
  /** Явный исполнитель (назначенный кондитер) — проверяем его мощность. */
  assignedConfectionerId?: string | null;
  deliveryDate: string | null;
  deliveryTimeWindow: string | null;
  deliveryTime: string | null;
  now?: Date;
  /** Глубина поиска альтернативных окон (дней). */
  alternativeDaysAhead?: number;
  /**
   * Для существующего заказа: исключить его СОВЙ резерв из занятости
   * (окно заказа не должно блокировать его же проверку выполнимости).
   */
  excludeReservationForOrderId?: string;
  /**
   * Z-v29: непусто, если заказ содержит ПОВРЕЖДЁННЫЙ metadata.acceptance_snapshot.
   * Fail-closed: потребность не считается вовсе (ни из snapshot, ни из текущего
   * рецепта), приёмка блокируется кодом SNAPSHOT_INVALID.
   */
  snapshotError?: string | null;
}

interface OwnerGroup {
  ownerId: string | null;
  items: LoadedItem[];
}

/** Сгруппировать позиции по исполнителю: назначенный кондитер или владелец товара. */
function groupByOwner(
  items: LoadedItem[],
  assignedConfectionerId: string | null
): OwnerGroup[] {
  if (assignedConfectionerId) {
    return [{ ownerId: assignedConfectionerId, items }];
  }
  const groups = new Map<string, OwnerGroup>();
  for (const item of items) {
    const key = item.ownerId ?? "__none__";
    const g = groups.get(key) ?? { ownerId: item.ownerId, items: [] };
    g.items.push(item);
    groups.set(key, g);
  }
  return [...groups.values()];
}

function minuteOfDayNow(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Проверить выполнимость набора позиций на дату/время.
 * ИНВЕНТАРЬ + МОЩНОСТЬ + ВРЕМЯ + ИСПОЛНИТЕЛЬ = заказ реально выполним (ТЗ §19).
 */
export async function checkAcceptance(input: AcceptanceInput): Promise<AcceptanceResult> {
  const now = input.now ?? new Date();
  const reasons: AcceptanceReason[] = [];
  const suggestions: AcceptanceSuggestion[] = [];
  const alternativeWindows: AcceptanceResult["alternativeWindows"] = [];

  const deadlineAt = computeDeadlineAt(
    input.deliveryDate,
    input.deliveryTimeWindow,
    input.deliveryTime
  );

  if (!input.deliveryDate) {
    reasons.push({
      code: "DELIVERY_DATE_MISSING",
      message: "Дата доставки не указана — выполнимость не проверена.",
    });
    suggestions.push({ code: "CHECK_LATER", message: "Укажите дату доставки для проверки." });
  }

  // Z-v29 (fail-closed): повреждённый/частичный snapshot с неизвестной
  // schema_version или не соответствующий позициям заказа блокирует расчёт
  // ПОЛНОСТЬЮ — не «молчаливо считаем по текущему рецепту».
  const snapshotBroken = Boolean(input.snapshotError);
  if (snapshotBroken) {
    reasons.push({
      code: "SNAPSHOT_INVALID",
      message: `Snapshot производственного состава заказа повреждён (${input.snapshotError}) — потребность не рассчитана, приёмка заблокирована.`,
    });
    suggestions.push({
      code: "CHECK_LATER",
      message: "Требуется восстановление snapshot заказа администратором.",
    });
  }

  const groups = groupByOwner(input.items, input.assignedConfectionerId ?? null);
  const ownerResults: AcceptanceOwnerResult[] = [];

  for (const group of groups) {
    const ownerId = group.ownerId;

    // --- Рецепт (сценарий D приёмки): позиция без привязанного рецепта не
    // должна молча приниматься без расчёта потребности в ингредиентах.
    const noRecipeItems = group.items.filter((i) => !i.recipeId);
    if (noRecipeItems.length > 0) {
      reasons.push({
        code: "RECIPE_MISSING",
        message: `«${noRecipeItems
          .map((i) => i.title)
          .join(", ")}": нет привязанного рецепта — потребность в ингредиентах не рассчитана.`,
      });
    }

    // --- Оценка времени производства (ТЗ §10) ---
    const estimateInputs: OrderItemForEstimate[] = group.items.map((i) => ({
      quantity: i.quantity,
      time: {
        productProductionTimeHours: i.productionTimeHours,
        recipePrepMinutes: i.recipePrepMinutes,
        recipeCookMinutes: i.recipeCookMinutes,
        categorySlug: i.categorySlug,
      },
    }));
    const estimate = estimateOrderProductionMinutes(estimateInputs);
    const timeMissing = group.items.every(
      (i) =>
        !i.productionTimeHours &&
        !i.recipePrepMinutes &&
        !i.recipeCookMinutes
    );
    if (timeMissing) {
      reasons.push({
        code: "MISSING_PRODUCT_DATA",
        message: `«${group.items[0].title}»: время производства не сконфигурировано (Product configuration incomplete).`,
      });
      suggestions.push({
        code: "CONFIGURE_PRODUCT_TIME",
        message: "Заполните время производства в карточке товара или рецепте.",
      });
    }

    // --- Deadline Engine (ТЗ §11) ---
    let latestSafeStartAt: Date | null = null;
    let marginMin: number | null = null;
    if (deadlineAt) {
      const lss = computeLatestSafeStart({
        deadlineAt,
        productionMinutes: estimate.minutes,
      });
      latestSafeStartAt = lss.latestSafeStartAt;
      marginMin = Math.round((latestSafeStartAt.getTime() - now.getTime()) / 60_000);
    }

    // --- Инвентарь (существующая цепочка P0) ---
    // Z-v29: при повреждённом snapshot потребность НЕ считается вовсе
    // (ни из snapshot, ни из текущего рецепта — иначе был бы fail-open).
    const needs = snapshotBroken
      ? { ingredients: [], shortages: [], can_produce: false, total_shortage_cost: 0 }
      : await computeIngredientNeeds(
          group.items.map((i) => ({
            recipe_id: i.recipeId,
            quantity: i.quantity,
            // Snapshot-позиции считаются по зафиксированным нормам (Z-v29);
            // легаси-позиции — по текущему рецепту, как раньше.
            ...(i.ingredientNorms !== undefined
              ? { ingredientNorms: i.ingredientNorms }
              : {}),
          })),
          ownerId
        );
    const shortages = needs.shortages;

    // Нельзя принимать заказ без рабочего рецепта или при несовместимых единицах.
    if (group.items.some((item) => !item.recipeId) || needs.ingredients.length === 0) {
      reasons.push({
        code: "MISSING_RECIPE",
        message: `Для «${group.items.filter((item) => !item.recipeId).map((item) => item.title).join(", ") || group.items[0]?.title}» не настроен рецепт с ингредиентами.`,
      });
      suggestions.push({
        code: "CONFIGURE_PRODUCT_TIME",
        message: "Привяжите к товару рецепт и заполните его ингредиенты до приёма заказа.",
      });
    }
    const unitMismatches = needs.ingredients.filter((ingredient) => ingredient.status === "unit_mismatch");
    if (unitMismatches.length > 0) {
      reasons.push({
        code: "UNIT_MISMATCH",
        message: `Несовместимые единицы измерения: ${unitMismatches.map((ingredient) => ingredient.name).join(", ")}. Исправьте единицы рецепта или склада.`,
      });
      suggestions.push({
        code: "CONFIGURE_PRODUCT_TIME",
        message: "Согласуйте единицы измерения в рецепте и складских позициях.",
      });
    }

    // Z-v27 (сценарий P, fail-closed): ингредиенты со статусом unit_mismatch
    // (неизвестная/несовместимая единица склада) не входят в shortages, но
    // потребность по ним НЕ проверяема — раньше гейт пропускал такой заказ
    // (canAccept=true), а accept затем отклонял его (canProduce=false) —
    // оплаченный заказ зависал. Теперь это блокирующая причина.
    const unitMismatches = needs.ingredients.filter((i) => i.status === "unit_mismatch");
    if (unitMismatches.length > 0) {
      reasons.push({
        code: "INVENTORY_UNIT_MISMATCH",
        message: `Единицы склада несовместимы с рецептурой: ${unitMismatches
          .map((i) => `«${i.name}» (склад: ${i.warehouse_unit ?? "?"})`)
          .join(", ")}. Исправьте единицу позиции склада.`,
      });
      suggestions.push({
        code: "CHECK_LATER",
        message: "Проверьте единицы измерения позиций склада (г/мл/шт/дес).",
      });
    }

    // --- Закупки: ETA (ТЗ §20) ---
    let earliestEta: Date | null = null;
    let etaBeforeProductionStart: boolean | null = null;
    if (ownerId && shortages.length > 0) {
      earliestEta = await earliestPurchaseEta(ownerId, shortages);
      if (earliestEta) {
        if (latestSafeStartAt) {
          etaBeforeProductionStart = earliestEta.getTime() <= latestSafeStartAt.getTime();
          if (!etaBeforeProductionStart) {
            reasons.push({
              code: "PURCHASE_ETA_AFTER_DEADLINE",
              message: `Поставка придёт позже безопасного старта производства (${earliestEta.toLocaleString("ru-RU")}).`,
            });
            suggestions.push({ code: "MOVE_DELIVERY_TIME", message: "Перенести дату/время выдачи позже." });
          } else {
            suggestions.push({ code: "SET_PURCHASE_ETA", message: "Закупка успевает к производству (CAN_ACCEPT_WITH_PURCHASE)." });
          }
        }
      } else {
        reasons.push({
          code: "PURCHASE_ETA_MISSING",
          message: `Дефицит: ${shortages.map((s) => s.name).join(", ")}. Закупка не запланирована (ETA не указана).`,
        });
        suggestions.push({ code: "CREATE_PURCHASE", message: "Создать закупку и указать ETA поставки." });
      }
    }

    // --- Мощность (ТЗ §9) ---
    let capacityChecked = false;
    let fits: boolean | null = null;
    let utilization: number | null = null;
    let freeMinutes: number | null = null;
    let window: { start: string; end: string } | null = null;

    if (ownerId && input.deliveryDate) {
      capacityChecked = true;
      const earliest =
        input.deliveryDate === isoDate(now) ? minuteOfDayNow(now) : 0;
      const { window: found, view } = await findAvailableWindow(
        ownerId,
        input.deliveryDate,
        estimate.minutes,
        earliest,
        input.excludeReservationForOrderId
      );
      utilization = view.utilizationPercent;
      freeMinutes = view.freeMinutes;
      if (found) {
        fits = true;
        window = { start: minuteToHHMM(found.start), end: minuteToHHMM(found.end) };
        // Альтернативное окно — найденное (для подсказки клиенту)
        alternativeWindows.push({
          confectionerId: ownerId,
          date: input.deliveryDate,
          start: minuteToHHMM(found.start),
          end: minuteToHHMM(found.end),
        });
      } else {
        fits = false;
        reasons.push({
          code: "CAPACITY_EXCEEDED",
          message: `Нет свободного окна ${estimate.minutes} мин у кондитера на ${input.deliveryDate} (загрузка ${view.utilizationPercent}%).`,
        });
        suggestions.push({ code: "ASSIGN_ANOTHER_CONFECTIONER", message: "Назначить другого кондитера." });
        // Поиск альтернатив на ближайшие дни (ТЗ §29: «ближайшее доступное время»)
        const alt = await suggestAlternativeWindows(
          ownerId,
          estimate.minutes,
          input.deliveryDate,
          input.alternativeDaysAhead ?? 3,
          now
        );
        for (const a of alt) {
          alternativeWindows.push({ confectionerId: ownerId, date: a.date, start: minuteToHHMM(a.start), end: minuteToHHMM(a.end) });
          suggestions.push({
            code: "MOVE_DELIVERY_TIME",
            message: `Ближайшее доступное окно: ${a.date} ${minuteToHHMM(a.start)}–${minuteToHHMM(a.end)}.`,
            alternativeAt: `${a.date}T${minuteToHHMM(a.start)}`,
          });
          break;
        }
      }
    }

    if (shortages.length > 0) {
      // Z-v20 (ТЗ §20 CAN_ACCEPT_WITH_PURCHASE): если закупка запланирована и
      // успевает к безопасному старту производства — нехватка НЕ блокирует
      // приёмку (предупреждение). Раньше LOW_STOCK оставался блокирующим
      // всегда, из-за чего весь контур «дефицит → закупка → ETA» не мог
      // завершиться приёмкой заказа (engine bug, найден Z-v20 E2E №2).
      // Повторная проверка остатков выполняется при старте производства.
      const purchaseCovers = Boolean(earliestEta && etaBeforeProductionStart);
      reasons.push({
        code: purchaseCovers ? "CAN_ACCEPT_WITH_PURCHASE" : "LOW_STOCK",
        message: purchaseCovers
          ? `Недостаточно: ${shortages
              .map((s) => `${s.name}${s.shortage ? ` (−${s.shortage} ${s.unit})` : ""}`)
              .join(", ")}. Закупка успевает к производству (ETA ${earliestEta!.toLocaleString("ru-RU")}).`
          : `Недостаточно: ${shortages
              .map((s) => `${s.name}${s.shortage ? ` (−${s.shortage} ${s.unit})` : ""}`)
              .join(", ")}.`,
      });
    }

    if (latestSafeStartAt && marginMin !== null && marginMin < 0) {
      reasons.push({
        code: "DEADLINE_TOO_CLOSE",
        message: "Безопасное время старта производства уже прошло для указанного срока.",
      });
    }

    // Имя кондитера (для UI)
    let confectionerName: string | null = null;
    if (ownerId) {
      const pool = getPool();
      const nm = await pool.query<{ business_name: string | null }>(
        `SELECT "businessName" AS business_name FROM public.confectioners WHERE "userId" = $1::text LIMIT 1`,
        [ownerId]
      );
      confectionerName = nm.rows[0]?.business_name ?? null;
    }

    ownerResults.push({
      confectionerId: ownerId,
      confectionerName,
      items: group.items.map((i) => `${i.title} ×${i.quantity}`),
      productionMinutes: estimate.minutes,
      estimateSource: estimate.source,
      estimateApproximate: estimate.approximate,
      inventory: {
        canProduce: needs.can_produce,
        shortageCount: shortages.length,
        shortages: shortages.map((s) => ({ name: s.name, shortage: s.shortage, unit: s.unit })),
      },
      capacity: {
        checked: capacityChecked,
        fits,
        utilizationPercent: utilization,
        freeMinutes,
        window,
      },
      deadline: {
        deliveryDate: input.deliveryDate,
        deadlineAt: deadlineAt ? deadlineAt.toISOString() : null,
        latestSafeStartAt: latestSafeStartAt ? latestSafeStartAt.toISOString() : null,
        productionMinutes: estimate.minutes,
        marginMinutes: marginMin,
      },
      purchase: {
        hasShortages: shortages.length > 0,
        earliestEta: earliestEta ? earliestEta.toISOString() : null,
        etaBeforeProductionStart,
      },
    });
  }

  // --- Итог: aggregation ---
  const hasBlocking = reasons.some((r) => BLOCKING_CODES.has(r.code));
  const hasWarning = reasons.length > 0 && !hasBlocking;
  const canAccept = !hasBlocking;
  const availability: Availability = hasBlocking
    ? "unavailable"
    : hasWarning
      ? "available_with_warning"
      : "available";

  // Риск для ответа (ТЗ §8: risk: high/…; у нас 4 уровня)
  const risk: RiskLevel = hasBlocking
    ? reasons.some((r) => r.code === "CAPACITY_EXCEEDED" || r.code === "PURCHASE_ETA_AFTER_DEADLINE")
      ? "RED"
      : "ORANGE"
    : hasWarning
      ? "YELLOW"
      : "GREEN";

  // Дедуп подсказок по коду
  const seen = new Set<string>();
  const dedupSuggestions = suggestions.filter((s) => {
    const key = `${s.code}:${s.alternativeAt ?? s.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    canAccept,
    availability,
    risk,
    reasons: dedupeReasons(reasons),
    suggestions: dedupSuggestions,
    owners: ownerResults,
    alternativeWindows: alternativeWindows.slice(0, 6),
  };
}

const BLOCKING_CODES = new Set<string>([
  "CAPACITY_EXCEEDED",
  "PURCHASE_ETA_AFTER_DEADLINE",
  "PURCHASE_ETA_MISSING",
  "DEADLINE_TOO_CLOSE",
  "MISSING_RECIPE",
  "UNIT_MISMATCH",
  // Сценарии A/D приёмки (Z-v12): нехватка ингредиентов и отсутствие рецепта
  // запрещают переход в состояние «принято к производству». LOW_STOCK — код
  // движка для нехватки; RECIPE_MISSING — позиция без расчёта потребности.
  "LOW_STOCK",
  "RECIPE_MISSING",
  // Z-v27 (сценарий P): неизвестная/несовместимая единица склада — потребность
  // непроверяема → fail-closed (совпадает с accept-путём canProduce).
  "INVENTORY_UNIT_MISMATCH",
  // Z-v29: повреждённый/частичный metadata.acceptance_snapshot — потребность
  // исторического заказа невосстановима достоверно → fail-closed (без
  // молчаливой подмены текущим рецептом).
  "SNAPSHOT_INVALID",
]);

function dedupeReasons(reasons: AcceptanceReason[]): AcceptanceReason[] {
  const seen = new Set<string>();
  return reasons.filter((r) => {
    if (seen.has(r.code + r.message)) return false;
    seen.add(r.code + r.message);
    return true;
  });
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Ближайшие свободные окна на N дней вперёд (ТЗ §29). */
export async function suggestAlternativeWindows(
  confectionerId: string,
  requiredMinutes: number,
  fromDate: string,
  daysAhead: number,
  now: Date
): Promise<Array<{ date: string; start: number; end: number }>> {
  const base = new Date(fromDate + "T00:00:00");
  for (let i = 0; i <= daysAhead; i++) {
    const d = new Date(base.getTime() + i * 86_400_000);
    const dateStr = isoDate(d);
    const earliest = dateStr === isoDate(now) ? minuteOfDayNow(now) : 0;
    const view = await getCapacityDay(confectionerId, dateStr);
    const w: FreeWindow | null = findFreeWindow(view.freeWindows, requiredMinutes, earliest);
    if (w) return [{ date: dateStr, start: w.start, end: w.end }];
  }
  return [];
}

/**
 * Проверка существующего заказа (POST /api/orders/[id]/acceptance-check).
 *
 * Z-v29: при наличии валидного metadata.acceptance_snapshot потребность
 * считается из снимка (needSource="snapshot"); повреждённый snapshot →
 * блокирующий код SNAPSHOT_INVALID; легаси-заказы — live (needSource="live").
 */
export async function checkOrderAcceptance(
  orderId: string
): Promise<AcceptanceResult | null> {
  const data = await loadOrderItemsData(orderId);
  if (!data) return null;
  const result = await checkAcceptance({
    items: data.items,
    assignedConfectionerId: data.assignedConfectionerId,
    deliveryDate: data.deliveryDate,
    deliveryTimeWindow: data.deliveryTimeWindow,
    deliveryTime: data.deliveryTime,
    excludeReservationForOrderId: orderId,
    snapshotError: data.snapshotError,
  });
  return { ...result, needSource: data.needSource };
}
