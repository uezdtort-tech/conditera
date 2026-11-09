/**
 * GET /api/moderator/queue
 *
 * Объединённая очередь модерации — все типы контента в одном ответе.
 *
 * Query: ?type=all|reviews|fillings|recipes|banners|confectioners|organizations
 *        ?status=pending|all
 *
 * Возвращает: { items: ModerationItem[], stats: { total, byType, byStatus } }
 *
 * Каждый item: { id, type, title, author, status, createdAt, preview, actions: [...] }
 *
 * Безопасность:
 *   • GET: требует роль MODERATOR/ADMIN/SUPER_ADMIN.
 *   • Все 6 источников загружаются параллельно через Promise.all (было последовательно).
 *   • Type-safe interfaces для каждого типа контента.
 *   • При сбое одного источника — продолжаем, не блокируем остальные.
 *   • Пустая очередь — честный пустой ответ (mock-данные удалены: RECIPE-03
 *     «禁 mock»; фейковые элементы модерации вводили оператора в заблуждение).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

const ALLOWED_ROLES = ["MODERATOR", "ADMIN", "SUPER_ADMIN"] as const;

interface SupabaseError {
  message: string;
}

interface ReviewRow {
  id: string;
  rating: number;
  text: string | null;
  status: string;
  createdAt: string;
  userId: string | null;
  productId: string | null;
}

interface FillingRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  created_by: string | null;
  category: string | null;
  allergens: string[] | null;
}

interface RecipeRow {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  published_at: string | null;
  created_at: string;
  author_id: string | null;
  difficulty: string | null;
}

interface ConfectionerRow {
  id: string;
  businessName: string;
  city: string | null;
  verificationStatus: string | null;
  createdAt: string;
  userId: string;
  tariff: string | null;
  trustLevel: string | null;
}

interface OrgVerificationRow {
  id: string;
  inn: string;
  company_name: string | null;
  status: string;
  created_at: string;
  user_id: string | null;
  full_name: string | null;
}

interface BannerRow {
  id: string;
  title: string;
  subtitle: string | null;
  image: string | null;
  isActive: boolean | null;
  createdAt: string;
}

interface ModerationItem {
  id: string;
  type: "review" | "filling" | "recipe" | "confectioner" | "organization" | "banner";
  title: string;
  author: string;
  status: string;
  createdAt: string;
  preview: string;
  meta: Record<string, unknown>;
  actions: string[];
}

interface ModerationStats {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}

async function loadReviews(statusFilter: string): Promise<ModerationItem[]> {
  let query = supabaseAdmin
    .from("reviews")
    .select("id, rating, text, status, createdAt, userId, productId")
    .order("createdAt", { ascending: false })
    .limit(50);
  if (statusFilter === "pending") {
    query = query.eq("status", "pending");
  }
  const { data, error } = await query as { data: ReviewRow[] | null; error: SupabaseError | null };
  if (error || !data) return [];

  return data.map((r) => ({
    id: r.id,
    type: "review" as const,
    title: `Отзыв ${r.rating}★ на товар`,
    author: r.userId || "Аноним",
    status: r.status,
    createdAt: r.createdAt,
    preview: (r.text || "").slice(0, 200),
    meta: { rating: r.rating, productId: r.productId },
    actions: r.status === "pending" ? ["approve", "reject"] : [],
  }));
}

async function loadFillings(statusFilter: string): Promise<ModerationItem[]> {
  let query = supabaseAdmin
    .from("fillings")
    .select("id, name, description, status, created_at, created_by, category, allergens")
    .order("created_at", { ascending: false })
    .limit(50);
  if (statusFilter === "pending") {
    query = query.eq("status", "PENDING");
  }
  const { data, error } = await query as { data: FillingRow[] | null; error: SupabaseError | null };
  if (error || !data) return [];

  return data.map((f) => ({
    id: f.id,
    type: "filling" as const,
    title: `Начинка: ${f.name}`,
    author: f.created_by || "Системная",
    status: f.status.toLowerCase(),
    createdAt: f.created_at,
    preview: (f.description || "").slice(0, 200),
    meta: { category: f.category, allergens: f.allergens || [] },
    actions: f.status === "PENDING" ? ["approve", "reject"] : [],
  }));
}

async function loadRecipes(statusFilter: string): Promise<ModerationItem[]> {
  let query = supabaseAdmin
    .from("recipes")
    .select("id, title, description, status, published_at, created_at, author_id, difficulty")
    .order("created_at", { ascending: false })
    .limit(50);
  // D6-фикс: очередь модерации — ТОЛЬКО recipes, реально отправленные на
  // модерацию (status='pending_review'). Прежний neq('status','published')
  // показывал как «ожидающие» все черновики/архивы всех авторов.
  if (statusFilter === "pending") {
    query = query.eq("status", "pending_review");
  }
  const { data, error } = await query as { data: RecipeRow[] | null; error: SupabaseError | null };
  if (error || !data) return [];

  return data.map((r) => {
    const isPublished = r.status === "published" || !!r.published_at;
    return {
      id: r.id,
      type: "recipe" as const,
      title: `Рецепт: ${r.title}`,
      author: r.author_id || "—",
      status: isPublished ? "published" : (r.status || "pending"),
      createdAt: r.created_at,
      preview: (r.description || "").slice(0, 200),
      meta: { difficulty: r.difficulty },
      actions: !isPublished ? ["approve", "reject"] : [],
    };
  });
}

async function loadConfectioners(statusFilter: string): Promise<ModerationItem[]> {
  let query = supabaseAdmin
    .from("confectioners")
    .select("id, businessName, city, verificationStatus, createdAt, userId, tariff, trustLevel")
    .order("createdAt", { ascending: false })
    .limit(50);

  if (statusFilter === "pending") {
    query = query.eq("verificationStatus", "pending");
  } else {
    query = query.in("verificationStatus", ["pending", "approved", "rejected", "needs_revision"]);
  }

  const { data, error } = await query as { data: ConfectionerRow[] | null; error: SupabaseError | null };
  if (error || !data) return [];

  return data.map((c) => ({
    id: c.id,
    type: "confectioner" as const,
    title: `Верификация: ${c.businessName}`,
    author: c.userId,
    status: c.verificationStatus || "pending",
    createdAt: c.createdAt,
    preview: `Кондитер из г. ${c.city || "—"}, тариф: ${c.tariff || "—"}, уровень: ${c.trustLevel || "—"}`,
    meta: { city: c.city, tariff: c.tariff },
    actions: c.verificationStatus === "pending" ? ["approve", "reject", "request_revision"] : [],
  }));
}

async function loadOrganizations(statusFilter: string): Promise<ModerationItem[]> {
  let query = supabaseAdmin
    .from("organization_verifications")
    .select("id, inn, company_name, status, created_at, user_id, full_name")
    .order("created_at", { ascending: false })
    .limit(50);
  if (statusFilter === "pending") {
    query = query.eq("status", "PENDING");
  }
  const { data, error } = await query as { data: OrgVerificationRow[] | null; error: SupabaseError | null };
  if (error || !data) return [];

  return data.map((o) => ({
    id: o.id,
    type: "organization" as const,
    title: `Организация: ${o.company_name || "—"}`,
    author: o.user_id || "—",
    status: (o.status || "unknown").toLowerCase(),
    createdAt: o.created_at,
    preview: `ИНН: ${o.inn}, ${o.full_name || ""}`,
    meta: { inn: o.inn },
    actions: o.status === "PENDING" ? ["approve", "reject"] : [],
  }));
}

async function loadBanners(statusFilter: string): Promise<ModerationItem[]> {
  let query = supabaseAdmin
    .from("banners")
    .select("id, title, subtitle, image, isActive, createdAt")
    .order("createdAt", { ascending: false })
    .limit(20);
  if (statusFilter === "pending") {
    query = query.eq("isActive", true);
  }
  const { data, error } = await query as { data: BannerRow[] | null; error: SupabaseError | null };
  if (error || !data) return [];

  return data.map((b) => ({
    id: b.id,
    type: "banner" as const,
    title: `Баннер: ${b.title}`,
    author: "Система",
    status: b.isActive ? "active" : "inactive",
    createdAt: b.createdAt,
    preview: b.subtitle || "",
    meta: { image: b.image },
    actions: b.isActive ? ["deactivate"] : ["activate"],
  }));
}


export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const roles = user.roles || [];
    if (!roles.some((r) => (ALLOWED_ROLES as readonly string[]).includes(r))) {
      throw new HttpError(403, "Недостаточно прав");
    }

    const sp = request.nextUrl.searchParams;
    const typeFilter = sp.get("type") || "all";
    const statusFilter = sp.get("status") || "pending";

    // === Параллельная загрузка всех нужных источников ===
    // Раньше было 6 последовательных запросов — теперь Promise.all (1 round-trip latency).
    const tasks: Array<Promise<ModerationItem[]>> = [];

    if (typeFilter === "all" || typeFilter === "reviews") {
      tasks.push(loadReviews(statusFilter).catch(() => []));
    }
    if (typeFilter === "all" || typeFilter === "fillings") {
      tasks.push(loadFillings(statusFilter).catch(() => []));
    }
    if (typeFilter === "all" || typeFilter === "recipes") {
      tasks.push(loadRecipes(statusFilter).catch(() => []));
    }
    if (typeFilter === "all" || typeFilter === "confectioners") {
      tasks.push(loadConfectioners(statusFilter).catch(() => []));
    }
    if (typeFilter === "all" || typeFilter === "organizations") {
      tasks.push(loadOrganizations(statusFilter).catch(() => []));
    }
    if (typeFilter === "all" || typeFilter === "banners") {
      tasks.push(loadBanners(statusFilter).catch(() => []));
    }

    const results = await Promise.all(tasks);
    let items: ModerationItem[] = results.flat();

    // === Статистика ===
    let stats: ModerationStats = {
      total: items.length,
      byType: {
        review: items.filter((i) => i.type === "review").length,
        filling: items.filter((i) => i.type === "filling").length,
        recipe: items.filter((i) => i.type === "recipe").length,
        confectioner: items.filter((i) => i.type === "confectioner").length,
        organization: items.filter((i) => i.type === "organization").length,
        banner: items.filter((i) => i.type === "banner").length,
      },
      byStatus: {
        pending: items.filter((i) =>
          i.status === "pending" || i.status === "PENDING"
        ).length,
        approved: items.filter((i) =>
          i.status === "approved" || i.status === "APPROVED"
        ).length,
        rejected: items.filter((i) =>
          i.status === "rejected" || i.status === "REJECTED"
        ).length,
        published: items.filter((i) => i.status === "published").length,
      },
    };

    return NextResponse.json({ items, stats });
  } catch (error) {
    return handleRouteError(error);
  }
}
