/**
 * GET /api/cms/media — список файлов медиатеки
 * POST /api/cms/media — загрузка файла (multipart/form-data → Supabase Storage)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
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
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Файл не предоставлен" }, { status: 400 });

    if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: "Файл слишком большой (макс 50 МБ)" }, { status: 400 });

    const ext = file.name.split(".").pop() || "bin";
    const fileName = `media/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const fileBuffer = await file.arrayBuffer();

    // Загрузить в Supabase Storage bucket "media"
    const { error: uploadErr } = await supabaseAdmin.storage.from("media").upload(fileName, fileBuffer, {
      contentType: file.type, cacheControl: "3600",
    });
    if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

    // Получить публичный URL
    const { data: { publicUrl } } = supabaseAdmin.storage.from("media").getPublicUrl(fileName);

    // Определить тип
    let type = "document";
    if (file.type.startsWith("image/")) type = "image";
    else if (file.type.startsWith("video/")) type = "video";
    else if (file.type.startsWith("audio/")) type = "audio";

    // Создать запись в cms_media
    const { data, error } = await supabaseAdmin.from("cms_media").insert({
      name: file.name, url: publicUrl, type, size_bytes: file.size,
      mime_type: file.type, uploaded_by: user.id, is_public: true,
    }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ media: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
