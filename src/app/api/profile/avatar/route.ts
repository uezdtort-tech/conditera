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
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 МБ
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 6) {
    const signature = String.fromCharCode(...bytes.slice(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Auth: единый контракт (Bearer + cookie cd_session)
  const user = await getUserFromRequest(request);
  if (!user) {
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
    // Валидация размера и фактического формата: MIME из multipart легко подделать.
    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Файл пустой или слишком большой (макс. 5 МБ)" },
        { status: 400 }
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detectedMime = detectImageMime(bytes);
    if (!detectedMime || detectedMime !== file.type) {
      return NextResponse.json(
        { error: "Содержимое файла не соответствует допустимому формату изображения" },
        { status: 400 }
      );
    }

    // Путь: {userId}/{timestamp}.{ext}
    const ext = EXT_BY_MIME[detectedMime];
    const timestamp = Date.now();
    const filePath = `${user.id}/${timestamp}.${ext}`;

    // Загружаем в bucket "avatars" (локальный storage-шим /storage/v1)
    const { error: uploadError } = await supabaseAdmin.storage
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
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from("avatars")
      .getPublicUrl(filePath);

    // Обновляем profiles.avatar_url
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ avatar_url: publicUrl })
      .eq("id", user.id);

    if (updateError) {
      // Не оставляем в Storage файл, который не привязан к профилю.
      const { error: cleanupError } = await supabaseAdmin.storage.from("avatars").remove([filePath]);
      console.error("[profile/avatar] update profile error:", updateError.message);
      if (cleanupError) {
        console.error("[profile/avatar] orphan cleanup error:", cleanupError.message);
      }
      return NextResponse.json(
        { error: "Не удалось сохранить аватар в профиле" },
        { status: 500 }
      );
    }

    return NextResponse.json({ avatarUrl: publicUrl });
  } catch (error: any) {
    console.error("[profile/avatar] exception:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
