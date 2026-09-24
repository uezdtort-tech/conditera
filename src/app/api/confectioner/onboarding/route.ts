/**
 * POST /api/confectioner/onboarding — онбординг нового кондитера.
 *
 * Принимает multipart/form-data:
 *   - businessName (string, required, 3..100)
 *   - description (string, required, min 30 символов)
 *   - city (string, required)
 *   - phone (string, optional)
 *   - legalStatus (string: NPD | IP | OOO | PHYSICAL, required)
 *   - inn (string, optional, 10 или 12 цифр для IP/OOO)
 *   - specialization (JSON array string, optional, массив тегов)
 *   - selfPickup (string: "true" | "false", default "true")
 *   - avatar (file, optional, image/jpeg|png|webp|gif, max 5 МБ)
 *   - cover (file, optional, image/jpeg|png|webp, max 5 МБ)
 *   - portfolioFiles (file[], 0..8 файлов, image/jpeg|png|webp, max 10 МБ каждый)
 *
 * Логика:
 *   1. Требует CONFECTIONER роль.
 *   2. Если у пользователя уже есть строка в public.confectioners — возвращает 409.
 *   3. Загружает avatar в bucket "avatars", cover в bucket "covers", portfolioFiles в bucket "portfolio".
 *      Путь: {userId}/{timestamp}-{i}.{ext} — RLS требует storage.foldername(name) = auth.uid()::text.
 *   4. Создаёт public.confectioners строку с verified=false, verificationStatus="pending".
 *   5. Запускает tryAutoApprove() — если ИНН валиден через DaData, авто-подтверждает.
 *   6. Отправляет админам push-уведомление.
 *
 * Auth: CONFECTIONER
 *
 * Schema: public.confectioners (migration 0017, camelCase)
 *         storage.buckets: avatars, covers, portfolio (migration 0026)
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// ===== Валидации =====
const ALLOWED_IMG_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;       // 5 МБ
const MAX_COVER_SIZE = 5 * 1024 * 1024;       // 5 МБ
const MAX_PORTFOLIO_SIZE = 10 * 1024 * 1024;  // 10 МБ
const MAX_PORTFOLIO_FILES = 8;
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const VALID_LEGAL_STATUSES = new Set(["NPD", "IP", "OOO", "PHYSICAL"]);
const VALID_TAX_MODES = new Set(["NPD", "IP", "OOO", "SELF_EMPLOYED"]);

/**
 * Загрузить файл в Supabase Storage bucket. Возвращает public URL.
 * Путь: {userId}/{timestamp}-{i}.{ext}  — соответствует RLS storage.foldername(name) = auth.uid().
 */
async function uploadToStorage(
  file: File,
  bucket: string,
  userId: string,
  index = 0
): Promise<{ publicUrl: string } | { error: string }> {
  if (!ALLOWED_IMG_MIME.has(file.type)) {
    return { error: `Файл ${file.name}: недопустимый тип ${file.type}. Допустимы: JPG, PNG, WebP, GIF` };
  }

  const max = bucket === "portfolio" ? MAX_PORTFOLIO_SIZE : MAX_AVATAR_SIZE;
  if (file.size > max) {
    const mb = Math.round(max / 1024 / 1024);
    return { error: `Файл ${file.name}: слишком большой (макс. ${mb} МБ)` };
  }

  const ext = EXT_BY_MIME[file.type] || "jpg";
  const ts = Date.now();
  const filePath = `${userId}/${ts}-${index}.${ext}`;

  // Используем server-side admin client (service role bypasses RLS).
  // Файл пишется в приватный объект storage.objects с правильным путём,
  // что соответствует RLS policy "avatars_owner_write" (foldername = userId).
  const { error: uploadError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });

  if (uploadError) {
    console.error(`[onboarding] upload ${bucket}/${filePath} error:`, uploadError.message);
    return { error: `Не удалось загрузить файл ${file.name}: ${uploadError.message}` };
  }

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from(bucket)
    .getPublicUrl(filePath);

  return { publicUrl };
}

/**
 * Сгенерировать slug из businessName (transliteration + lowercase + dashes).
 * Если результат не уникален — добавить суффикс -{shortId}.
 */
function transliterateSlug(text: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
    з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
    ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const lower = text.toLowerCase().trim();
  let result = "";
  for (const ch of lower) {
    if (map[ch] !== undefined) result += map[ch];
    else if (/[a-z0-9\s-]/.test(ch)) result += ch;
  }
  result = result.replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
  return result || "confectioner";
}

async function generateUniqueSlug(businessName: string): Promise<string> {
  const base = transliterateSlug(businessName);
  let candidate = base;
  let attempt = 0;
  // Проверяем уникальность через DB
  while (attempt < 10) {
    const { data } = await supabaseAdmin
      .from("confectioners")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
    // Добавляем суффикс
    candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    attempt++;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ===== Auth: требует CONFECTIONER =====
  const { user, supabase } = await getSession();
  if (!user || !supabase) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  // Загружаем роли
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("is_active", true);
  const hasConfectionerRole = (roles || []).some((r: { role: string }) => r.role === "CONFECTIONER");
  if (!hasConfectionerRole) {
    return NextResponse.json(
      { error: "Требуется роль CONFECTIONER. Обратитесь к администратору." },
      { status: 403 }
    );
  }

  // ===== Парсим multipart =====
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e: any) {
    return NextResponse.json({ error: "Ожидается multipart/form-data" }, { status: 400 });
  }

  const businessName = (formData.get("businessName") as string | null)?.trim();
  const description = (formData.get("description") as string | null)?.trim();
  const city = (formData.get("city") as string | null)?.trim();
  const phone = (formData.get("phone") as string | null)?.trim();
  const legalStatusRaw = (formData.get("legalStatus") as string | null)?.trim();
  const inn = (formData.get("inn") as string | null)?.trim();
  const specializationRaw = formData.get("specialization") as string | null;
  const selfPickupRaw = (formData.get("selfPickup") as string | null) ?? "true";

  // ===== Валидация =====
  if (!businessName || businessName.length < 3 || businessName.length > 100) {
    return NextResponse.json(
      { error: "Название бизнеса должно быть 3..100 символов", field: "businessName" },
      { status: 400 }
    );
  }
  if (!description || description.length < 30) {
    return NextResponse.json(
      { error: `Описание должно быть минимум 30 символов (сейчас ${description?.length || 0})`, field: "description" },
      { status: 400 }
    );
  }
  if (!city) {
    return NextResponse.json({ error: "Город обязателен", field: "city" }, { status: 400 });
  }
  if (!legalStatusRaw || !VALID_LEGAL_STATUSES.has(legalStatusRaw)) {
    return NextResponse.json(
      { error: "legalStatus должен быть NPD | IP | OOO | PHYSICAL", field: "legalStatus" },
      { status: 400 }
    );
  }
  const legalStatus = legalStatusRaw as "NPD" | "IP" | "OOO" | "PHYSICAL";

  // ИНН обязателен для IP/OOO
  if ((legalStatus === "IP" || legalStatus === "OOO") && (!inn || !/^\d{10}$|^\d{12}$/.test(inn))) {
    return NextResponse.json(
      { error: "Для ИП/ООО укажите ИНН (10 или 12 цифр)", field: "inn" },
      { status: 400 }
    );
  }

  let specialization: string[] = [];
  if (specializationRaw) {
    try {
      specialization = JSON.parse(specializationRaw);
      if (!Array.isArray(specialization)) throw new Error("not array");
      specialization = specialization.filter((s: unknown) => typeof s === "string").slice(0, 20);
    } catch {
      return NextResponse.json(
        { error: "specialization должен быть JSON-массивом строк", field: "specialization" },
        { status: 400 }
      );
    }
  }

  const selfPickup = selfPickupRaw === "true";

  // ===== Проверка: нет ли уже строки кондитера =====
  const { data: existing } = await supabaseAdmin
    .from("confectioners")
    .select("id, verificationStatus")
    .eq("userId", user.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      {
        error: `Профиль кондитера уже существует (статус: ${existing.verificationStatus})`,
        confectionerId: existing.id,
      },
      { status: 409 }
    );
  }

  // ===== Загрузка файлов =====
  const avatarFile = formData.get("avatar") as File | null;
  const coverFile = formData.get("cover") as File | null;
  const portfolioFiles: File[] = [];
  // FormData.getAll возвращает все значения с этим key
  const portfolioRaw = formData.getAll("portfolioFiles");
  for (const f of portfolioRaw) {
    if (f instanceof File) portfolioFiles.push(f);
  }
  if (portfolioFiles.length > MAX_PORTFOLIO_FILES) {
    return NextResponse.json(
      { error: `Максимум ${MAX_PORTFOLIO_FILES} файлов портфолио (передано ${portfolioFiles.length})` },
      { status: 400 }
    );
  }

  // Avatar
  let avatarUrl = "";
  if (avatarFile && avatarFile.size > 0) {
    const res = await uploadToStorage(avatarFile, "avatars", user.id);
    if ("error" in res) {
      return NextResponse.json({ error: res.error, field: "avatar" }, { status: 400 });
    }
    avatarUrl = res.publicUrl;
  }

  // Cover (optional)
  let coverUrl: string | undefined;
  if (coverFile && coverFile.size > 0) {
    const res = await uploadToStorage(coverFile, "covers", user.id);
    if ("error" in res) {
      return NextResponse.json({ error: res.error, field: "cover" }, { status: 400 });
    }
    coverUrl = res.publicUrl;
  }

  // Portfolio files
  const portfolioImages: string[] = [];
  for (let i = 0; i < portfolioFiles.length; i++) {
    const res = await uploadToStorage(portfolioFiles[i], "portfolio", user.id, i);
    if ("error" in res) {
      // Не падаем — просто пропускаем этот файл
      console.warn(`[onboarding] skip portfolio file ${i}: ${res.error}`);
      continue;
    }
    portfolioImages.push(res.publicUrl);
  }

  // ===== Tax mode + legal info =====
  // Маппинг legalStatus → DB enum TaxMode ('NPD'|'USN'|'OSNO'|'PSN'|'SELF_EMPLOYED',
  // миграция 0016b). Legacy-значения IP/OOO в enum отсутствуют:
  // IP → USN, OOO → OSNO (тот же маппинг, что и в supabase/seed_confectioners.sql).
  const taxMode =
    legalStatus === "PHYSICAL" ? "SELF_EMPLOYED" :
    legalStatus === "NPD" ? "NPD" :
    legalStatus === "IP" ? "USN" :
    "OSNO"; // OOO

  const legalInfo: Record<string, unknown> = {
    status: legalStatus,
    inn: inn || "",
    documentsVerified: false,
  };
  if (legalStatus === "OOO") {
    legalInfo.oooOgrn = "";
    legalInfo.oooKpp = "";
    legalInfo.oooLegalAddress = "";
    legalInfo.oooTaxSystem = "USN_6";
  }
  if (legalStatus === "IP" || legalStatus === "OOO") {
    legalInfo.npdRegisteredAt = new Date().toISOString().slice(0, 10);
  }

  // ===== Slug =====
  const slug = await generateUniqueSlug(businessName);

  // ===== Insert в confectioners =====
  const confectionerId = `conf_${user.id.slice(0, 8)}_${Date.now().toString(36)}`;
  const insertData = {
    id: confectionerId,
    userId: user.id,
    businessName,
    slug,
    description,
    avatar: avatarUrl,
    cover: coverUrl || null,
    city,
    location: {
      country: "Россия",
      region: "",
      city,
      district: "",
      street: "",
      house: "",
      apartment: "",
      postalCode: "",
      lat: 0,
      lng: 0,
      serviceRadiusKm: 30,
      deliveryCities: [city],
    },
    rating: 0,
    reviewsCount: 0,
    ordersCount: 0,
    verified: false,
    verificationStatus: "pending",
    trustLevel: "NEW",
    tariff: "START",
    legalInfo,
    taxMode,
    specialization,
    portfolioImages,
    followersCount: 0,
    responseTime: "обычно отвечает в течение часа",
    joinedAt: new Date().toISOString(),
    selfPickup,
    deliveryOptions: ["own", "courier", "pickup_point"],
    balance: 0,
    totalEarnings: 0,
    monthlyEarnings: 0,
    updatedAt: new Date().toISOString(),
  };

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("confectioners")
    .insert(insertData)
    .select("id, slug, verificationStatus")
    .single();

  if (insertErr) {
    console.error("[onboarding] insert error:", insertErr.message);
    return NextResponse.json(
      { error: "Не удалось создать профиль кондитера", detail: insertErr.message },
      { status: 500 }
    );
  }

  // ===== Попытка авто-подтверждения через DaData (non-blocking) =====
  let autoApproved = false;
  let autoApproveReason = "";
  try {
    const { tryAutoApprove } = await import("@/lib/confectioner-auto-approve");
    const result = await tryAutoApprove(confectionerId);
    autoApproved = result.autoApproved;
    autoApproveReason = result.reason ?? "";
    if (autoApproved) {
      console.info(`[onboarding] Auto-approved: ${businessName}`);
    }
  } catch (e: any) {
    console.warn("[onboarding] Auto-approve failed (non-blocking):", e?.message);
  }

  // ===== Уведомление админам (non-blocking) =====
  try {
    const { data: adminRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["ADMIN", "SUPER_ADMIN"])
      .eq("is_active", true);

    const { sendNotification } = await import("@/lib/notifications");
    for (const adminRole of adminRoles || []) {
      try {
        await sendNotification({
          userId: adminRole.user_id,
          template: "NEW_MESSAGE",
          vars: {
            senderName: "Новая заявка кондитера",
            text: `${businessName} из г. ${city} отправил профиль на модерацию`,
          },
          data: {
            type: "confectioner_onboarded",
            confectionerId,
          },
        });
      } catch (notifErr: any) {
        console.warn("[onboarding] notification failed:", notifErr?.message);
      }
    }
  } catch (e: any) {
    console.warn("[onboarding] Admin notification failed:", e?.message);
  }

  return NextResponse.json({
    success: true,
    confectionerId,
    slug: inserted.slug,
    verificationStatus: autoApproved ? "approved" : "pending",
    autoApproved,
    autoApproveReason,
    uploadedImages: {
      avatar: avatarUrl ? 1 : 0,
      cover: coverUrl ? 1 : 0,
      portfolio: portfolioImages.length,
    },
  });
}
