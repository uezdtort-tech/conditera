/**
 * POST /api/profile/addresses  — добавить адрес доставки
 * DELETE /api/profile/addresses?id={uuid} — удалить адрес
 *
 * Все операции адресов ограничены user.id из проверенной сессии.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type AddressPayload = {
  label?: unknown;
  text?: unknown;
  lat?: unknown;
  lng?: unknown;
  is_default?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: AddressPayload;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) {
      return NextResponse.json({ error: "Ожидается объект адреса" }, { status: 400 });
    }
    body = parsed as AddressPayload;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Текст адреса обязателен" }, { status: 400 });
  }
  if (text.length > 300) {
    return NextResponse.json({ error: "Адрес слишком длинный (макс. 300 символов)" }, { status: 400 });
  }

  if (body.label !== undefined && body.label !== null && typeof body.label !== "string") {
    return NextResponse.json({ error: "Метка адреса должна быть строкой" }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label.trim() : null;
  if (label && label.length > 50) {
    return NextResponse.json({ error: "Метка слишком длинная (макс. 50 символов)" }, { status: 400 });
  }

  const hasLat = body.lat !== undefined && body.lat !== null;
  const hasLng = body.lng !== undefined && body.lng !== null;
  if (hasLat !== hasLng) {
    return NextResponse.json({ error: "Широта и долгота должны быть указаны вместе" }, { status: 400 });
  }
  if (hasLat && (!validCoordinate(body.lat, -90, 90) || !validCoordinate(body.lng, -180, 180))) {
    return NextResponse.json({ error: "Некорректные координаты адреса" }, { status: 400 });
  }
  if (body.is_default !== undefined && typeof body.is_default !== "boolean") {
    return NextResponse.json({ error: "Признак основного адреса должен быть логическим" }, { status: 400 });
  }
  const isDefault = body.is_default === true;

  try {
    // Сначала создаём адрес. Не снимаем признак с текущего основного адреса,
    // пока новая запись не сохранена: ошибка INSERT не должна портить профиль.
    const { data, error } = await supabaseAdmin
      .from("addresses")
      .insert({
        user_id: user.id,
        label,
        text,
        lat: hasLat ? body.lat : null,
        lng: hasLng ? body.lng : null,
        is_default: false,
      })
      .select("id, label, text, lat, lng, is_default, created_at")
      .single();

    if (error || !data) {
      console.error("[profile/addresses] insert error:", error?.message);
      return NextResponse.json({ error: "Не удалось создать адрес" }, { status: 500 });
    }

    if (!isDefault) {
      return NextResponse.json({ id: data.id, address: data });
    }

    // Все запросы ограничены владельцем. Если назначение нового адреса
    // основным не удалось, удаляем только что созданную запись и возвращаем ошибку.
    const { data: previousDefault, error: previousDefaultError } = await supabaseAdmin
      .from("addresses")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_default", true)
      .maybeSingle();
    if (previousDefaultError) {
      await supabaseAdmin.from("addresses").delete().eq("id", data.id).eq("user_id", user.id);
      console.error("[profile/addresses] read default error:", previousDefaultError.message);
      return NextResponse.json({ error: "Не удалось назначить основной адрес" }, { status: 500 });
    }

    const { error: resetError } = await supabaseAdmin
      .from("addresses")
      .update({ is_default: false })
      .eq("user_id", user.id)
      .eq("is_default", true);
    if (resetError) {
      await supabaseAdmin.from("addresses").delete().eq("id", data.id).eq("user_id", user.id);
      console.error("[profile/addresses] reset default error:", resetError.message);
      return NextResponse.json({ error: "Не удалось назначить основной адрес" }, { status: 500 });
    }

    const { data: defaultAddress, error: defaultError } = await supabaseAdmin
      .from("addresses")
      .update({ is_default: true })
      .eq("id", data.id)
      .eq("user_id", user.id)
      .select("id, label, text, lat, lng, is_default, created_at")
      .single();

    if (defaultError || !defaultAddress) {
      await supabaseAdmin.from("addresses").delete().eq("id", data.id).eq("user_id", user.id);
      if (previousDefault?.id) {
        await supabaseAdmin.from("addresses").update({ is_default: true })
          .eq("id", previousDefault.id).eq("user_id", user.id);
      }
      console.error("[profile/addresses] set default error:", defaultError?.message);
      return NextResponse.json({ error: "Не удалось назначить основной адрес" }, { status: 500 });
    }

    return NextResponse.json({ id: defaultAddress.id, address: defaultAddress });
  } catch (error) {
    console.error("[profile/addresses] POST exception:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const addressId = searchParams.get("id");
    if (!addressId) {
      return NextResponse.json({ error: "Не указан id адреса" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("addresses")
      .delete()
      .eq("id", addressId)
      .eq("user_id", user.id);

    if (error) {
      console.error("[profile/addresses] delete error:", error.message);
      return NextResponse.json({ error: "Не удалось удалить адрес" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[profile/addresses] DELETE exception:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
