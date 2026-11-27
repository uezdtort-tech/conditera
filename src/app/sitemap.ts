/**
 * sitemap.ts — Динамический sitemap.xml через Next.js metadata route.
 *
 * Источники данных:
 *   - Статичные публичные страницы (home, catalog, confectioners, recipes, etc.)
 *   - Профили верифицированных кондитеров (живой запрос в Supabase)
 *
 * Конвергенция на реальные данные: mock-сущности (MOCK_CONFECTIONERS /
 * MOCK_RECIPES) из sitemap УДАЛЕНЫ — поисковикам не отдаём фейковые URL,
 * которых нет в БД. Если БД недоступна или пуста — динамические записи просто
 * пропускаются (sitemap не бросает исключений и не падает).
 *
 * Динамические URL рецептов (/recipes?id=…) пока НЕ добавляются: у рецептов
 * нет отдельного canonical-маршрута /recipes/<slug>, а query-URL — класс
 * дублей (см. CLOUD-PREVIEW-SEO-REPORT.md, Этап 4). Вернуть при появлении
 * slug-роута — источником станет таблица recipe_marketplace.
 */
import type { MetadataRoute } from "next";
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
  { path: "venues", priority: 0.7, changeFreq: "weekly" },
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
 * При ошибке / пустой БД — пустой список (mock-fallback удалён: фейковых
 * сущностей в sitemap быть не должно). Sitemap не должен падать.
 */
async function fetchVerifiedConfectioners(): Promise<{ id: string; slug: string; updatedAt: string }[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("confectioners")
      .select("id, slug, updatedAt")
      .eq("verified", true);
    if (error) {
      console.warn("[sitemap] Supabase query failed, skip confectioner entries:", error.message);
      return [];
    }
    return (data as { id: string; slug: string; updatedAt: string }[]) ?? [];
  } catch (e) {
    console.warn("[sitemap] Confectioners fetch exception:", (e as Error).message);
    return [];
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

  // 2. Категории каталога и рецепты — НЕ включаем query-URL (?category=…, ?id=…).
  // SPA-каноникл указывает на /catalog и /recipes, query-URL — дубли.
  // Динамические рецепты вернутся с появлением canonical-маршрута /recipes/<slug>.

  // 3. Профили верифицированных кондитеров (живой Supabase; при ошибке — skip).
  // Чистые slug-URL /confectioners/<slug> (роут src/app/confectioners/[slug]/page.tsx).
  try {
    const confectioners = await fetchVerifiedConfectioners();
    for (const c of confectioners) {
      if (!c?.slug) continue;
      entries.push({
        url: `${APP_URL}/confectioners/${c.slug}`,
        lastModified: c.updatedAt ? new Date(c.updatedAt) : now,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      });
    }
  } catch (e) {
    // Двойная страховка: sitemap никогда не бросает
    console.warn("[sitemap] Confectioners failed:", (e as Error).message);
  }

  return entries;
}
