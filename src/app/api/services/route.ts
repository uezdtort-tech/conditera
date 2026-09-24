/**
 * /api/services — объявления услуг для праздника (аниматоры, шоу, квесты,
 * мастер-классы, фото). Live-витрина страницы /services-shop.
 *
 * GET  — public: активные услуги (фильтры category/city/provider_id/provider_role/mine/limit/offset)
 * POST — создать объявление (роли провайдеров услуг, см. SERVICE_PROVIDER_ROLES)
 *
 * Таблица: service_products (миграция 0029, snake_case, price в КОПЕЙКАХ).
 *
 * Ответы:
 *   { services: [...], meta: { limit, offset, count } }
 *
 * Каждая запись обогащается профилем провайдера (profiles.id = auth.users.id):
 *   provider_name / provider_avatar / provider_verified.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { safeJsonBody, requireField } from "@/lib/http-helpers";
import type { user_role } from "@/lib/supabase/types";

export const runtime = "nodejs";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 60;

/** Роли, которым разрешено размещать объявления услуг. */
export const SERVICE_PROVIDER_ROLES: user_role[] = [
  "ANIMATOR_AGENCY",
  "RECREATION_CENTER",
  "KIDS_CLUB",
  "VENUE_OWNER",
  "EVENT_ORGANIZER",
  "FOOD_SERVICE",
  "ADMIN",
];

const PRICE_TYPES = ["fixed", "per_hour", "per_event", "per_guest"] as const;
const SERVICE_FORMATS = ["venue", "travel", "both"] as const;

const MAX_PRICE = 100_000_000; // 1 000 000 ₽ в копейках
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 4000;

interface ServiceRow {
  id: string;
  provider_id: string;
  provider_role: string;
  title: string;
  description: string | null;
  category: string;
  price_type: string;
  price: number;
  old_price: number | null;
  duration_minutes: number | null;
  age_min: number | null;
  age_max: number | null;
  city: string | null;
  service_format: string;
  images: string[] | null;
  tags: string[] | null;
  includes: string[] | null;
  safety_note: string | null;
  customizable: boolean | null;
  suitable_for: string[] | null;
  is_active: boolean;
  is_verified: boolean;
  rating: number | null;
  reviews_count: number | null;
  bookings_count: number | null;
  created_at: string;
}

interface ProviderProfile {
  id: string;
  name: string | null;
  avatar_url: string | null;
  is_verified: boolean | null;
}

/** Обогащение провайдерами (batch lookup, как в /api/products). */
async function enrichWithProviders(rows: ServiceRow[]) {
  const providerIds = [...new Set(rows.map((r) => r.provider_id))];
  if (providerIds.length === 0) return;

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, name, avatar_url, is_verified")
    .in("id", providerIds);

  const map = new Map<string, ProviderProfile>(
    ((profiles || []) as ProviderProfile[]).map((p) => [p.id, p])
  );
  for (const row of rows) {
    const p = map.get(row.provider_id);
    (row as ServiceRow & { provider?: ProviderProfile | null }).provider = p ?? null;
  }
}

/**
 * GET /api/services — список активных услуг (или своих при mine=1).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const city = searchParams.get("city");
    const providerId = searchParams.get("provider_id");
    const providerRole = searchParams.get("provider_role");
    const mine = searchParams.get("mine") === "1";
    const limit = Math.min(
      parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
      MAX_LIMIT
    );
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);
    const sort = searchParams.get("sort") || "popular";

    // mine=1 — свои объявления (включая неактивные): требует auth
    let selfId: string | null = null;
    if (mine) {
      const user = await getUserFromRequest(request);
      if (!user) {
        return NextResponse.json({ error: "Необходима аутентификация" }, { status: 401 });
      }
      selfId = user.id;
    }

    let query = supabaseAdmin
      .from("service_products")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (selfId) {
      query = query.eq("provider_id", selfId);
    } else {
      query = query.eq("is_active", true);
    }

    if (category) query = query.eq("category", category);
    if (city) query = query.ilike("city", `%${city}%`);
    if (providerId) query = query.eq("provider_id", providerId);
    if (providerRole) query = query.eq("provider_role", providerRole);

    const { data, error } = await query;
    if (error) {
      console.error("[services] GET db error:", error.message);
      return NextResponse.json({ error: "Не удалось загрузить услуги" }, { status: 500 });
    }

    const rows = (data || []) as ServiceRow[];
    await enrichWithProviders(rows);

    // Сортировка (по умолчанию — популярные)
    if (sort === "price_asc") rows.sort((a, b) => a.price - b.price);
    else if (sort === "price_desc") rows.sort((a, b) => b.price - a.price);
    else if (sort === "rating") rows.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    else if (sort === "popular")
      rows.sort(
        (a, b) =>
          (b.bookings_count ?? 0) - (a.bookings_count ?? 0) || (b.rating ?? 0) - (a.rating ?? 0)
      );

    return NextResponse.json({
      services: rows,
      meta: { limit, offset, count: rows.length },
    });
  } catch (error: any) {
    console.error("[services] GET unexpected:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

/**
 * POST /api/services — создать объявление услуги.
 * Разрешено ролям провайдеров (SERVICE_PROVIDER_ROLES).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Необходима аутентификация" }, { status: 401 });
    }

    const guard = await requireAnyRole(user.id, SERVICE_PROVIDER_ROLES);
    if (guard) {
      return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });
    }

    const { data: body, error: bodyErr } = await safeJsonBody<Record<string, unknown>>(request);
    if (bodyErr || !body) {
      return NextResponse.json({ error: bodyErr || "Невалидное тело" }, { status: 400 });
    }

    // Обязательные поля
    const titleErr = requireField(body.title, "title");
    if (titleErr) return NextResponse.json({ error: titleErr }, { status: 422 });
    const categoryErr = requireField(body.category, "category");
    if (categoryErr) return NextResponse.json({ error: categoryErr }, { status: 422 });

    const title = String(body.title).trim();
    if (title.length > MAX_TITLE) {
      return NextResponse.json(
        { error: `title слишком длинный (макс ${MAX_TITLE} символов)` },
        { status: 422 }
      );
    }
    if (typeof body.price !== "number" || body.price < 0 || body.price > MAX_PRICE) {
      return NextResponse.json(
        { error: "price должен быть числом в копейках (0..100000000)" },
        { status: 422 }
      );
    }

    const priceType = PRICE_TYPES.includes(body.price_type as (typeof PRICE_TYPES)[number])
      ? (body.price_type as string)
      : "fixed";
    const serviceFormat = SERVICE_FORMATS.includes(
      body.service_format as (typeof SERVICE_FORMATS)[number]
    )
      ? (body.service_format as string)
      : "travel";

    const description =
      typeof body.description === "string" && body.description.length <= MAX_DESCRIPTION
        ? body.description.trim()
        : null;

    const insertData = {
      provider_id: user.id,
      provider_role:
        typeof body.provider_role === "string" && body.provider_role.length <= 40
          ? body.provider_role
          : "ANIMATOR_AGENCY",
      title,
      description,
      category: String(body.category).trim(),
      price_type: priceType,
      price: Math.round(body.price),
      old_price: typeof body.old_price === "number" ? Math.round(body.old_price) : null,
      duration_minutes:
        typeof body.duration_minutes === "number" && body.duration_minutes > 0
          ? Math.round(body.duration_minutes)
          : null,
      age_min: typeof body.age_min === "number" ? Math.round(body.age_min) : null,
      age_max: typeof body.age_max === "number" ? Math.round(body.age_max) : null,
      city: typeof body.city === "string" ? body.city.trim() : null,
      service_format: serviceFormat,
      images: Array.isArray(body.images)
        ? body.images.filter((i) => typeof i === "string").slice(0, 10)
        : [],
      tags: Array.isArray(body.tags) ? body.tags.filter((i) => typeof i === "string").slice(0, 15) : [],
      includes: Array.isArray(body.includes)
        ? body.includes.filter((i) => typeof i === "string").slice(0, 15)
        : [],
      suitable_for: Array.isArray(body.suitable_for)
        ? body.suitable_for.filter((i) => typeof i === "string").slice(0, 15)
        : [],
      safety_note: typeof body.safety_note === "string" ? body.safety_note.trim() : null,
      customizable: Boolean(body.customizable) || false,
      is_active: true,
    };

    const { data: created, error: insertErr } = await supabaseAdmin
      .from("service_products")
      .insert(insertData)
      .select("*")
      .single();

    if (insertErr) {
      console.error("[services] POST insert error:", insertErr.message);
      return NextResponse.json({ error: "Не удалось создать объявление" }, { status: 500 });
    }

    return NextResponse.json({ service: created }, { status: 201 });
  } catch (error: any) {
    console.error("[services] POST unexpected:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
