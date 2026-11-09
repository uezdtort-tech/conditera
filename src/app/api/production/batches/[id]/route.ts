/**
 * /api/production/batches/[id] — статусные переходы партии (RECIPE-02, RB.15).
 *
 * PATCH — только ВЛАДЕЛЕЦ партии; переходы строго по автомату RB.15:
 *   разрешено:   planned → in_progress;  in_progress → completed;
 *                planned|in_progress → cancelled;
 *   запрещено:   completed → * (повторное списание исключено уникальностью
 *                batch_id в inventory_write_offs, RA.11.2);
 *                cancelled → in_progress (и любой другой переход).
 *
 * Гейт completed: партия должна иметь существующее списание
 * (inventory_write_offs.batch_id = партии) → иначе 409 «партия без списания».
 * Статус completed ставится ТОЛЬКО этим PATCH — списание (batch-RPC) статус
 * не меняет (RA.11: «при успехе и статусе in_progress ничего не меняет»).
 *
 * Схема: recipe_production_batches (0070), inventory_write_offs.batch_id
 * UNIQUE (0071:57-59).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { unauthorizedResponse } from "@/lib/supabase/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { isUuid, serializeBatch, type BatchRowLite } from "@/lib/recipes/production";

export const runtime = "nodejs";

const NOTES_MAX = 2000;

// Разрешённые переходы статусов (RB.15)
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  planned: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const rl = await rateLimit({ key: `prod-batch-patch:${user.id}`, limit: 60, windowMs: 60_000 });
    if (!rl.success) {
      return NextResponse.json(
        { error: "Слишком много запросов, попробуйте позже" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "id должен быть uuid" }, { status: 400 });
    }

    const { data: batch, error: loadErr } = await supabaseAdmin
      .from("recipe_production_batches")
      .select("*")
      .eq("id", id.trim())
      .maybeSingle();
    if (loadErr) {
      console.error("[production/batches/id] load failed:", loadErr.message);
      return NextResponse.json({ error: "Ошибка загрузки партии" }, { status: 500 });
    }
    if (!batch) {
      return NextResponse.json({ error: "Партия не найдена" }, { status: 404 });
    }
    const row = batch as unknown as BatchRowLite;

    // Только владелец партии (RB.14: ownership; ADMIN чужие партии не правит)
    if (row.owner_id !== user.id) {
      return NextResponse.json({ error: "Доступ только у владельца партии" }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};

    // --- notes (правка разрешена владельцу в любом статусе) ---
    if (body.notes !== undefined) {
      updates.notes =
        typeof body.notes === "string" && body.notes.trim()
          ? body.notes.trim().slice(0, NOTES_MAX)
          : null;
    }

    // --- status: переход строго по RB.15 ---
    if (body.status !== undefined) {
      const requested = typeof body.status === "string" ? body.status.trim() : null;
      if (!requested || !["planned", "in_progress", "completed", "cancelled"].includes(requested)) {
        return NextResponse.json(
          { error: "status должен быть одним из: planned | in_progress | completed | cancelled" },
          { status: 422 }
        );
      }
      const allowed = ALLOWED_TRANSITIONS[row.status] ?? [];
      if (!allowed.includes(requested)) {
        return NextResponse.json(
          {
            error: `Переход статуса «${row.status}» → «${requested}» запрещён (RB.15)`,
            allowed_transitions: allowed,
          },
          { status: 409 }
        );
      }
      if (requested === "completed") {
        // Гейт (RB.15): completed требует существующего списания этой партии
        const { data: writeOff, error: woErr } = await supabaseAdmin
          .from("inventory_write_offs")
          .select("id")
          .eq("batch_id", row.id)
          .maybeSingle();
        if (woErr) {
          console.error("[production/batches/id] write-off check failed:", woErr.message);
          return NextResponse.json({ error: "Ошибка проверки списания партии" }, { status: 500 });
        }
        if (!writeOff) {
          return NextResponse.json(
            { error: "партия без списания: completed требует выполненного списания партии" },
            { status: 409 }
          );
        }
      }
      updates.status = requested;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "Нечего обновлять (передайте status и/или notes)" },
        { status: 422 }
      );
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from("recipe_production_batches")
      .update(updates)
      .eq("id", row.id)
      .select("*")
      .single();
    if (updErr || !updated) {
      console.error("[production/batches/id] update failed:", updErr?.message);
      return NextResponse.json({ error: "Не удалось обновить партию" }, { status: 500 });
    }

    return NextResponse.json({ batch: serializeBatch(updated as unknown as BatchRowLite) });
  } catch (error) {
    console.error("[production/batches/id] PATCH error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
