/**
 * POST /api/services/upload — загрузка фото объявлений услуг в Storage.
 *
 * Принимает multipart/form-data:
 *   - files (file[], 1..8 файлов, image/jpeg|png|webp, max 10 МБ каждый)
 *
 * Логика:
 *   1. Требует роль провайдера услуг (SERVICE_PROVIDER_ROLES).
 *   2. Загружает файлы в public-бакет "product_images" по пути
 *      {userId}/{timestamp}-{i}.{ext} — совпадает с RLS-паттерном
 *      storage.foldername(name) = auth.uid()::text.
 *   3. Возвращает публичные URL. Привязка к объявлению — через
 *      POST/PATCH /api/services (поле images[]), так что один аплоад
 *      можно переиспользовать для нескольких объявлений.
 *
 * Auth: Bearer (app-JWT или GoTrue-JWT) + CSRF для мутаций.
 * Storage: storage.buckets.product_images (миграция 0026).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { SERVICE_PROVIDER_ROLES } from "@/app/api/services/route";

export const runtime = "nodejs";

const ALLOWED_IMG_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 8;
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, [...SERVICE_PROVIDER_ROLES]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Ожидается multipart/form-data" }, { status: 400 });
    }

    const files: File[] = formData.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "Не передано файлов (поле 'files')" }, { status: 400 });
    }
    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { error: `Максимум ${MAX_FILES_PER_REQUEST} файлов за один запрос (передано ${files.length})` },
        { status: 400 }
      );
    }

    const uploadedUrls: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!ALLOWED_IMG_MIME.has(file.type)) {
        return NextResponse.json(
          { error: `Файл ${file.name}: недопустимый тип ${file.type}. Допустимы: JPG, PNG, WebP` },
          { status: 400 }
        );
      }
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `Файл ${file.name}: слишком большой (макс. 10 МБ)` },
          { status: 400 }
        );
      }
      const ext = EXT_BY_MIME[file.type] || "jpg";
      const ts = Date.now();
      const filePath = `${user.id}/${ts}-${i}.${ext}`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from("product_images")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });
      if (uploadError) {
        console.error(`[services/upload] ${filePath}:`, uploadError.message);
        return NextResponse.json(
          { error: `Не удалось загрузить файл ${file.name}: ${uploadError.message}` },
          { status: 500 }
        );
      }
      const { data: { publicUrl } } = supabaseAdmin.storage
        .from("product_images")
        .getPublicUrl(filePath);
      uploadedUrls.push(publicUrl);
    }

    return NextResponse.json({ success: true, added: uploadedUrls.length, urls: uploadedUrls });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Ошибка загрузки", detail }, { status: 500 });
  }
}
