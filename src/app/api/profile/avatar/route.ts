/**
 * POST /api/profile/avatar — загрузка аватара пользователя (multipart/form-data).
 *
 * Принимает: FormData с полем "avatar" (file).
 * Файл: image/jpeg | image/png | image/webp | image/gif, макс. 5 МБ.
 *
 * Загружает в bucket "avatars" (создан migration 0026) по пути:
 *   {userId}/{timestamp}.{ext}
 *
 * После загрузки обновляет profiles.avatar_url публичным URL.
 *
 * Storage RLS (migration 0026, policy avatars_owner_write) гарантирует,
 * что пользователь может писать только в папку с собственным user_id.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/auth";

export const runtime = "nodejs";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 МБ
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { user, supabase } = await getSession();
  if (!user || !supabase) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("avatar");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
    }

    // Валидация типа
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { error: "Допустимы только JPG, PNG, WebP, GIF" },
        { status: 400 }
      );
    }
    // Валидация размера
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Файл слишком большой (макс. 5 МБ)" },
        { status: 400 }
      );
    }

    // Путь: {userId}/{timestamp}.{ext}
    const ext = EXT_BY_MIME[file.type] || "jpg";
    const timestamp = Date.now();
    const filePath = `${user.id}/${timestamp}.${ext}`;

    // Загружаем в bucket "avatars" (RLS: владелец может писать в свою папку)
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });

    if (uploadError) {
      console.error("[profile/avatar] upload error:", uploadError.message);
      return NextResponse.json(
        { error: "Не удалось загрузить файл", detail: uploadError.message },
        { status: 500 }
      );
    }

    // Получаем публичный URL (bucket "avatars" — public)
    const { data: { publicUrl } } = supabase.storage
      .from("avatars")
      .getPublicUrl(filePath);

    // Обновляем profiles.avatar_url
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: publicUrl })
      .eq("id", user.id);

    if (updateError) {
      console.error("[profile/avatar] update profile error:", updateError.message);
      // Файл уже загружен — оставим его, но вернём предупреждение.
      return NextResponse.json({
        avatarUrl: publicUrl,
        warning: "Файл загружен, но не удалось обновить профиль",
      });
    }

    return NextResponse.json({ avatarUrl: publicUrl });
  } catch (error: any) {
    console.error("[profile/avatar] exception:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
