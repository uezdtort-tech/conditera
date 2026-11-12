/**
 * POST /api/admin/price-history/correct
 *
 * Административная коррекция ТЕКУЩЕЙ открытой версии цены (ADMIN/SUPER_ADMIN).
 *
 * Правило неизменяемости истории: корректировать можно ТОЛЬКО строку с
 * effective_to IS NULL И effective_from <= now(). Закрытые исторические строки
 * задним числом менять ЗАПРЕЩЕНО → 400 HISTORICAL_IMMUTABLE (аудит цен должен
 * оставаться честным: прошлое не переписываем, только фиксируем новую версию
 * «от сейчас»).
 *
 * Транзакция (закреплённый клиент, см. withTransaction):
 *   1. set_product_price(actor=admin, source='admin_correction',
 *      effective_from=now(), p_actor_is_admin=true);
 *   2. INSERT product_price_audit 'admin_correction'
 *      details {correctedVersionId, oldAmount, newAmount}.
 *
 * Ответ 200: {newVersionId, oldAmount, newAmount, deltaRub, deltaPercent}.
 * Ошибки: 400 HISTORICAL_IMMUTABLE / VALIDATION_FAILED / PRICE_VALIDATION_FAILED,
 *         403 FORBIDDEN (не админ), 404 (версия не найдена),
 *         409 PRICE_PERIOD_CONFLICT (23P01).
 */
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/postgrest/pool";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import {
  isPriceReason,
  deltaPercent,
  withTransaction,
  PRICE_MAX_RUB,
  type PoolWithConnect,
} from "@/lib/ops/price-shared";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface VersionRow {
  id: string;
  product_id: string;
  product_variant_id: string | null;
  amount: number;
  effective_from: Date | string;
  effective_to: Date | string | null;
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Auth: только ADMIN/SUPER_ADMIN
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }
    const admin = await isAdmin(user.id);
    if (!admin) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "Только ADMIN/SUPER_ADMIN" },
        { status: 403 }
      );
    }

    // 2. Body
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }

    const versionId = typeof body.versionId === "string" ? body.versionId : "";
    if (!UUID_RE.test(versionId)) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "versionId: корректный uuid версии цены" },
        { status: 400 }
      );
    }

    const amountRaw = body.newAmount;
    const newAmount =
      typeof amountRaw === "string" && amountRaw.trim() !== "" ? Number(amountRaw) : amountRaw;
    if (typeof newAmount !== "number" || !Number.isInteger(newAmount) || newAmount < 0 || newAmount > PRICE_MAX_RUB) {
      return NextResponse.json(
        {
          error: "VALIDATION_FAILED",
          message: `newAmount должен быть целым числом RUB в диапазоне 0..${PRICE_MAX_RUB}`,
        },
        { status: 400 }
      );
    }

    // reason: полный enum 0083 (коррекция может фиксировать любую причину)
    if (!isPriceReason(body.reason)) {
      return NextResponse.json(
        {
          error: "VALIDATION_FAILED",
          message: "reason: одно из initial|ingredients|packaging|decor|logistics|fuel|electricity|labor|composition_change|other",
        },
        { status: 400 }
      );
    }
    const reason = body.reason as string;

    const comment =
      body.comment === undefined || body.comment === null
        ? null
        : typeof body.comment === "string" && body.comment.length <= 500
          ? body.comment
          : undefined;
    if (comment === undefined) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "comment: строка до 500 символов" },
        { status: 400 }
      );
    }

    const pool = getPool() as PoolWithConnect;

    // 3. Версия существует и это ТЕКУЩАЯ открытая строка
    const versionRes = await pool.query(
      `SELECT id, product_id, product_variant_id, amount, effective_from, effective_to
         FROM public.product_price_history
        WHERE id = $1`,
      [versionId]
    );
    const version = (versionRes.rows || [])[0] as VersionRow | undefined;
    if (!version) {
      return NextResponse.json({ error: "Версия цены не найдена" }, { status: 404 });
    }
    const isOpenNow =
      version.effective_to === null && new Date(version.effective_from).getTime() <= Date.now();
    if (!isOpenNow) {
      return NextResponse.json(
        {
          error: "HISTORICAL_IMMUTABLE",
          message:
            "Корректировка задним числом запрещена: менять можно только текущую открытую версию цены (effective_to IS NULL и effective_from <= now()). Закрытые исторические версии неизменяемы.",
        },
        { status: 400 }
      );
    }

    const oldAmount = version.amount;

    // 4. Транзакция: set_product_price + audit
    try {
      const outcome = await withTransaction(pool, async (client) => {
        const setRes = await client.query(
          `SELECT public.set_product_price($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result`,
          [
            user.id,
            version.product_id,
            version.product_variant_id,
            newAmount,
            new Date().toISOString(), // effective_from = now(): «от сейчас», история не трогаем
            reason,
            comment,
            "admin_correction",
            null, // cost_snapshot: коррекция цены не обязана пересчитывать себестоимость
            null, // idempotency_key: admin-коррекции идемпотентны содержательно
            true, // p_actor_is_admin
          ]
        );
        const result =
          ((setRes.rows?.[0] as { result?: { versionId?: string; noChange?: boolean } } | undefined)
            ?.result) ?? {};
        const newVersionId = result.versionId ?? version.id;

        // noChange (amount не изменился) — новой версии нет, аудит не пишем
        if (!result.noChange) {
          await client.query(
            `INSERT INTO public.product_price_audit
               (product_id, history_id, action, actor_id, details)
             VALUES ($1, $2, 'admin_correction', $3, $4::jsonb)`,
            [
              version.product_id,
              newVersionId,
              user.id,
              JSON.stringify({
                correctedVersionId: versionId,
                oldAmount,
                newAmount,
              }),
            ]
          );
        }

        return { newVersionId, noChange: !!result.noChange };
      });

      return NextResponse.json({
        newVersionId: outcome.newVersionId,
        oldAmount,
        newAmount,
        deltaRub: newAmount - oldAmount,
        deltaPercent: deltaPercent(newAmount, oldAmount),
        ...(outcome.noChange ? { noChange: true } : {}),
      });
    } catch (err) {
      const pg = asPgError(err);
      if (pg.code === "23P01") {
        return NextResponse.json(
          { error: "PRICE_PERIOD_CONFLICT", message: "Период цены пересекается с существующей версией" },
          { status: 409 }
        );
      }
      if (pg.code === "P0001") {
        const msg = pg.message ?? "Функция установки цены отклонила запрос";
        if (/access denied/i.test(msg)) {
          return NextResponse.json({ error: "FORBIDDEN", message: msg }, { status: 403 });
        }
        return NextResponse.json({ error: "PRICE_VALIDATION_FAILED", message: msg }, { status: 400 });
      }
      if (pg.code === "23505") {
        return NextResponse.json(
          { error: "IDEMPOTENCY_RACE", message: "Конкурентная коррекция той же версии" },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("POST /api/admin/price-history/correct error:", message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", detail: message },
      { status: 500 }
    );
  }
}
