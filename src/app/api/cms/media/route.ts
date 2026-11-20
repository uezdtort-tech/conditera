/**
 * CMS media library. Access is restricted to users who can edit CMS content.
 * Uploaded files are checked against an explicit MIME allowlist and file signatures.
 */
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";
import { getSafeCmsMediaExtension, hasValidCmsMediaSignature } from "@/lib/cms-validation";

export const runtime = "nodejs";
const CMS_ROLES = ["ADMIN", "SUPER_ADMIN", "COPYWRITER"];
const MAX_FILE_SIZE = 50 * 1024 * 1024;

async function authorizeCmsMedia() {
  const user = await getCurrentUser();
  if (!user) return { user: null, response: unauthorizedResponse() };
  if (!user.roles.some((role: string) => CMS_ROLES.includes(role))) {
    return { user: null, response: forbiddenResponse("Недостаточно прав для управления медиатекой") };
  }
  return { user, response: null };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authorizeCmsMedia();
    if (auth.response) return auth.response;
    const type = request.nextUrl.searchParams.get("type");
    if (type && !["image", "video", "audio", "document"].includes(type)) {
      return NextResponse.json({ error: "Некорректный тип медиа" }, { status: 400 });
    }
    let query = supabaseAdmin.from("cms_media")
      .select("id,name,url,type,size_bytes,mime_type,uploaded_by,is_public,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (type) query = query.eq("type", type);
    const { data, error } = await query;
    if (error) {
      console.error("[cms/media] list failed:", error.message);
      return NextResponse.json({ error: "Не удалось загрузить медиатеку" }, { status: 500 });
    }
    return NextResponse.json({ media: data || [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authorizeCmsMedia();
    if (auth.response) return auth.response;

    const formData = await request.formData();
    const formFile = formData.get("file");
    if (!(formFile instanceof File)) {
      return NextResponse.json({ error: "Файл не предоставлен" }, { status: 400 });
    }
    if (formFile.size <= 0 || formFile.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Размер файла должен быть от 1 байта до 50 МБ" }, { status: 400 });
    }

    const extension = getSafeCmsMediaExtension(formFile.type);
    if (!extension) {
      return NextResponse.json({ error: "Этот формат файла не поддерживается" }, { status: 415 });
    }
    const fileBytes = new Uint8Array(await formFile.arrayBuffer());
    if (!hasValidCmsMediaSignature(formFile.type, fileBytes)) {
      return NextResponse.json({ error: "Содержимое файла не соответствует заявленному формату" }, { status: 415 });
    }

    const objectPath = `media/${randomUUID()}.${extension}`;
    const { error: uploadError } = await supabaseAdmin.storage.from("media").upload(objectPath, fileBytes, {
      contentType: formFile.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) {
      console.error("[cms/media] storage upload failed:", uploadError.message);
      return NextResponse.json({ error: "Не удалось загрузить файл в хранилище" }, { status: 500 });
    }

    const { data: publicData } = supabaseAdmin.storage.from("media").getPublicUrl(objectPath);
    const type = formFile.type.startsWith("image/") ? "image"
      : formFile.type.startsWith("video/") ? "video"
      : formFile.type.startsWith("audio/") ? "audio" : "document";
    const safeDisplayName = formFile.name.replace(/[\\/\\u0000-\\u001f\\u007f]/g, "_").slice(0, 180) || `upload.${extension}`;
    const { data, error } = await supabaseAdmin.from("cms_media").insert({
      name: safeDisplayName,
      url: publicData.publicUrl,
      type,
      size_bytes: formFile.size,
      mime_type: formFile.type,
      uploaded_by: auth.user!.id,
      is_public: true,
    }).select("id,name,url,type,size_bytes,mime_type,uploaded_by,is_public,created_at").single();

    if (error) {
      await supabaseAdmin.storage.from("media").remove([objectPath]);
      console.error("[cms/media] metadata insert failed:", error.message);
      return NextResponse.json({ error: "Не удалось сохранить запись медиатеки" }, { status: 500 });
    }
    return NextResponse.json({ media: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Некорректный запрос на загрузку файла" }, { status: 400 });
  }
}
