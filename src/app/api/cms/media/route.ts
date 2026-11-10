/**
 * GET /api/cms/media — список файлов медиатеки
 * POST /api/cms/media — загрузка файла (multipart/form-data → Supabase Storage)
 *
 * Z-v21 (исправление из аудита §10): POST был доступен ЛЮБОМУ
 * аутентифицированному пользователю (без role-gate) и принимал любой
 * MIME/расширение из клиентских заголовков. Теперь:
 *   • POST — только CMS-роли (ADMIN/SUPER_ADMIN/COPYWRITER — как /api/cms/banners);
 *   • MIME определяется по магическим байтам (общий sniffMime из
 *     product-media/validation — не создаём второй механизм), нераспознанное
 *     отклоняется (fail-closed); клиентские Content-Type/имя файла не доверенные.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { sniffMime } from "@/lib/product-media/validation";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    const { searchParams } = request.nextUrl;
    const type = searchParams.get("type");

    let query = supabaseAdmin.from("cms_media").select("*");
    if (!user) query = query.eq("is_public", true);
    if (type) query = query.eq("type", type);

    const { data, error } = await query.order("created_at", { ascending: false }).limit(100);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ media: data });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    // Z-v21: CMS-медиатека — привилегированная загрузка (как banners/pages)
    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN", "COPYWRITER"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Файл не предоставлен" }, { status: 400 });

    if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: "Файл слишком большой (макс 50 МБ)" }, { status: 400 });

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Z-v21: реальный MIME по магическим байтам; нераспознанное — 415 (fail-closed).
    // Имя файла/Content-Type клиента не используются для расширения.
    const sniffed = sniffMime(fileBuffer);
    if (!sniffed) {
      return NextResponse.json(
        { error: "Неподдерживаемый тип файла (разрешены JPEG/PNG/WebP/MP4/WebM, проверка по содержимому)" },
        { status: 415 }
      );
    }
    const safeExt = sniffed.ext.replace(/[^a-z0-9]/gi, "");
    const fileName = `media/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;

    // Загрузить в Supabase Storage bucket "media"
    const { error: uploadErr } = await supabaseAdmin.storage.from("media").upload(fileName, fileBuffer, {
      contentType: sniffed.mime, cacheControl: "3600",
    });
    if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

    // Получить публичный URL
    const { data: { publicUrl } } = supabaseAdmin.storage.from("media").getPublicUrl(fileName);

    // Определить тип по содержимому
    const type = sniffed.mime.startsWith("video/") ? "video" : "image";

    // Создать запись в cms_media
    const { data, error } = await supabaseAdmin.from("cms_media").insert({
      name: file.name.slice(0, 200), url: publicUrl, type, size_bytes: file.size,
      mime_type: sniffed.mime, uploaded_by: user.id, is_public: true,
    }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ media: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
