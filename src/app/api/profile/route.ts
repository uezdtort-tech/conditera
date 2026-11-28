/**
 * GET /api/profile   — текущий профиль (name, phone, bio, avatar_url, city, addresses)
 * PATCH /api/profile — обновление полей профиля (name, phone, bio, avatar_url, city)
 *
 * Schema: public.profiles (0001_init.sql) — RLS: владелец может читать/писать свою строку.
 * Schema: public.addresses (0001_init.sql) — RLS: владелец может читать/писать свои адреса.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Поля профиля, которые пользователь может обновлять. */
const ALLOWED_FIELDS = ["name", "phone", "bio", "avatar_url", "city", "default_delivery_address"] as const;
type ProfileField = (typeof ALLOWED_FIELDS)[number];

function isValidField(field: string): field is ProfileField {
  return (ALLOWED_FIELDS as readonly string[]).includes(field);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Auth: единый контракт (Bearer + cookie cd_session) — не GoTrue getSession,
  // который мёртв в локальном рантайме без Docker-стека.
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  try {
    // Загружаем профиль (владение через .eq("id", user.id) — эквивалент RLS)
    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, name, phone, bio, avatar_url, city, default_delivery_address, two_factor_enabled")
      .eq("id", user.id)
      .single();

    if (error || !profile) {
      return NextResponse.json({ error: "Профиль не найден" }, { status: 404 });
    }

    // Загружаем адреса доставки
    const { data: addresses, error: addressesError } = await supabaseAdmin
      .from("addresses")
      .select("id, label, text, lat, lng, is_default, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (addressesError) {
      console.error("[profile] GET addresses error:", addressesError.message);
      return NextResponse.json({ error: "Не удалось загрузить адреса профиля" }, { status: 500 });
    }

    return NextResponse.json({
      profile: {
        ...profile,
        avatarPublicUrl: profile.avatar_url,
      },
      addresses: addresses ?? [],
    });
  } catch (error: any) {
    console.error("[profile] GET error:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Ожидается объект с полями профиля" }, { status: 400 });
    }

    // Разрешаем только явный список полей. Проверяем типы до обращения к БД:
    // иначе PATCH принимал объекты/массивы вместо строк и мог записать мусор в профиль.
    const updates: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!isValidField(key)) continue;

      const nullableStringFields: readonly ProfileField[] = [
        "phone", "bio", "avatar_url", "city", "default_delivery_address",
      ];
      if (value === null && nullableStringFields.includes(key)) {
        updates[key] = null;
        continue;
      }
      if (typeof value !== "string") {
        return NextResponse.json({ error: `Поле «${key}» должно быть строкой` }, { status: 400 });
      }

      const normalized = value.trim();
      const maxLength: Record<ProfileField, number> = {
        name: 100,
        phone: 20,
        bio: 500,
        avatar_url: 2048,
        city: 100,
        default_delivery_address: 500,
      };
      if (normalized.length > maxLength[key]) {
        const labels: Record<ProfileField, string> = {
          name: "Имя", phone: "Телефон", bio: "Описание",
          avatar_url: "Ссылка на аватар", city: "Город",
          default_delivery_address: "Адрес доставки",
        };
        return NextResponse.json({
          error: `${labels[key]} слишком длинное (макс. ${maxLength[key]} символов)`,
        }, { status: 400 });
      }
      if (key === "name" && normalized.length === 0) {
        return NextResponse.json({ error: "Имя не может быть пустым" }, { status: 400 });
      }
      updates[key] = normalized;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Нет полей для обновления" }, { status: 400 });
    }

    // Обновляем профиль (только владелец — .eq("id", user.id))
    const { data, error } = await supabaseAdmin
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
