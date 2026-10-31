/**
 * /api/cart/[ref] — мутация ОДНОЙ позиции серверной корзины по client_ref
 * (стабильная ссылка позиции клиентской корзины, см. миграцию 0062).
 *
 * Владение: выборка ВСЕГДА .eq("user_id", session.user.id) — чужой client_ref
 * даёт 404 (не 403 — не раскрываем существование чужих строк).
 *
 *   PATCH {quantity} → установить абсолютное количество (1..999) — идемпотентно
 *                      при ретраях клиента (клиент шлёт итоговое значение).
 *   DELETE           → удалить позицию (0 строк — тоже успех, идемпотентно).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { enforceRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit";
import { MAX_CART_QUANTITY } from "@/lib/cart-merge";

const PatchSchema = z.object({
  quantity: z.number().int().min(1).max(MAX_CART_QUANTITY),
});

function unauthorized() {
  return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
}

type RouteContext = { params: Promise<{ ref: string }> };

// ===== PATCH /api/cart/[ref] — установить количество =====
export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const blocked = await enforceRateLimit(
    request,
    `cart:patch:${getClientIP(request)}`,
    RATE_LIMITS.api.limit,
    RATE_LIMITS.api.windowMs
  );
  if (blocked) return blocked as unknown as NextResponse;

  const user = await getUserFromRequest(request);
  if (!user) return unauthorized();

  const { ref } = await context.params;
  if (!ref || ref.length > 120) {
    return NextResponse.json({ error: "Некорректный client_ref" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Некорректное количество: ${parsed.error.issues[0]?.message || "validation failed"}` },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("cart_items")
    .update({ quantity: parsed.data.quantity, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("client_ref", ref)
    .select("id");

  if (error) {
    console.error("[cart:PATCH] error:", error.message);
    return NextResponse.json({ error: "Ошибка обновления корзины" }, { status: 500 });
  }
  if (!data || data.length === 0) {
    // Позиции нет у ЭТОГО пользователя (чужая/удалённая/ещё не создана —
    // клиент преобразует в POST-upsert при следующей синхронизации)
    return NextResponse.json({ error: "Позиция не найдена" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

// ===== DELETE /api/cart/[ref] — удалить позицию =====
export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const blocked = await enforceRateLimit(
    request,
    `cart:delete:${getClientIP(request)}`,
    RATE_LIMITS.api.limit,
    RATE_LIMITS.api.windowMs
  );
  if (blocked) return blocked as unknown as NextResponse;

  const user = await getUserFromRequest(request);
  if (!user) return unauthorized();

  const { ref } = await context.params;
  if (!ref || ref.length > 120) {
    return NextResponse.json({ error: "Некорректный client_ref" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("cart_items")
    .delete()
    .eq("user_id", user.id)
    .eq("client_ref", ref);

  if (error) {
    console.error("[cart:DELETE:ref] error:", error.message);
    return NextResponse.json({ error: "Ошибка удаления из корзины" }, { status: 500 });
  }
  // 0 строк — тоже успех: повторное удаление/чужой ref не должны ломать клиента
  return NextResponse.json({ ok: true });
}
