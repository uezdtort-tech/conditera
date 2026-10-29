"use client";
/**
 * use-real-products.ts — живой каталог кондитера из /api/products для кабинета.
 *
 * Заменяет MOCK-товары store.products (zustand) реальным источником данных:
 *  - useRealProducts()               — GET  /api/products?mine=1 (свои товары:
 *                                      published + draft; archived скрыт)
 *  - useToggleProductAvailability()  — PATCH /api/products/{id} {isAvailable}
 *                                      (оптимистичный апдейт кэша + refetch)
 *  - useUpdateProductCard()          — PATCH /api/products/{id} (только изменённые
 *                                      поля контракта карточки 0052)
 *  - useCreateProduct()              — POST /api/products (ветка CONFECTIONER)
 *  - useArchiveProduct()             — PATCH /api/products/{id} {status:"archived"}
 *                                      (DELETE /api/products/{id} в API НЕТ —
 *                                      «удаление» из каталога = архивация)
 *
 * API отдаёт snake_case-строки БД (products + enrichment category_slug/images) —
 * здесь они мапятся в camelCase-модель UI. Ошибки сервера всплывают в тост
 * с сообщением бэкенда. ВНЕ контракта API не отправляется: images/fillings/
 * coatings/decorations/prepTime — таких полей нет в PATCH/POST (медиа
 * управляется отдельно через /api/products/{id}/media).
 */
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { csrfFetch } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

/** Состав в контракте карточки (camelCase JSONB products.composition). */
export interface RealProductComposition {
  ingredients: string[];
  allergens: string[];
  nutritionalValue?: { calories?: number; protein?: number; fat?: number; carbs?: number };
  storageConditions?: string;
  shelfLife?: string;
}

/** Сырая строка products из GET /api/products (snake_case БД + enrichment). */
export interface ApiProductRow {
  id: string;
  title: string | null;
  slug: string | null;
  description: string | null;
  price: number | string | null;
  old_price: number | string | null;
  category_id: string | null;
  category_slug?: string | null;
  weight_grams: number | string | null;
  servings: number | string | null;
  tags: string[] | null;
  rating_average: number | string | null;
  reviews_count: number | string | null;
  confectioner_id: string;
  status: string | null;
  is_featured?: boolean | null;
  is_available?: boolean | null;
  images?: unknown;
  composition?: Partial<RealProductComposition> | null;
  created_at?: string | null;
}

/** UI-модель товара каталога кондитера (без выдуманных колонок). */
export interface RealProduct {
  id: string;
  title: string;
  description: string;
  price: number;
  oldPrice: number | null;
  categoryId: string | null;
  categorySlug: string | null;
  weightGrams: number | null;
  servings: number | null;
  tags: string[];
  images: string[];
  status: "draft" | "published" | "archived" | string;
  isAvailable: boolean;
  isFeatured: boolean;
  rating: number;
  reviewsCount: number;
  composition: RealProductComposition | null;
  createdAt: string;
}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

/** Нормализация состава: стабильный порядок ключей — для сравнения и отправки. */
export function normalizeComposition(
  input?: Partial<RealProductComposition> | null
): RealProductComposition | null {
  if (!input) return null;
  const nv = input.nutritionalValue;
  const hasNv =
    !!nv &&
    [nv.calories, nv.protein, nv.fat, nv.carbs].some((v) => v !== undefined && v !== null);
  return {
    ingredients: asStringArray(input.ingredients),
    allergens: asStringArray(input.allergens),
    ...(hasNv && nv
      ? {
          nutritionalValue: {
            ...(nv.calories !== undefined && nv.calories !== null ? { calories: nv.calories } : {}),
            ...(nv.protein !== undefined && nv.protein !== null ? { protein: nv.protein } : {}),
            ...(nv.fat !== undefined && nv.fat !== null ? { fat: nv.fat } : {}),
            ...(nv.carbs !== undefined && nv.carbs !== null ? { carbs: nv.carbs } : {}),
          },
        }
      : {}),
    ...(input.storageConditions ? { storageConditions: input.storageConditions } : {}),
    ...(input.shelfLife ? { shelfLife: input.shelfLife } : {}),
  };
}

/** Адаптер snake_case API → UI-модель товара. */
export function mapApiProduct(raw: ApiProductRow): RealProduct {
  return {
    id: raw.id,
    title: raw.title ?? "",
    description: raw.description ?? "",
    price: num(raw.price),
    oldPrice: raw.old_price !== null && raw.old_price !== undefined ? num(raw.old_price) : null,
    categoryId: raw.category_id ?? null,
    categorySlug: raw.category_slug ?? null,
    weightGrams:
      raw.weight_grams !== null && raw.weight_grams !== undefined ? num(raw.weight_grams) : null,
    servings: raw.servings !== null && raw.servings !== undefined ? num(raw.servings) : null,
    tags: asStringArray(raw.tags),
    images: asStringArray(raw.images),
    status: raw.status ?? "published",
    isAvailable: raw.is_available !== false,
    isFeatured: raw.is_featured === true,
    rating: num(raw.rating_average),
    reviewsCount: num(raw.reviews_count),
    composition: normalizeComposition(raw.composition),
    createdAt: raw.created_at ?? "",
  };
}

/** weight_grams → человекочитаемый вес («500 г» / «1.5 кг») для карточки. */
export function weightText(grams: number | null): string {
  if (grams === null || !Number.isFinite(grams) || grams <= 0) return "";
  if (grams < 1000) return `${Math.round(grams)} г`;
  const kg = grams / 1000;
  return `${Number.isInteger(kg) ? kg : Number(kg.toFixed(1))} кг`;
}

/** Текстовая «вес» из формы → граммы (число без единицы = граммы). */
export function weightToGrams(text: string): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  if (/(кг|kg)/.test(s)) return Math.round(n * 1000);
  return Math.round(n);
}

async function fetchMyProducts(): Promise<RealProduct[]> {
  const res = await csrfFetch("/api/products?mine=1&limit=100");
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { products?: ApiProductRow[] };
  return (data.products || []).map(mapApiProduct);
}

export interface RealProductsResult {
  products: RealProduct[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/** Живой каталог вошедшего кондитера (GET /api/products?mine=1). */
export function useRealProducts(): RealProductsResult {
  const user = useAppStore((s) => s.user);
  const query = useQuery<RealProduct[], Error>({
    queryKey: ["products-real", user?.id ?? null],
    queryFn: fetchMyProducts,
    staleTime: 15_000,
    retry: 1,
    enabled: !!user,
  });
  return {
    products: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

/** Переключение доступности: PATCH /api/products/{id} {isAvailable} + optimistic. */
export function useToggleProductAvailability() {
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  return useMutation({
    mutationFn: async (input: { id: string; isAvailable: boolean }) => {
      const res = await csrfFetch(`/api/products/${input.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAvailable: input.isAvailable }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as { product?: unknown; updated?: boolean };
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["products-real"] });
      const key = ["products-real", user?.id ?? null] as const;
      const prev = queryClient.getQueryData<RealProduct[]>(key);
      queryClient.setQueryData<RealProduct[]>(key, (old) =>
        (old ?? []).map((p) => (p.id === input.id ? { ...p, isAvailable: input.isAvailable } : p))
      );
      return { prev, key };
    },
    onError: (error: Error, _input, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev);
      toast.error("Не удалось изменить доступность", { description: error.message });
    },
    onSuccess: () => {
      toast.success("Доступность товара обновлена");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["products-real"] });
    },
  });
}

/** Сохранение карточки: PATCH /api/products/{id} (только изменённые поля). */
export function useUpdateProductCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; body: Record<string, unknown> }) => {
      const res = await csrfFetch(`/api/products/${input.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        throw new Error(err?.message || err?.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as { product?: unknown; updated?: boolean };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products-real"] });
      toast.success("Изменения сохранены");
    },
    onError: (error: Error) => {
      toast.error("Не удалось сохранить товар", { description: error.message });
    },
  });
}

/** Создание товара: POST /api/products (ветка CONFECTIONER). */
export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await csrfFetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        throw new Error(err?.message || err?.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as { product?: unknown };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products-real"] });
      toast.success("Товар добавлен в каталог");
    },
    onError: (error: Error) => {
      toast.error("Не удалось добавить товар", { description: error.message });
    },
  });
}

/**
 * «Удаление» товара из каталога: DELETE /api/products/{id} в API нет,
 * поэтому персистим архивацией — PATCH {status:"archived"} (исчезает
 * из выдачи ?mine=1 и из витрины).
 */
export function useArchiveProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await csrfFetch(`/api/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        throw new Error(err?.message || err?.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as { product?: unknown; updated?: boolean };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products-real"] });
      toast.success("Товар удалён из каталога");
    },
    onError: (error: Error) => {
      toast.error("Не удалось удалить товар", { description: error.message });
    },
  });
}
