/**
 * POST /api/profile/addresses  — добавить адрес доставки
 * DELETE /api/profile/addresses?id={uuid} — удалить адрес
 *
 * Schema: public.addresses (0001_init.sql) — RLS: владелец видит/создаёт/удаляет только свои.
 *
 * POST тело: { label?: string, text: string, lat?: number, lng?: number, is_default?: boolean }
 * Если is_default=true — все остальные адреса пользователя сбрасываются в is_default=false.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { user, supabase } = await getSession();
  if (!user || !supabase) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { label, text, lat, lng, is_default } = body as {
      label?: string;
      text?: string;
      lat?: number;
      lng?: number;
      is_default?: boolean;
    };

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "Текст адреса обязателен" }, { status: 400 });
    }
    if (text.length > 300) {
      return NextResponse.json({ error: "Адрес слишком длинный (макс. 300 символов)" }, { status: 400 });
    }
    if (label && label.length > 50) {
      return NextResponse.json({ error: "Метка слишком длинная (макс. 50 символов)" }, { status: 400 });
    }

    // Если is_default=true — снимаем флаг с остальных адресов.
    if (is_default) {
      const { error: resetError } = await supabase
        .from("addresses")
        .update({ is_default: false })
        .eq("user_id", user.id)
        .eq("is_default", true);
      if (resetError) {
        console.warn("[profile/addresses] reset is_default error:", resetError.message);
      }
    }

    const { data, error } = await supabase
      .from("addresses")
      .insert({
        user_id: user.id,
        label: label || null,
        text: text.trim(),
        lat: lat ?? null,
        lng: lng ?? null,
        is_default: !!is_default,
      })
      .select("id, label, text, lat, lng, is_default, created_at")
      .single();

    if (error) {
      console.error("[profile/addresses] insert error:", error.message);
      return NextResponse.json({ error: "Не удалось создать адрес", detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ id: data.id, address: data });
  } catch (error: any) {
    console.error("[profile/addresses] POST exception:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { user, supabase } = await getSession();
  if (!user || !supabase) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const addressId = searchParams.get("id");
    if (!addressId) {
      return NextResponse.json({ error: "Не указан id адреса" }, { status: 400 });
    }

    // Удаляем адрес (RLS гарантирует что можно удалить только свой)
    const { error } = await supabase
      .from("addresses")
      .delete()
      .eq("id", addressId)
      .eq("user_id", user.id);

    if (error) {
      console.error("[profile/addresses] delete error:", error.message);
      return NextResponse.json({ error: "Не удалось удалить адрес" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[profile/addresses] DELETE exception:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
