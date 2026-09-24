/**
 * POST /api/confectioner/portfolio — добавить фотографии в портфолио.
 *
 * Принимает multipart/form-data:
 *   - files (file[], 1..8 файлов, image/jpeg|png|webp, max 10 МБ каждый)
 *
 * Логика:
 *   1. Требует CONFECTIONER роль.
 *   2. Находит строку кондитера по userId.
 *   3. Если не найдена — 404 с предложением сначала пройти onboarding.
 *   4. Загружает файлы в bucket "portfolio" по пути {userId}/{timestamp}-{i}.{ext}.
 *   5. Добавляет новые URL в массив portfolioImages (concat, без дублирования).
 *   6. Лимит: суммарно portfolioImages не более 50 элементов (защита от abuse).
 *
 * Auth: CONFECTIONER
 *
 * Schema: public.confectioners.portfolioImages (TEXT[], migration 0017)
 *         storage.buckets.portfolio (migration 0026)
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ALLOWED_IMG_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 8;
const MAX_PORTFOLIO_TOTAL = 50;
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { user, supabase } = await getSession();
  if (!user || !supabase) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  // Проверка роли
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("is_active", true);
  const hasConfectionerRole = (roles || []).some((r: { role: string }) => r.role === "CONFECTIONER");
  if (!hasConfectionerRole) {
    return NextResponse.json({ error: "Требуется роль CONFECTIONER" }, { status: 403 });
  }

  // Найти кондитера по userId
  const { data: conf, error: fetchErr } = await supabaseAdmin
    .from("confectioners")
    .select("id, portfolioImages, verificationStatus")
    .eq("userId", user.id)
    .maybeSingle();

  if (fetchErr || !conf) {
    return NextResponse.json(
      { error: "Профиль кондитера не найден. Сначала пройдите onboarding: POST /api/confectioner/onboarding" },
      { status: 404 }
    );
  }

  // Парсим multipart
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

  const currentImages: string[] = (conf.portfolioImages as string[]) || [];
  if (currentImages.length + files.length > MAX_PORTFOLIO_TOTAL) {
    return NextResponse.json(
      {
        error: `Превышен лимит портфолио (макс. ${MAX_PORTFOLIO_TOTAL}, сейчас ${currentImages.length}, пытаетесь добавить ${files.length})`,
      },
      { status: 400 }
    );
  }

  // Загрузка в storage
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
      .from("portfolio")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });
    if (uploadError) {
      console.error(`[portfolio] upload ${filePath} error:`, uploadError.message);
      return NextResponse.json(
        { error: `Не удалось загрузить файл ${file.name}: ${uploadError.message}` },
        { status: 500 }
      );
    }
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from("portfolio")
      .getPublicUrl(filePath);
    uploadedUrls.push(publicUrl);
  }

  // Обновить portfolioImages
  const newPortfolio = [...currentImages, ...uploadedUrls];
  const { error: updateErr } = await supabaseAdmin
    .from("confectioners")
    .update({
      portfolioImages: newPortfolio,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", conf.id);

  if (updateErr) {
    console.error("[portfolio] update error:", updateErr.message);
    return NextResponse.json(
      { error: "Файлы загружены, но не удалось обновить профиль", detail: updateErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    added: uploadedUrls.length,
    total: newPortfolio.length,
    images: uploadedUrls,
  });
}
