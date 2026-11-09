/**
 * src/lib/recipes/recipe-content.ts — общие серверные хелперы контентного
 * контура рецептов (RECIPE-02, RB.14: /api/recipes*).
 *
 * Используется маршрутами:
 *   POST /api/recipes                   — создание черновика (состав → строки детей)
 *   GET/PATCH/DELETE /api/recipes/[id]  — карточка / полная замена состава / архивация
 *   POST /api/recipes/[id]/publish      — неизменяемый снапшот версии (RA.8.1)
 *   GET  /api/recipes/[id]/scale        — display-only пересчёт порций
 *
 * ВАЖНО (RA.9): вопрос «можно ли читать содержание рецепта» решает ТОЛЬКО
 * src/lib/recipes/access-resolver.ts — этот файл не содержит авторизационной
 * логики и не дублирует Resolver.
 *
 * ВАЖНО (безопасность): все мапперы принимают УЖЕ провалидированные zod-схемами
 * DTO. Поля author_id / status / version_no / created_at / цены клиентом
 * не задаются никогда — они проставляются только сервером в маршрутах.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

// ============================================================
// Slug (каноническая реализация; раньше дублировалась в
// marketplace-маршрутах — поведение сохранено 1:1)
// ============================================================
export function generateSlug(text: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e",
    ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
    н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
    ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const transliterated = text
    .toLowerCase()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("");
  return transliterated
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 200);
}

// ============================================================
// Postgres NUMERIC через PostgREST-шим приходит строкой —
// приводим к number для JSON-контракта (паттерн marketplace)
// ============================================================
export function coerceNumbers<T extends Record<string, unknown>>(
  row: T,
  fields: readonly string[]
): T {
  const out: Record<string, unknown> = { ...row };
  for (const f of fields) {
    const v = out[f];
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      out[f] = Number(v);
    }
  }
  return out as T;
}

/** Округление до 3 знаков (точность numeric(12,3) в схеме). */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ============================================================
// Типы DTO (структурно совпадают с zod-схемами маршрутов)
// ============================================================
export interface SubstituteDto {
  name: string;
  qty?: number | null;
  unit?: string;
  position?: number;
}

export interface IngredientDto {
  name: string;
  qty?: number | null;
  unit: string;
  display_qty?: string;
  is_optional?: boolean;
  prep_note?: string;
  group_title?: string;
  position?: number;
  substitutes?: SubstituteDto[];
}

export interface StepDto {
  position?: number;
  title?: string;
  description: string;
  time_min?: number;
  time_max?: number;
  temperature_c?: number;
  tips?: string;
}

export interface VariantDto {
  title: string;
  description?: string;
  is_default?: boolean;
  overrides?: unknown[];
  servings?: number;
}

export interface SourceDto {
  source_type: string;
  source_url?: string | null;
  source_author?: string | null;
  source_published_at?: string | null;
  import_method?: string;
  raw_payload?: unknown;
}

type Row = Record<string, unknown>;

// ============================================================
// Позиции: UNIQUE(recipe_id, position) у шагов / UNIQUE
// (recipe_id, position)-семантика состава. Явные позиции
// проверяются на валидность и уникальность; отсутствующие
// заполняются первыми свободными номерами по порядку массива.
// ============================================================
export function normalizePositions<T extends { position?: number }>(
  items: T[]
): { rows: T[]; error: string | null } {
  const used = new Set<number>();
  const assigned = new Map<number, number>();

  for (let i = 0; i < items.length; i++) {
    const p = items[i]?.position;
    if (p === undefined || p === null) continue;
    if (!Number.isInteger(p) || p < 1) {
      return { rows: [], error: "position должен быть целым числом ≥ 1" };
    }
    if (used.has(p)) {
      return { rows: [], error: `position ${p} указан более одного раза` };
    }
    used.add(p);
    assigned.set(i, p);
  }

  let cursor = 1;
  for (let i = 0; i < items.length; i++) {
    if (assigned.has(i)) continue;
    while (used.has(cursor)) cursor++;
    assigned.set(i, cursor);
    used.add(cursor);
    cursor++;
  }

  return {
    rows: items.map((it, i) => ({ ...it, position: assigned.get(i) as number })),
    error: null,
  };
}

// ============================================================
// DTO → строки БД (дети рецепта; recipe_id проставляет сервер)
// ============================================================
export function stepRowsFromDto(
  recipeId: string,
  dto: StepDto[]
): { rows: Row[]; error: string | null } {
  const norm = normalizePositions(dto);
  if (norm.error) return { rows: [], error: norm.error };
  return {
    rows: norm.rows.map((s) => ({
      recipe_id: recipeId,
      position: s.position,
      title: s.title?.trim() || null,
      description: s.description.trim(),
      time_min: s.time_min ?? null,
      time_max: s.time_max ?? null,
      temperature_c: s.temperature_c ?? null,
      tips: s.tips?.trim() || null,
    })),
    error: null,
  };
}

export function ingredientRowsFromDto(
  recipeId: string,
  dto: IngredientDto[]
): { rows: Row[]; normalized: IngredientDto[]; error: string | null } {
  const norm = normalizePositions(dto);
  if (norm.error) return { rows: [], normalized: [], error: norm.error };
  return {
    rows: norm.rows.map((ing) => ({
      recipe_id: recipeId,
      name: ing.name.trim(),
      // qty NULL = «по вкусу» (CHECK qty IS NULL OR qty > 0, миграция 0067)
      qty: ing.qty ?? null,
      unit: ing.unit,
      display_qty: ing.display_qty?.trim() || null,
      is_optional: ing.is_optional ?? false,
      prep_note: ing.prep_note?.trim() || null,
      group_title: ing.group_title?.trim() || null,
      position: ing.position,
      // sort_order (канон 0053) синхронизирован с position для старых читателей
      sort_order: (ing.position ?? 1) - 1,
    })),
    normalized: norm.rows,
    error: null,
  };
}

/** Замены маппируются на свежевставленные ингредиенты по их НОРМАЛИЗОВАННОЙ position. */
export function substituteRowsFromDto(
  ingredientIdByPosition: Map<number, string>,
  normalizedIngredients: IngredientDto[]
): { rows: Row[]; error: string | null } {
  const rows: Row[] = [];
  for (const ing of normalizedIngredients) {
    if (!ing.substitutes?.length) continue;
    const norm = normalizePositions(ing.substitutes);
    if (norm.error) return { rows: [], error: `substitutes: ${norm.error}` };
    const parentId =
      ing.position !== undefined ? ingredientIdByPosition.get(ing.position) : undefined;
    if (!parentId) {
      return {
        rows: [],
        error: "Не удалось сопоставить замену с ингредиентом (position)",
      };
    }
    for (const sub of norm.rows) {
      rows.push({
        ingredient_id: parentId,
        name: sub.name.trim(),
        qty: sub.qty ?? null,
        unit: sub.unit?.trim() || null,
        position: sub.position,
      });
    }
  }
  return { rows, error: null };
}

export function variantRowsFromDto(
  recipeId: string,
  dto: VariantDto[]
): { rows: Row[]; error: string | null } {
  return {
    rows: dto.map((v) => ({
      recipe_id: recipeId,
      title: v.title.trim(),
      description: v.description?.trim() || null,
      is_default: v.is_default ?? false,
      // overrides — JSONB-ядро (0066): [{ingredient_id, action, name?, qty?, unit?}]
      overrides: Array.isArray(v.overrides) ? v.overrides : [],
      servings: v.servings ?? null,
    })),
    error: null,
  };
}

/**
 * Строки recipe_sources. rights_confirmed ЖЁСТКО false — подтверждение прав
 * выполняется отдельным маршрутом POST /api/recipes/[id]/rights-confirm (RA.13);
 * клиентский флаг из тела игнорируется (клиенту нельзя доверять).
 */
export function sourceRowsFromDto(
  recipeId: string,
  dto: SourceDto[]
): { rows: Row[]; error: string | null } {
  return {
    rows: dto.map((s) => ({
      recipe_id: recipeId,
      source_type: s.source_type,
      source_url: s.source_url?.trim() || null,
      source_author: s.source_author?.trim() || null,
      source_published_at: s.source_published_at ?? null,
      import_method: s.import_method ?? null,
      // raw_payload хранится только для аудита (§F.7); рекламные вставки
      // никогда не попадают в steps/ingredients
      raw_payload: s.raw_payload ?? null,
      rights_confirmed: false,
    })),
    error: null,
  };
}

// ============================================================
// Чтение детей рецепта (один состав-запрос «дети DTO» для GET,
// снапшота publish, scale и rollback-каптуры PATCH)
// ============================================================
export interface RecipeChildren {
  steps: Row[];
  ingredients: Row[];
  substitutes: Row[];
  variants: Row[];
  media: Row[];
  sources: Row[];
}

export async function fetchRecipeChildren(recipeId: string): Promise<RecipeChildren> {
  const [steps, ingredients, variants, media, sources] = await Promise.all([
    supabaseAdmin
      .from("recipe_steps")
      .select("*")
      .eq("recipe_id", recipeId)
      .order("position", { ascending: true }),
    supabaseAdmin
      .from("recipe_ingredients")
      .select("*")
      .eq("recipe_id", recipeId)
      .order("position", { ascending: true }),
    supabaseAdmin
      .from("recipe_variants")
      .select("*")
      .eq("recipe_id", recipeId)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("recipe_media")
      .select(
        "id, type, url, storage_path, position, caption, origin, ai_generated, step_id, alt_text, created_at"
      )
      .eq("recipe_id", recipeId)
      .order("position", { ascending: true }),
    supabaseAdmin
      .from("recipe_sources")
      .select("*")
      .eq("recipe_id", recipeId)
      .order("created_at", { ascending: true }),
  ]);

  const ingredientRows = (ingredients.data ?? []) as Row[];
  const ingredientIds = ingredientRows.map((r) => String(r.id)).filter(Boolean);

  const substitutes = ingredientIds.length
    ? await supabaseAdmin
        .from("recipe_ingredient_substitutes")
        .select("*")
        .in("ingredient_id", ingredientIds)
        .order("position", { ascending: true })
    : { data: [] as Row[] | null };

  return {
    steps: (steps.data ?? []) as Row[],
    ingredients: ingredientRows,
    substitutes: ((substitutes.data ?? []) as Row[]) ?? [],
    variants: (variants.data ?? []) as Row[],
    media: (media.data ?? []) as Row[],
    sources: (sources.data ?? []) as Row[],
  };
}

/** Собирает ingredients[] с вложенными substitutes[] (коэрция numeric → number). */
export function assembleIngredients(
  ingredients: Row[],
  substitutes: Row[]
): Row[] {
  const byIngredient = new Map<string, Row[]>();
  for (const s of substitutes) {
    const key = String(s.ingredient_id);
    const list = byIngredient.get(key) ?? [];
    list.push(coerceNumbers(s, ["qty"]));
    byIngredient.set(key, list);
  }
  return ingredients.map((ing) => ({
    ...coerceNumbers(ing, ["qty"]),
    substitutes: byIngredient.get(String(ing.id)) ?? [],
  }));
}

/** Полный normalized-DTO карточки (root + дети одним объектом). */
export function assembleRecipeDto(
  root: Row,
  children: RecipeChildren
): Row {
  return {
    ...coerceNumbers(root, ["protein_g", "fat_g", "carb_g"]),
    steps: children.steps.map((s) => s),
    ingredients: assembleIngredients(children.ingredients, children.substitutes),
    variants: children.variants.map((v) => v),
    media: children.media.map((m) => m),
    sources: children.sources.map((s) => s),
  };
}

// ============================================================
// Неизменяемый publish-снапшот (RA.8.1): root-поля + steps +
// ingredients(+substitutes) + variants + media-манифест.
// Запись — только service_role (RLS-политик INSERT нет).
// ============================================================
export function buildRecipeSnapshot(root: Row, children: RecipeChildren): Row {
  return {
    recipe: { ...root },
    steps: children.steps,
    ingredients: assembleIngredients(children.ingredients, children.substitutes),
    variants: children.variants,
    // медиа-манифест: история воспроизводима (RA.8.1, прим.4 RB.13)
    media: children.media,
    snapshot_taken_at: new Date().toISOString(),
  };
}
