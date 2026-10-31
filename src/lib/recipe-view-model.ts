/**
 * recipe-view-model.ts — чистый маппер строки БД recipe_marketplace → модель UI Recipe.
 *
 * Источник: GET /api/recipes/marketplace (список) и GET /api/recipes/marketplace/[id]
 * (карточка, select("*") — со steps_json/ingredients_json). API отдаёт snake_case-строки
 * PostgREST-шина (numeric/int8 приходят строками — числа приводим к number).
 *
 * Маппер чистый (без IO) — покрыт юнит-тестами и используется
 * в recipes-page.tsx / recipe-detail-page.tsx вместо MOCK_RECIPES из store.
 *
 * Честность отображения (что ЕСТЬ и чего НЕТ в БД recipe_marketplace, миграция 0012):
 *  - author_name в таблице нет (только author_id) — имя автора не выдумываем;
 *  - servings в таблице нет — нейтральный UI-дефолт 1 (степпер в карточке доступен);
 *  - likes/comments в таблице нет — метрики карточки: views / purchases_count / rating.
 */

import type { Recipe, RecipeDifficulty } from "@/lib/types";

/** Сырая строка recipe_marketplace из API маркетплейса (snake_case БД). */
export interface ApiRecipeMarketplaceRow {
  id: string;
  author_id: string | null;
  title: string | null;
  slug: string | null;
  description: string | null;
  base_price: number | string | null;
  is_premium: boolean | null;
  is_published: boolean | null;
  premium_price: number | string | null;
  royalty_rate: number | string | null;
  cooking_time_min: number | string | null;
  difficulty: number | string | null;
  tags: string[] | null;
  preview_image: string | null;
  views: number | string | null;
  purchases_count: number | string | null;
  rating: number | string | null;
  published_at: string | null;
  created_at: string | null;
  updated_at?: string | null;
  /** Есть только в GET /api/recipes/marketplace/[id] (select("*")) */
  steps_json?: ApiRecipeStep[] | null;
  /** Есть только в GET /api/recipes/marketplace/[id] (select("*")) */
  ingredients_json?: ApiRecipeIngredient[] | string[] | null;
}

export interface ApiRecipeStep {
  step_number?: number | string;
  description?: string;
  text?: string;
  image?: string;
  time?: number | string;
  duration?: number | string;
}

export interface ApiRecipeIngredient {
  name?: string;
  title?: string;
  qty?: string | number;
  amount?: string | number;
  quantity?: string | number;
  unit?: string;
}

const toNum = (v: unknown, fallback = 0): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
};

/**
 * difficulty в БД — 1..5 (int). UI-словарь recipes-page оперирует бакетами
 * easy/medium/hard/expert. 1-2 → easy, 3 → medium, 4 → hard, 5 → expert.
 * Вне диапазона/NULL → easy (самая мягкая подпись).
 */
export function difficultyBucket(difficulty: unknown): RecipeDifficulty {
  const d = toNum(difficulty, 1);
  if (d >= 5) return "expert";
  if (d >= 4) return "hard";
  if (d >= 3) return "medium";
  return "easy";
}

/** Человекочитаемая подпись сложности по числу 1..5 (для карточек списка). */
export function difficultyLabel(difficulty: unknown): string {
  const d = toNum(difficulty, 1);
  if (d >= 5) return "Эксперт";
  if (d >= 4) return "Сложно";
  if (d >= 3) return "Средне";
  return "Легко";
}

const nowIso = () => new Date().toISOString();

/**
 * Маппер строки API → view-модель Recipe (формат store/ui).
 * Не бросает исключений: любое поле может отсутствовать/быть NULL.
 */
export function mapMarketplaceRowToRecipe(row: ApiRecipeMarketplaceRow): Recipe {
  const basePrice = toNum(row.base_price, 0);
  const cookingTime = toNum(row.cooking_time_min, 0);
  const isPaid = basePrice > 0;

  const ingredients: Recipe["ingredients"] = (row.ingredients_json ?? [])
    .map((item) => {
      if (typeof item === "string") {
        return { name: item, amount: "", unit: "" };
      }
      const amount = item.amount ?? item.qty ?? item.quantity;
      return {
        name: item.name ?? item.title ?? "",
        amount: amount === undefined || amount === null ? "" : String(amount),
        unit: item.unit ?? "",
      };
    })
    .filter((ing) => ing.name.trim() !== "");

  const steps: Recipe["steps"] = (row.steps_json ?? [])
    .map((step, i) => ({
      title: `Шаг ${step.step_number ?? i + 1}`,
      description: step.description ?? step.text ?? "",
      image: step.image,
    }))
    .filter((step) => step.description.trim() !== "" || step.image);

  return {
    id: row.id,
    confectionerId: row.author_id ?? "",
    // Имени автора в таблице нет — не выдумываем; карточки список автора не показывают.
    confectionerName: "Автор рецепта",
    type: "recipe",
    title: row.title ?? "Без названия",
    description: row.description ?? "",
    coverImage: row.preview_image ?? "",
    prepTime: 0,
    cookTime: cookingTime,
    totalTime: cookingTime,
    difficulty: difficultyBucket(row.difficulty),
    servings: 1,
    ingredients,
    steps,
    tags: Array.isArray(row.tags) ? row.tags : [],
    category: "recipes",
    access: isPaid ? "paid" : "free",
    price: isPaid ? basePrice : undefined,
    views: toNum(row.views, 0),
    // Полей likes/comments в recipe_marketplace нет — нули, карточки их не показывают.
    likes: 0,
    comments: 0,
    published: row.is_published ?? false,
    publishedAt: row.published_at ?? undefined,
    createdAt: row.created_at ?? row.published_at ?? nowIso(),
  };
}

/** Маппинг списка строк API (GET /api/recipes/marketplace → { data: [...] }). */
export function mapMarketplaceRowsToRecipes(rows: ApiRecipeMarketplaceRow[] | null | undefined): Recipe[] {
  return (rows ?? []).map(mapMarketplaceRowToRecipe);
}
