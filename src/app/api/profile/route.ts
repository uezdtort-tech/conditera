/**
 * GET /api/profile   — текущий профиль (name, phone, bio, avatar_url, city, addresses)
 * PATCH /api/profile — обновление полей профиля (name, phone, bio, avatar_url, city)
 *
 * Schema: public.profiles (0001_init.sql) — RLS: владелец может читать/писать свою строку.
 * Schema: public.addresses (0001_init.sql) — RLS: владелец может читать/писать свои адреса.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/auth";

export const runtime = "nodejs";

/** Поля профиля, которые пользователь может обновлять. */
const ALLOWED_FIELDS = ["name", "phone", "bio", "avatar_url", "city", "default_delivery_address"] as const;
type ProfileField = (typeof ALLOWED_FIELDS)[number];

function isValidField(field: string): field is ProfileField {
  return (ALLOWED_FIELDS as readonly string[]).includes(field);
}

export async function GET(): Promise<NextResponse> {
  const { user, supabase } = await getSession();
  if (!user || !supabase) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  try {
    // Загружаем профиль (RLS пропускает только собственную строку)
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, email, name, phone, bio, avatar_url, city, default_delivery_address, two_factor_enabled")
      .eq("id", user.id)
      .single();

    if (error || !profile) {
      return NextResponse.json({ error: "Профиль не найден" }, { status: 404 });
    }

    // Загружаем адреса доставки
    const { data: addresses } = await supabase
      .from("addresses")
      .select("id, label, text, lat, lng, is_default, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    return NextResponse.json({
      profile: {
        ...profile,
        avatarPublicUrl: profile.avatar_url,
      },
      addresses: addresses || [],
    });
  } catch (error: any) {
    console.error("[profile] GET error:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { user, supabase } = await getSession();
  if (!user || !supabase) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Фильтруем только разрешённые поля (защита от mass-assignment)
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (isValidField(key)) {
        // Валидация длин
        if (key === "name" && typeof value === "string" && value.length > 100) {
          return NextResponse.json({ error: "Имя слишком длинное (макс. 100 символов)" }, { status: 400 });
        }
        if (key === "bio" && typeof value === "string" && value.length > 500) {
          return NextResponse.json({ error: "Описание слишком длинное (макс. 500 символов)" }, { status: 400 });
        }
        if (key === "phone" && typeof value === "string" && value.length > 20) {
          return NextResponse.json({ error: "Телефон слишком длинный" }, { status: 400 });
        }
        if (key === "city" && typeof value === "string" && value.length > 100) {
          return NextResponse.json({ error: "Город слишком длинный" }, { status: 400 });
        }
        updates[key] = value;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Нет полей для обновления" }, { status: 400 });
    }

    // Обновляем профиль (RLS пропускает только владельца)
    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select("id, email, name, phone, bio, avatar_url, city")
      .single();

    if (error) {
      console.error("[profile] PATCH error:", error.message);
      return NextResponse.json({ error: "Не удалось обновить профиль", detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ profile: data });
  } catch (error: any) {
    console.error("[profile] PATCH exception:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
