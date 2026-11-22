/**
 * sitemap.ts — Динамический sitemap.xml через Next.js metadata route.
 *
 * Источники данных:
 *   - Статичные публичные страницы (home, catalog, confectioners, etc.)
 *   - Категории каталога (CATEGORIES из mock-data — стабильные slugs)
 *   - Профили верифицированных кондитеров (только реальные данные из Supabase в production)
 *   - Статьи блога не добавляются в sitemap до появления канонического источника в БД.
 *
 * В production sitemap никогда не публикует mock-профили или демонстрационные записи.
 */
import type { MetadataRoute } from "next";
import { MOCK_CONFECTIONERS } from "@/lib/mock-data";
import { MOCK_RECIPES } from "@/lib/mock-data-extra";
import { supabaseAdmin } from "@/lib/supabase/admin";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// ISR: перегенерация sitemap раз в минуту (v3 ТЗ, Medium-16).
// Без revalidate Next.js кэширует sitemap.ts как статический route —
// новые кондитеры (register→approve) не попадали в sitemap до рестарта сервера.
export const revalidate = 60;

// Статичные публичные страницы с приоритетами
const STATIC_PAGES: { path: string; priority: number; changeFreq: "daily" | "weekly" | "monthly" }[] = [
  { path: "", priority: 1.0, changeFreq: "daily" },
  { path: "catalog", priority: 0.9, changeFreq: "daily" },
  { path: "confectioners", priority: 0.9, changeFreq: "daily" },
  { path: "ready-made", priority: 0.7, changeFreq: "weekly" },
  { path: "for-confectioners", priority: 0.6, changeFreq: "monthly" },
  { path: "for-suppliers", priority: 0.6, changeFreq: "monthly" },
  { path: "faq", priority: 0.5, changeFreq: "monthly" },
  { path: "about", priority: 0.5, changeFreq: "monthly" },
  { path: "contacts", priority: 0.5, changeFreq: "monthly" },
];

/**
 * Загрузить верифицированных кондитеров из Supabase (camelCase columns, migration 0017).
 * В development допускается mock fallback; production при ошибке или пустой БД возвращает пустой список.
 */
async function fetchVerifiedConfectioners(): Promise<{ id: string; slug: string; updatedAt: string }[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("confectioners")
      .select("id, slug, updatedAt")
      .eq("verified", true);
    if (error) {
      console.warn("[sitemap] Supabase query failed:", error.message);
      if (process.env.NODE_ENV === "production") return [];
      return MOCK_CONFECTIONERS.filter((c) => c.verified).map((c) => ({
        id: c.id,
        slug: c.slug,
        updatedAt: c.joinedAt,
      }));
    }
    if (!data || data.length === 0) {
      if (process.env.NODE_ENV === "production") return [];
      return MOCK_CONFECTIONERS.filter((c) => c.verified).map((c) => ({
        id: c.id,
        slug: c.slug,
        updatedAt: c.joinedAt,
      }));
    }
    return data as { id: string; slug: string; updatedAt: string }[];
  } catch (e) {
    console.warn("[sitemap] Confectioners fetch exception:", (e as Error).message);
    if (process.env.NODE_ENV === "production") return [];
    return MOCK_CONFECTIONERS.filter((c) => c.verified).map((c) => ({
      id: c.id,
      slug: c.slug,
      updatedAt: c.joinedAt,
    }));
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  // 1. Статичные страницы
  for (const page of STATIC_PAGES) {
    entries.push({
      url: `${APP_URL}/${page.path}`,
      lastModified: now,
      changeFrequency: page.changeFreq,
      priority: page.priority,
    });
  }

  // 2. Профили верифицированных кондитеров (в production — только Supabase)
  // Чистые slug-URL /confectioners/<slug> (роут src/app/confectioners/[slug]/page.tsx).
  // Query-URL (?confectioner=<id>) поисковики не индексируют как отдельные страницы.
  try {
    const confectioners = await fetchVerifiedConfectioners();
    for (const c of confectioners) {
      if (typeof c.slug !== "string" || !c.slug.trim()) continue;
      const updatedAt = c.updatedAt ? new Date(c.updatedAt) : now;
      entries.push({
        url: `${APP_URL}/confectioners/${encodeURIComponent(c.slug.trim())}`,
        lastModified: Number.isNaN(updatedAt.getTime()) ? now : updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      });
    }
  } catch (e) {
    console.warn("[sitemap] Confectioners failed:", (e as Error).message);
  }

  // 3. Демонстрационные рецепты не публикуются в production sitemap.
  if (process.env.NODE_ENV !== "production") {
    try {
      for (const r of MOCK_RECIPES) {
        entries.push({
          url: `${APP_URL}/recipes?id=${r.id}`,
          lastModified: now,
          changeFrequency: "monthly" as const,
          priority: 0.5,
        });
      }
    } catch (e) {
      console.warn("[sitemap] Recipes failed:", (e as Error).message);
    }
  }

  return entries;
}
