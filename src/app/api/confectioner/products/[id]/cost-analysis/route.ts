/**
 * GET /api/confectioner/products/[id]/cost-analysis
 *
 * Себестоимость / цена / маржа товара + честные оговорки о качестве данных.
 * Доступ: владелец (products.confectioner_id === user.id) или ADMIN/SUPER_ADMIN.
 *
 * Блоки ответа:
 *   currentCost        — recipe_ingredients × inventory_items.cost_per_unit
 *                        (unit-конвертация units.ts). available=false + reason,
 *                        когда у товара нет рецепта или ни одну позицию не удалось
 *                        оценить. approximate: true ВСЕГДА (снимок приблизительный).
 *   currentPrice       — get_product_price_at(now) (0083), approximate: false.
 *   margin             — price − cost (только когда cost available) + marginPercent.
 *   priceHistoryCosts  — cost_snapshot_rub из product_price_history
 *                        (хронологически). Честный notice: историческая
 *                        себестоимость НЕДОСТУПНА — исторические закупочные цены
 *                        ингредиентов не сохранялись; снимки приблизительные
 *                        (зафиксированы в момент изменения цены).
 *   warnings           — costExceedsPrice (cost >= price); marginLow
 *                        (marginPercent < 20, когда cost доступна);
 *                        costGrewWhilePriceStale (последние два снимка
 *                        себестоимости выросли >10%, при этом покрывающая
 *                        строка цены не менялась с ДО старшего снимка).
 *                        Best-effort, null-safe.
 *   ingredientDynamics — честно: {available:false, reason:'historical purchase
 *                        prices were not tracked'} — динамика закупочных цен
 *                        ингредиентов не отслеживалась.
 */
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/postgrest/pool";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import {
  authorizeProductAccess,
  computeRecipeCost,
  round1,
  type RecipeCostResult,
} from "@/lib/ops/price-shared";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface PriceAtRow {
  version_id: string | null;
  amount: number | null;
  currency: string;
  effective_from: Date | string;
  reason: string;
}

interface CostSnapshotRow {
  effective_from: Date | string;
  cost_snapshot_rub: number;
}

const HISTORY_COST_NOTICE =
  "исторические закупочные цены ингредиентов не сохранялись — историческая себестоимость недоступна; " +
  "приведённые снимки приблизительные (зафиксированы в момент изменения цены)";

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    // 1. Auth + ownership
    const user = await getUserFromRequest(_request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }
    const { id } = await params;

    const pool = getPool();
    const admin = await isAdmin(user.id);
    const access = await authorizeProductAccess(pool, id, user.id, admin);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // 2. Текущая цена (покрывающая now строка истории / синтез из products.price)
    const priceRes = await pool.query(
      `SELECT * FROM public.get_product_price_at($1, NULL, now())`,
      [id]
    );
    const priceRow = (priceRes.rows || [])[0] as unknown as PriceAtRow | undefined;

    // 3. Текущая себестоимость (recipe × inventory) — best-effort
    let currentCost: RecipeCostResult;
    try {
      currentCost = await computeRecipeCost(pool, id);
    } catch (costErr) {
      console.error(
        "[confectioner/cost-analysis] cost calc failed:",
        costErr instanceof Error ? costErr.message : costErr
      );
      currentCost = {
        available: false,
        amountRub: null,
        reason: "не удалось рассчитать себестоимость (ошибка чтения рецепта/склада)",
        approximate: true,
        basis: "recipe_ingredients × current inventory cost_per_unit",
      };
    }

    // 4. Маржа — только когда обе величины известны (иначе честно null)
    const priceAmount = priceRow && priceRow.amount !== null ? priceRow.amount : null;
    let margin: { amountRub: number; percent: number | null } | null = null;
    if (currentCost.available && currentCost.amountRub !== null && priceAmount !== null) {
      margin = {
        amountRub: priceAmount - currentCost.amountRub,
        percent: priceAmount > 0 ? round1(((priceAmount - currentCost.amountRub) / priceAmount) * 100) : null,
      };
    }

    // 5. Исторические снимки себестоимости (хронологически, ASC)
    const costsRes = await pool.query(
      `SELECT effective_from, cost_snapshot_rub
         FROM public.product_price_history
        WHERE product_id = $1
          AND product_variant_id IS NULL
          AND cost_snapshot_rub IS NOT NULL
        ORDER BY effective_from ASC`,
      [id]
    );
    const snapshotRows = (costsRes.rows || []) as unknown as CostSnapshotRow[];
    const priceHistoryCosts = snapshotRows.map((r) => ({
      effectiveFrom: iso(r.effective_from),
      costRub: r.cost_snapshot_rub,
      approximate: true,
    }));

    // 6. Warnings (best-effort, null-safe)
    const costExceedsPrice =
      currentCost.available &&
      currentCost.amountRub !== null &&
      priceAmount !== null &&
      currentCost.amountRub >= priceAmount;

    const marginLow =
      currentCost.available && margin && margin.percent !== null ? margin.percent < 20 : null;

    // costGrewWhilePriceStale: последние ДВА снимка себестоимости выросли >10%,
    // при этом покрывающая цена не менялась с ДО старшего снимка
    // (price.effective_from <= older snapshot.effective_from).
    let costGrewWhilePriceStale = false;
    if (snapshotRows.length >= 2 && priceRow && priceRow.effective_from) {
      const older = snapshotRows[snapshotRows.length - 2];
      const newer = snapshotRows[snapshotRows.length - 1];
      const priceFromMs = new Date(priceRow.effective_from).getTime();
      const olderMs = new Date(older.effective_from).getTime();
      if (older.cost_snapshot_rub > 0 && newer.cost_snapshot_rub > older.cost_snapshot_rub) {
        const growth = (newer.cost_snapshot_rub - older.cost_snapshot_rub) / older.cost_snapshot_rub;
        costGrewWhilePriceStale = growth > 0.1 && priceFromMs <= olderMs;
      }
    }

    return NextResponse.json({
      currentCost: {
        available: currentCost.available,
        amountRub: currentCost.amountRub,
        approximate: true,
        basis: currentCost.basis,
        ...(currentCost.reason ? { reason: currentCost.reason } : {}),
      },
      currentPrice: priceRow
        ? {
            amount: priceRow.amount,
            currency: priceRow.currency,
            versionId: priceRow.version_id ?? null,
            effectiveFrom: iso(priceRow.effective_from),
            reason: priceRow.reason,
            approximate: false,
          }
        : null,
      margin,
      priceHistoryCosts: {
        items: priceHistoryCosts,
        notice: HISTORY_COST_NOTICE,
      },
      warnings: {
        costExceedsPrice,
        marginLow,
        costGrewWhilePriceStale,
      },
      ingredientDynamics: {
        available: false,
        reason: "historical purchase prices were not tracked",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("GET /api/confectioner/products/[id]/cost-analysis error:", message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", detail: message },
      { status: 500 }
    );
  }
}
