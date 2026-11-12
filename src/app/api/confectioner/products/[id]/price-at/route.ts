/**
 * GET /api/confectioner/products/[id]/price-at?date=<ISO-or-YYYY-MM-DD>
 *
 * Цена товара на момент времени (pg-функция get_product_price_at, 0083).
 * Доступ: владелец (products.confectioner_id === user.id) или ADMIN/SUPER_ADMIN.
 *
 * Дата:
 *   • "YYYY-MM-DD" — дата без времени интерпретируется как ПОЛДЕНЬ (12:00)
 *     этого дня в цеховом часовом поясе — константа Europe/Moscow (UTC+03:00,
 *     без DST). Полдень выбран, чтобы «цена на дату» не зависела от границ
 *     суток при планируемых сменах цены в полночь.
 *   • полный ISO 8601 — как есть.
 *   • неверная/отсутствующая дата → 400 INVALID_DATE.
 *
 * Ответ: {amount, currency, versionId|null, effectiveFrom, reason, approximate:false}.
 * versionId null ⇒ цена синтезирована из products.price (legacy-товар без истории,
 * функция 0083 гарантирует непустой результат для живого товара).
 */
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/postgrest/pool";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import { authorizeProductAccess, parsePriceDate, WORKSHOP_TZ_LABEL } from "@/lib/ops/price-shared";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface PriceAtRow {
  version_id: string | null;
  amount: number;
  currency: string;
  effective_from: Date | string;
  reason: string;
}

export async function GET(
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

    // 2. Дата. Date-only → 12:00 Europe/Moscow (константа цеха, см. price-shared).
    const raw = request.nextUrl.searchParams.get("date");
    if (!raw) {
      return NextResponse.json(
        { error: "INVALID_DATE", message: "Обязателен параметр date=<ISO-or-YYYY-MM-DD>" },
        { status: 400 }
      );
    }
    const at = parsePriceDate(raw, "12:00");
    if (!at) {
      return NextResponse.json(
        {
          error: "INVALID_DATE",
          message: `Некорректная дата: ожидался ISO 8601 или YYYY-MM-DD (date-only = ${WORKSHOP_TZ_LABEL}, 12:00)`,
        },
        { status: 400 }
      );
    }

    // 3. get_product_price_at(p_product_id, p_variant_id=NULL, p_at)
    const res = await pool.query(
      `SELECT * FROM public.get_product_price_at($1, NULL, $2)`,
      [id, at.toISOString()]
    );
    const row = (res.rows || [])[0] as unknown as PriceAtRow | undefined;
    if (!row) {
      // Функция синтезирует строку из products.price для любого живого товара —
      // пусто бывает только если товар исчез между ownership-проверкой и чтением.
      return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
    }

    return NextResponse.json({
      amount: row.amount,
      currency: row.currency,
      versionId: row.version_id ?? null,
      effectiveFrom:
        row.effective_from instanceof Date
          ? row.effective_from.toISOString()
          : new Date(row.effective_from).toISOString(),
      reason: row.reason,
      approximate: false,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("GET /api/confectioner/products/[id]/price-at error:", message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", detail: message },
      { status: 500 }
    );
  }
}
