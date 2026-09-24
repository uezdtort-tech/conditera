/**
 * sitemap.ts — Динамический sitemap.xml через Next.js metadata route.
 *
 * Источники данных:
 *   - Статичные публичные страницы (home, catalog, confectioners, etc.)
 *   - Категории каталога (CATEGORIES из mock-data — стабильные slugs)
 *   - Профили верифицированных кондитеров (из Supabase, fallback на mock)
 *   - Статьи блога (пока mock-data, будет переведено на БД позже)
 *
 * Если БД недоступна (build-time) — sitemap содержит статичные страницы + mock data,
 * чтобы build не падал. На runtime (через ISR / cron) — реальные данные.
 */
import type { MetadataRoute } from "next";
import { CATEGORIES, MOCK_CONFECTIONERS } from "@/lib/mock-data";
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
  { path: "cake-builder", priority: 0.9, changeFreq: "weekly" },
  { path: "promotions", priority: 0.8, changeFreq: "weekly" },
  { path: "recipes", priority: 0.8, changeFreq: "weekly" },
  { path: "ready-made", priority: 0.7, changeFreq: "weekly" },
  { path: "corporate-events", priority: 0.7, changeFreq: "monthly" },
  { path: "decor-shop", priority: 0.7, changeFreq: "weekly" },
  { path: "services-shop", priority: 0.7, changeFreq: "weekly" },
  { path: "supplier-shop", priority: 0.7, changeFreq: "weekly" },
  { path: "gift-certificates", priority: 0.6, changeFreq: "monthly" },
  { path: "for-confectioners", priority: 0.6, changeFreq: "monthly" },
  { path: "for-suppliers", priority: 0.6, changeFreq: "monthly" },
  { path: "tenders", priority: 0.6, changeFreq: "weekly" },
  { path: "blog", priority: 0.7, changeFreq: "weekly" },
  { path: "reviews", priority: 0.6, changeFreq: "weekly" },
  { path: "faq", priority: 0.5, changeFreq: "monthly" },
  { path: "about", priority: 0.5, changeFreq: "monthly" },
  { path: "contacts", priority: 0.5, changeFreq: "monthly" },
  { path: "help", priority: 0.5, changeFreq: "monthly" },
  { path: "telegram-bot", priority: 0.4, changeFreq: "monthly" },
];

/**
 * Загрузить верифицированных кондитеров из Supabase (camelCase columns, migration 0017).
 * При ошибке / пустой БД — fallback на MOCK_CONFECTIONERS (build не должен падать).
 */
async function fetchVerifiedConfectioners(): Promise<{ id: string; slug: string; updatedAt: string }[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("confectioners")
      .select("id, slug, updatedAt")
      .eq("verified", true);
    if (error) {
      console.warn("[sitemap] Supabase query failed, fallback to mock:", error.message);
      return MOCK_CONFECTIONERS.filter((c) => c.verified).map((c) => ({
        id: c.id,
        slug: c.slug,
        updatedAt: c.joinedAt,
      }));
    }
    if (!data || data.length === 0) {
      // БД пуста — возвращаем mock (чтобы sitemap не был пустым на старте)
      return MOCK_CONFECTIONERS.filter((c) => c.verified).map((c) => ({
        id: c.id,
        slug: c.slug,
        updatedAt: c.joinedAt,
      }));
    }
    return data as { id: string; slug: string; updatedAt: string }[];
  } catch (e) {
    console.warn("[sitemap] Confectioners fetch exception:", (e as Error).message);
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

  // 2. Категории каталога
  try {
    for (const cat of CATEGORIES) {
      entries.push({
        url: `${APP_URL}/catalog?category=${cat.slug}`,
        lastModified: now,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      });
    }
  } catch (e) {
    console.warn("[sitemap] Categories failed:", (e as Error).message);
  }

  // 3. Профили верифицированных кондитеров (Supabase, fallback на mock)
  // Чистые slug-URL /confectioners/<slug> (роут src/app/confectioners/[slug]/page.tsx).
  // Query-URL (?confectioner=<id>) поисковики не индексируют как отдельные страницы.
  try {
    const confectioners = await fetchVerifiedConfectioners();
    for (const c of confectioners) {
      entries.push({
        url: `${APP_URL}/confectioners/${c.slug}`,
        lastModified: c.updatedAt ? new Date(c.updatedAt) : now,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      });
    }
  } catch (e) {
    console.warn("[sitemap] Confectioners failed:", (e as Error).message);
  }

  // 4. Рецепты/статьи блога (пока mock — будут переведены на БД в следующем раунде)
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

  return entries;
}
