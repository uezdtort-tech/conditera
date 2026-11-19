/**
 * /api/cart/[itemId] — PATCH количества позиции серверной корзины.
 *
 * PATCH {quantity: 1..99} — обновление строго СВОЕЙ строки:
 *   UPDATE cart_items SET quantity = $qty WHERE id = $itemId AND user_id = $uid
 *   (скоуп user_id — RLS bypass через supabaseAdmin, авторизация здесь).
 *   404, если строка не найдена (чужая или удалённая).
 *
 * Динамический сегмент — конвенция проекта (см. /api/chat/rooms/[id]):
 * params — Promise (Next.js 15/16).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { enforceRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit";
import { safeJsonBody } from "@/lib/http-helpers";
import { patchCartQuantitySchema, UUID_RE } from "@/lib/validations/cart";

export const runtime = "nodejs";

type SupabaseResult<T> = { data: T | null; error: { message: string } | null };

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
): Promise<NextResponse> {
  try {
    const ip = getClientIP(request);
    const blocked = await enforceRateLimit(
      request,
      `cart:${ip}`,
      RATE_LIMITS.api.limit,
      RATE_LIMITS.api.windowMs
    );
    if (blocked) return blocked as unknown as NextResponse;

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const { itemId } = await params;
    if (!itemId || !UUID_RE.test(itemId)) {
      return NextResponse.json({ error: "Некорректный id позиции" }, { status: 400 });
    }

    const { data: rawBody, error: bodyError } = await safeJsonBody(request);
    if (bodyError || !rawBody) {
      return NextResponse.json({ error: bodyError ?? "Некорректное тело запроса" }, { status: 400 });
    }
    const parsed = patchCartQuantitySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "quantity должен быть 1..99" },
        { status: 400 }
      );
    }

    const { data: updated, error } = (await supabaseAdmin
      .from("cart_items")
      .update({
        quantity: parsed.data.quantity,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId)
      .eq("user_id", user.userId)
      .select("id, quantity")) as unknown as SupabaseResult<
      Array<{ id: string; quantity: number }>
    >;

    if (error) {
      console.error("[cart] PATCH:", error.message);
      return NextResponse.json({ error: "Не удалось обновить позицию" }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: "Позиция не найдена" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, dbId: updated[0].id, quantity: updated[0].quantity });
  } catch (err) {
    console.error("PATCH /api/cart/[itemId] error:", (err as Error)?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
