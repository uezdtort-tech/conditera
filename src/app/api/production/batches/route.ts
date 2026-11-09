/**
 * /api/production/batches — производственные партии (RECIPE-02/05, RA.11.1).
 *
 * Партия — единственный бизнес-ключ списания вне заказа (ТЗ §5: «устойчивый
 * идентификатор производственной партии»); ссылки на card_version_id
 * (NOT NULL, RESTRICT) — списание без card_version запрещено (RB.15).
 *
 * POST — создать партию (status='planned'); только ВЛАДЕЛЕЦ карты, к версии
 *         которой привязана партия. planned_unit — канон г/мл/шт (RA.11.1).
 * GET  — список СВОИХ партий (+filters card_version_id/status); ADMIN — все.
 *
 * PATCH (статусные переходы RB.15) — в batches/[id]/route.ts.
 *
 * Схема: recipe_production_batches (0070:265-283), запись через service_role
 * (supabaseAdmin) — RB.16 (owner_id клиенту не доверяется).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { unauthorizedResponse } from "@/lib/supabase/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import {
  isAdminRole,
  isSupplierRole,
  hasProductionRole,
  isUuid,
  parsePositiveNumber,
  parseCanonicalPlannedUnit,
  serializeBatch,
  type BatchRow,
  type CardRow,
} from "@/lib/recipes/production";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const NOTES_MAX = 2000;

// ============================================================================
// POST /api/production/batches — создать партию (status='planned')
// ============================================================================
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    // ПР-6: SUPPLIER не допускается в производственный контур
    if (isSupplierRole(user.roles)) {
      return NextResponse.json(
        { error: "Роль SUPPLIER не имеет доступа к производственному контуру" },
        { status: 403 }
      );
    }
    if (!hasProductionRole(user.roles)) {
      return NextResponse.json({ error: "Недостаточно прав для создания партий" }, { status: 403 });
    }

    const rl = await rateLimit({ key: `prod-batches-post:${user.id}`, limit: 60, windowMs: 60_000 });
    if (!rl.success) {
      return NextResponse.json(
        { error: "Слишком много запросов, попробуйте позже" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
    }

    // --- card_version_id (обязателен; RB.15: списание без card_version запрещено) ---
    const cardVersionId = isUuid(body.card_version_id) ? (body.card_version_id as string).trim() : null;
    if (!cardVersionId) {
      return NextResponse.json({ error: "card_version_id обязателен (uuid)" }, { status: 422 });
    }

    // --- planned_qty / planned_unit (канон г/мл/шт, RA.11.1) ---
    const plannedQty = parsePositiveNumber(body.planned_qty);
    if (plannedQty === null) {
      return NextResponse.json({ error: "planned_qty должен быть числом > 0" }, { status: 422 });
    }
    const plannedUnit = parseCanonicalPlannedUnit(body.planned_unit);
    if (!plannedUnit) {
      return NextResponse.json(
        { error: "planned_unit должен быть канонической единицей (г/мл/шт)" },
        { status: 422 }
      );
    }

    // --- order_id (опциональная привязка партии к заказу) ---
    const orderId = isUuid(body.order_id) ? (body.order_id as string).trim() : null;
    if (orderId) {
      const { data: order, error: orderErr } = await supabaseAdmin
        .from("orders")
        .select("id, confectioner_id")
        .eq("id", orderId)
        .maybeSingle();
      if (orderErr) {
        console.error("[production/batches] order lookup failed:", orderErr.message);
        return NextResponse.json({ error: "Ошибка проверки заказа" }, { status: 500 });
      }
      if (!order) {
        return NextResponse.json({ error: "Заказ не найден" }, { status: 422 });
      }
      // Заказ должен принадлежать кондитеру (или запрос от админа)
      if (
        (order as { confectioner_id: string | null }).confectioner_id !== user.id &&
        !isAdminRole(user.roles)
      ) {
        return NextResponse.json({ error: "Заказ не принадлежит вам" }, { status: 422 });
      }
    }

    // --- notes ---
    const notes =
      typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim().slice(0, NOTES_MAX)
        : null;

    // --- Владение: card_version → card → owner (владелец карты создаёт партию) ---
    const { data: version, error: verErr } = await supabaseAdmin
      .from("recipe_production_card_versions")
      .select("id, card_id")
      .eq("id", cardVersionId)
      .maybeSingle();
    if (verErr) {
      console.error("[production/batches] version lookup failed:", verErr.message);
      return NextResponse.json({ error: "Ошибка проверки версии карты" }, { status: 500 });
    }
    if (!version) {
      return NextResponse.json({ error: "Версия карты не найдена" }, { status: 404 });
    }
    const { data: card, error: cardErr } = await supabaseAdmin
      .from("recipe_production_cards")
      .select("*")
      .eq("id", (version as { card_id: string }).card_id)
      .maybeSingle();
    if (cardErr) {
      console.error("[production/batches] card lookup failed:", cardErr.message);
      return NextResponse.json({ error: "Ошибка проверки карты" }, { status: 500 });
    }
    if (!card || (card as unknown as CardRow).owner_id !== user.id) {
      return NextResponse.json(
        { error: "Партию может создать только владелец карты" },
        { status: 403 }
      );
    }

    // --- INSERT партии (status='planned'; owner_id задаёт СЕРВЕР) ---
    const { data: batch, error: insErr } = await supabaseAdmin
      .from("recipe_production_batches")
      .insert({
        card_version_id: cardVersionId,
        owner_id: user.id,
        order_id: orderId,
        planned_qty: plannedQty,
        planned_unit: plannedUnit,
        status: "planned",
        notes,
      })
      .select("*")
      .single();
    if (insErr || !batch) {
      console.error("[production/batches] insert failed:", insErr?.message);
      return NextResponse.json({ error: "Не удалось создать партию" }, { status: 500 });
    }

    return NextResponse.json({ batch: serializeBatch(batch as unknown as BatchRow) }, { status: 201 });
  } catch (error) {
    console.error("[production/batches] POST error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

// ============================================================================
// GET /api/production/batches — список своих партий (+filter card_version_id)
// Query: card_version_id, status, owner_id (только ADMIN), limit, offset
// ============================================================================
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const rl = await rateLimit({ key: `prod-batches-get:${user.id}`, limit: 120, windowMs: 60_000 });
    if (!rl.success) {
      return NextResponse.json(
        { error: "Слишком много запросов, попробуйте позже" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const { searchParams } = new URL(request.url);
    const admin = isAdminRole(user.roles);
    const cardVersionId = searchParams.get("card_version_id");
    const status = searchParams.get("status");
    const ownerFilter = searchParams.get("owner_id");
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);

    let query = supabaseAdmin
      .from("recipe_production_batches")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (!admin) {
      query = query.eq("owner_id", user.id);
    } else if (ownerFilter && isUuid(ownerFilter)) {
      query = query.eq("owner_id", ownerFilter.trim());
    }
    if (cardVersionId && isUuid(cardVersionId)) {
      query = query.eq("card_version_id", cardVersionId.trim());
    }
    if (status && ["planned", "in_progress", "completed", "cancelled"].includes(status)) {
      query = query.eq("status", status);
    }

    const { data, error, count } = await query;
    if (error) {
      console.error("[production/batches] GET failed:", error.message);
      return NextResponse.json({ error: "Не удалось получить партии" }, { status: 500 });
    }

    return NextResponse.json({
      batches: ((data ?? []) as unknown as BatchRow[]).map(serializeBatch),
      total: count ?? (data?.length ?? 0),
      limit,
      offset,
    });
  } catch (error) {
    console.error("[production/batches] GET error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
