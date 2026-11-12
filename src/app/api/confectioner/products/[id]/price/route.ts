/**
 * POST /api/confectioner/products/[id]/price
 *
 * Установка новой версии цены товара (pg-функция set_product_price, 0083).
 *
 * Доступ: владелец (products.confectioner_id === user.id) или ADMIN/SUPER_ADMIN.
 * Источник всегда 'confectioner_ui': админ правит цены через этот же маршрут
 * как обычный автор (отдельный admin-correction маршрут — для ретроспективных
 * правок ТЕКУЩЕЙ строки с аудитом). Вариант: p_variant_id=NULL (варианты не
 * живые; SQL-уровень готов).
 *
 * Body:
 *   amount          int RUB 0..10_000_000 (обязателен)
 *   effectiveFrom   ISO 8601 | YYYY-MM-DD; date-only = 00:00 Europe/Moscow
 *                   (константа цеха, '+03:00', без DST)
 *   reason          enum 0083 КРОМЕ 'initial' ('initial' резервирует сид/функция)
 *   comment?        string ≤ 500
 *   idempotencyKey? string ≤ 200 — анти-даблсабмит (uq-индекс 0083)
 *
 * Себестоимость: снимок recipe_ingredients × inventory_items.cost_per_unit
 * (unit-конвертация из src/lib/ops/units.ts), best-effort → null; всегда approximate.
 *
 * Ответ 200: {versionId, previousAmount, newAmount, deltaRub, deltaPercent,
 *             planned (effectiveFrom > now), effectiveFrom, effectiveTo}.
 * Ошибки:
 *   400 VALIDATION_FAILED / INVALID_REASON / INVALID_EFFECTIVE_FROM
 *   400 PRICE_VALIDATION_FAILED — raise из set_product_price (валидация функции)
 *   409 PRICE_PERIOD_CONFLICT  — SQLSTATE 23P01 (перекрытие интервалов)
 *   200 idempotent:true        — SQLSTATE 23505 (гонка idempotency_key): строка
 *                                перечитывается по ключу и отдаётся как replay
 */
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/postgrest/pool";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import {
  authorizeProductAccess,
  computeCostSnapshotOrNull,
  deltaPercent,
  isPriceReason,
  parsePriceDate,
  PRICE_MAX_RUB,
  WORKSHOP_TZ_LABEL,
} from "@/lib/ops/price-shared";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface SetPriceResult {
  versionId?: string;
  previousAmount?: number | null;
  newAmount?: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  planned?: boolean;
  idempotent?: boolean;
  noChange?: boolean;
}

interface PgErrorLike {
  code?: string;
  message?: string;
}

function asPgError(err: unknown): PgErrorLike {
  if (typeof err === "object" && err !== null) {
    const e = err as { code?: unknown; message?: unknown };
    return {
      code: typeof e.code === "string" ? e.code : undefined,
      message: typeof e.message === "string" ? e.message : undefined,
    };
  }
  return {};
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    // 1. Auth + ownership
    const user = await getUserFromRequest(request);
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

    // 2. Body
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "Ожидается JSON-объект" },
        { status: 400 }
      );
    }

    // amount: integer RUB, 0..10_000_000
    const amountRaw = body.amount;
    const amount = typeof amountRaw === "string" && amountRaw.trim() !== "" ? Number(amountRaw) : amountRaw;
    if (
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount < 0 ||
      amount > PRICE_MAX_RUB
    ) {
      return NextResponse.json(
        {
          error: "VALIDATION_FAILED",
          message: `amount должен быть целым числом RUB в диапазоне 0..${PRICE_MAX_RUB}`,
        },
        { status: 400 }
      );
    }

    // effectiveFrom: ISO | YYYY-MM-DD (date-only = 00:00 Europe/Moscow, см. WORKSHOP_TZ)
    const effectiveFrom = parsePriceDate(body.effectiveFrom, "00:00");
    if (!effectiveFrom) {
      return NextResponse.json(
        {
          error: "INVALID_EFFECTIVE_FROM",
          message: `effectiveFrom: ожидался ISO 8601 или YYYY-MM-DD (date-only = ${WORKSHOP_TZ_LABEL}, 00:00)`,
        },
        { status: 400 }
      );
    }

    // reason: enum 0083, но НЕ 'initial' (его ставит только сид/функция)
    if (!isPriceReason(body.reason) || body.reason === "initial") {
      return NextResponse.json(
        {
          error: "INVALID_REASON",
          message: `reason: одно из ingredients|packaging|decor|logistics|fuel|electricity|labor|composition_change|other ('initial' зарезервирован)`,
        },
        { status: 400 }
      );
    }

    const comment =
      body.comment === undefined || body.comment === null
        ? null
        : typeof body.comment === "string" && body.comment.trim().length > 0 && body.comment.length <= 500
          ? body.comment.trim()
          : undefined;
    if (comment === undefined) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "comment: непустая строка до 500 символов" },
        { status: 400 }
      );
    }

    const idempotencyKey =
      body.idempotencyKey === undefined || body.idempotencyKey === null
        ? null
        : typeof body.idempotencyKey === "string" && body.idempotencyKey.length > 0 && body.idempotencyKey.length <= 200
          ? body.idempotencyKey
          : undefined;
    if (idempotencyKey === undefined) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "idempotencyKey: непустая строка до 200 символов" },
        { status: 400 }
      );
    }

    // 3. Снимок себестоимости — best-effort (ошибка/нет рецепта → null)
    const costSnapshot = await computeCostSnapshotOrNull(pool, id);

    // 4. set_product_price(p_actor, p_product_id, p_variant_id=NULL, p_amount,
    //    p_effective_from, p_reason, p_comment, p_source='confectioner_ui',
    //    p_cost_snapshot, p_idempotency_key, p_actor_is_admin)
    try {
      const res = await pool.query(
        `SELECT public.set_product_price($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result`,
        [
          user.id,
          id,
          null, // варианты не живые; базовая цена
          amount,
          effectiveFrom.toISOString(),
          body.reason,
          comment,
          "confectioner_ui",
          costSnapshot,
          idempotencyKey,
          admin,
        ]
      );
      const result = (res.rows?.[0]?.result ?? {}) as SetPriceResult;
      const newAmount = result.newAmount ?? amount;
      const previousAmount = result.previousAmount ?? null;

      return NextResponse.json({
        versionId: result.versionId ?? null,
        previousAmount,
        newAmount,
        deltaRub: previousAmount === null ? null : newAmount - previousAmount,
        deltaPercent: deltaPercent(newAmount, previousAmount),
        planned: result.planned ?? false,
        effectiveFrom: result.effectiveFrom ?? effectiveFrom.toISOString(),
        effectiveTo: result.effectiveTo ?? null,
        ...(result.idempotent ? { idempotent: true } : {}),
      });
    } catch (err) {
      const pg = asPgError(err);

      // 23P01 exclusion_violation — пересечение интервалов версий
      if (pg.code === "23P01") {
        return NextResponse.json(
          {
            error: "PRICE_PERIOD_CONFLICT",
            message: "Период цены пересекается с существующей версией",
          },
          { status: 409 }
        );
      }

      // 23505 — гонка idempotency_key: перечитать строку по ключу (replay)
      if (pg.code === "23505" && idempotencyKey) {
        const replay = await pool.query(
          `SELECT id, amount, effective_from, effective_to
             FROM public.product_price_history
            WHERE product_id = $1
              AND product_variant_id IS NULL
              AND idempotency_key = $2
            ORDER BY effective_from DESC
            LIMIT 1`,
          [id, idempotencyKey]
        );
        const row = replay.rows?.[0] as
          | { id: string; amount: number; effective_from: Date | string; effective_to: Date | string | null }
          | undefined;
        if (row) {
          const effFrom =
            row.effective_from instanceof Date ? row.effective_from.toISOString() : new Date(row.effective_from).toISOString();
          return NextResponse.json({
            versionId: row.id,
            previousAmount: null,
            newAmount: row.amount,
            deltaRub: null,
            deltaPercent: null,
            planned: new Date(row.effective_from).getTime() > Date.now(),
            effectiveFrom: effFrom,
            effectiveTo: row.effective_to
              ? row.effective_to instanceof Date
                ? row.effective_to.toISOString()
                : new Date(row.effective_to).toISOString()
              : null,
            idempotent: true,
          });
        }
        return NextResponse.json(
          { error: "IDEMPOTENCY_RACE", message: "Ключ идемпотентности не разрешился повторным чтением" },
          { status: 409 }
        );
      }

      // P0001 raise_exception из set_product_price: валидация функции или доступ.
      // Доступ уже проверен route-уровнем; сообщение функции — наружу (это
      // контракт функции 0083, SQL-детали не раскрываем).
      if (pg.code === "P0001") {
        const msg = pg.message ?? "Функция установки цены отклонила запрос";
        if (/access denied/i.test(msg)) {
          return NextResponse.json({ error: "FORBIDDEN", message: msg }, { status: 403 });
        }
        return NextResponse.json(
          { error: "PRICE_VALIDATION_FAILED", message: msg },
          { status: 400 }
        );
      }

      throw err;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("POST /api/confectioner/products/[id]/price error:", message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", detail: message },
      { status: 500 }
    );
  }
}
