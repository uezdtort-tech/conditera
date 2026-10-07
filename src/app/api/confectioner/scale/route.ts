/**
 * PATCH /api/confectioner/scale — масштаб бизнеса (профиль возможностей).
 *
 * P0.5 Core Adaptive (ТЗ-корректировка): сложность находится внутри системы,
 * а не перекладывается на пользователя. Масштаб управляет ТОЛЬКО тем, сколько
 * операционной сложности показывать в UI:
 *
 *   home       — «домашний кондитер»: простой экран «Сегодня», одна кнопка
 *                действия на заказ, человеческие формулировки
 *                («не хватает сливок — 500 мл», а не «capacity exceeded»);
 *   business   — «ИП / ООО»: + загрузка, распределение заказов, аналитика;
 *   enterprise — «сеть / ресторан / кофейня»: полный Operations Center.
 *
 * Движки (lifecycle / capacity / risk / acceptance) общие для всех уровней —
 * это не вторая система, а адаптивность одного и того же ядра.
 *
 * Тело: { scale: "home" | "business" | "enterprise" }
 * Ответ 200: { ok: true, scale }
 * Ошибки: 401 / 403 (не кондитер) / 400 (неверный scale) / 404 (нет профиля)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SCALES = new Set(["home", "business", "enterprise"]);

export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Требуется аутентификация");
    }
    const guard = await requireAnyRole(user.id, ["CONFECTIONER", "ADMIN", "SUPER_ADMIN"]);
    if (guard) return guard;

    const { data: body, error: bodyErr } = await safeJsonBody<{ scale?: unknown }>(request);
    if (bodyErr) {
      throw new HttpError(400, "INVALID_BODY", bodyErr);
    }
    const scale = typeof body?.scale === "string" ? body.scale.trim() : "";
    if (!VALID_SCALES.has(scale)) {
      throw new HttpError(400, "INVALID_SCALE", "scale должен быть home | business | enterprise");
    }

    const { data, error } = await supabaseAdmin
      .from("confectioners")
      .update({ business_scale: scale, updatedAt: new Date().toISOString() })
      .eq("userId", user.id)
      .select("id, business_scale")
      .single();

    if (error || !data) {
      throw new HttpError(404, "NOT_FOUND", "Профиль кондитера не найден");
    }

    return NextResponse.json({ ok: true, scale: data.business_scale });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Требуется аутентификация");
    }
    const guard = await requireAnyRole(user.id, ["CONFECTIONER", "ADMIN", "SUPER_ADMIN"]);
    if (guard) return guard;

    const { data, error } = await supabaseAdmin
      .from("confectioners")
      .select("business_scale")
      .eq("userId", user.id)
      .single();

    if (error || !data) {
      throw new HttpError(404, "NOT_FOUND", "Профиль кондитера не найден");
    }

    return NextResponse.json({ scale: data.business_scale ?? "home" });
  } catch (err) {
    return handleRouteError(err);
  }
}
