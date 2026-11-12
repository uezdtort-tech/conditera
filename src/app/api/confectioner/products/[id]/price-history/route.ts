/**
 * GET /api/confectioner/products/[id]/price-history
 *
 * История эффективных цен товара (миграция 0083) для кондитера-владельца
 * и ADMIN/SUPER_ADMIN. Варианты: product_variants мёртв в live-коде — базовая
 * цена это product_variant_id IS NULL; query-параметр ?variantId=<uuid>
 * опционально переключает выборку на строки варианта (SQL-уровень готов).
 *
 * Порядок: auth → ownership → LAZY CATCH-UP (sync_effective_product_prices)
 * → чтение истории. Catch-up подтягивает products.price к наступившим
 * версиям (в т.ч. planned, время которых пришло) до любого чтения.
 *
 * Ответ:
 *   current   — открытая (последняя) версия: {versionId, amount, currency,
 *               effectiveFrom, planned} (planned = effectiveFrom > now);
 *   previous  — хронологический предшественник current: {amount, effectiveFrom} | null;
 *   items[]   — все версии ORDER BY effective_from DESC с deltaRub/deltaPercent
 *               относительно предыдущей по времени строки (prev отсутствует/0 → null).
 */
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/postgrest/pool";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import { authorizeProductAccess, deltaPercent } from "@/lib/ops/price-shared";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface HistoryRow {
  id: string;
  amount: number;
  currency: string;
  effective_from: Date | string;
  effective_to: Date | string | null;
  reason: string;
  comment: string | null;
  source: string;
  previous_version_id: string | null;
  cost_snapshot_rub: number | null;
  created_by: string;
  created_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    // 1. Auth
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }
    const { id } = await params;

    // 2. Ownership: владелец (products.confectioner_id === user.id) или админ
    const pool = getPool();
    const admin = await isAdmin(user.id);
    const access = await authorizeProductAccess(pool, id, user.id, admin);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // 3. Опциональный фильтр варианта (базовая цена — variant IS NULL)
    const variantId = request.nextUrl.searchParams.get("variantId");
    if (variantId && !UUID_RE.test(variantId)) {
      return NextResponse.json({ error: "Некорректный variantId" }, { status: 400 });
    }

    // 4. LAZY CATCH-UP — строго ДО чтения истории; сбой не ломает чтение
    //    (честная история важнее недоступности catch-up).
    try {
      await pool.query(`SELECT public.sync_effective_product_prices()`);
    } catch (syncErr) {
      console.error(
        "[confectioner/price-history] catch-up failed:",
        syncErr instanceof Error ? syncErr.message : syncErr
      );
    }

    // 5. Чтение истории (DESC — свежие сверху)
    const historyRes = variantId
      ? await pool.query(
          `SELECT id, amount, currency, effective_from, effective_to, reason, comment,
                  source, previous_version_id, cost_snapshot_rub, created_by, created_at
             FROM public.product_price_history
            WHERE product_id = $1 AND product_variant_id = $2
            ORDER BY effective_from DESC`,
          [id, variantId]
        )
      : await pool.query(
          `SELECT id, amount, currency, effective_from, effective_to, reason, comment,
                  source, previous_version_id, cost_snapshot_rub, created_by, created_at
             FROM public.product_price_history
            WHERE product_id = $1 AND product_variant_id IS NULL
            ORDER BY effective_from DESC`,
          [id]
        );

    const rows = (historyRes.rows || []) as unknown as HistoryRow[];
    const nowMs = Date.now();

    // Хронологический порядок для дельт: каждой строке — предыдущая по времени
    const chrono = [...rows].sort(
      (a, b) => new Date(a.effective_from).getTime() - new Date(b.effective_from).getTime()
    );
    const prevOf = new Map<string, HistoryRow | undefined>();
    for (let i = 0; i < chrono.length; i++) {
      prevOf.set(chrono[i].id, i > 0 ? chrono[i - 1] : undefined);
    }

    const items = rows.map((r) => {
      const prev = prevOf.get(r.id);
      const prevAmount = prev ? prev.amount : null;
      return {
        id: r.id,
        amount: r.amount,
        currency: r.currency,
        effectiveFrom: iso(r.effective_from),
        effectiveTo: r.effective_to ? iso(r.effective_to) : null,
        reason: r.reason,
        comment: r.comment,
        source: r.source,
        previousVersionId: r.previous_version_id,
        deltaRub: prevAmount === null ? null : r.amount - prevAmount,
        deltaPercent: prevAmount === null ? null : deltaPercent(r.amount, prevAmount),
        costSnapshotRub: r.cost_snapshot_rub,
        createdBy: r.created_by,
        createdAt: iso(r.created_at),
      };
    });

    // current = открытая версия (effective_to IS NULL; последняя строка всегда открыта)
    const open = rows.find((r) => r.effective_to === null) ?? null;
    const current = open
      ? {
          versionId: open.id,
          amount: open.amount,
          currency: open.currency,
          effectiveFrom: iso(open.effective_from),
          planned: new Date(open.effective_from).getTime() > nowMs,
        }
      : null;

    // previous = хронологический предшественник current (для planned-версии это
    // строка, всё ещё действующая до её наступления)
    const prev = open ? prevOf.get(open.id) ?? null : null;

    return NextResponse.json({
      current,
      previous: prev ? { amount: prev.amount, effectiveFrom: iso(prev.effective_from) } : null,
      items,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("GET /api/confectioner/products/[id]/price-history error:", message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", detail: message },
      { status: 500 }
    );
  }
}
