"use client";

/**
 * recipe-author-manager.tsx — менеджер авторских рецептов (RECIPE-02).
 *
 * Работает ТОЛЬКО с нормализованным контуром /api/recipes (draft → rights →
 * publish → versions → archive). Никакого mock-даты и прямых обращений к БД:
 *   • GET  /api/recipes?scope=mine&limit=100       — список своих рецептов;
 *   • POST /api/recipes                            — создание черновика;
 *   • GET  /api/recipes/[id]                       — полная карточка (состав);
 *   • PATCH /api/recipes/[id]                      — правка (полная замена
 *     переданных секций; замена sources[] СБРАСЫВАЕТ подтверждение прав);
 *   • DELETE /api/recipes/[id]                     — soft-архив (идемпотентно);
 *   • PATCH {status:"draft"}                       — восстановление из архива;
 *   • POST /api/recipes/[id]/publish               — публикация + версия;
 *   • POST /api/recipes/[id]/rights-confirm        — подтверждение прав;
 *   • GET  /api/recipes/[id]/versions              — история версий.
 *
 * ГЛАВНОЕ (RB.14): клиент НИКОГДА не задаёт status/price/version/author —
 * эти поля проставляет сервер. Оффер (цена) — только отображается из списка.
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BookOpen, Plus, RefreshCw, Pencil, Send, Archive, ArchiveRestore,
  ShieldCheck, History, AlertTriangle, ChevronUp, ChevronDown, Trash2,
  Loader2, ExternalLink, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAppStore } from "@/lib/store";
import { csrfFetch } from "@/lib/api-client";

// ============================================================
// Единый query key (импортируется дашбордом для инвалидации
// после legacy «продать через оффер»)
// ============================================================
export const MY_RECIPES_QUERY_KEY = ["my-recipes"] as const;

// ============================================================
// Типы контрактов сервера (только потребляемые поля)
// ============================================================
type RecipeStatus = "draft" | "pending_review" | "published" | "rejected" | "archived";
type CreateDifficulty = "easy" | "medium" | "hard";
type Difficulty = CreateDifficulty | "expert";
type Unit = "г" | "мл" | "шт";
type SourceType = "telegram" | "vk" | "site" | "document" | "manual";
type ImportMethod = "ai" | "manual";

/** RecipeListRow — GET /api/recipes?scope=mine (route.ts, список). */
export interface RecipeListRow {
  id: string;
  title: string;
  slug: string;
  status: RecipeStatus;
  difficulty: Difficulty | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  servings: number | null;
  category: string | null;
  tags: string[];
  image_url: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  has_source: boolean;
  /** null = источников нет; false = права не подтверждены. */
  rights_confirmed: boolean | null;
  offer: { id: string; base_price: number; is_published: boolean } | null;
}

/** Элемент sources[] в карточке GET /api/recipes/[id] (recipe_sources-строка). */
interface RecipeDetailSource {
  id?: string;
  source_type: string;
  source_url: string | null;
  source_author: string | null;
  source_published_at: string | null;
  import_method: string | null;
  rights_confirmed: boolean | null;
}

/** Полный DTO GET /api/recipes/[id] (assembleRecipeDto): root + дети. */
interface RecipeDetailDto {
  id: string;
  title: string;
  subtitle: string | null;
  description: string;
  difficulty: Difficulty | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  servings: number | null;
  calories_per_serving: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carb_g: number | null;
  tags: string[] | null;
  category: string | null;
  yield_text: string | null;
  storage_note: string | null;
  status: RecipeStatus;
  slug: string;
  steps: Array<{
    id?: string;
    position?: number;
    title: string | null;
    description: string;
    time_min: number | null;
    time_max: number | null;
    temperature_c: number | null;
    tips: string | null;
  }>;
  ingredients: Array<{
    id?: string;
    position?: number;
    name: string;
    qty: number | null;
    unit: string;
    display_qty?: string | null;
    is_optional?: boolean;
    prep_note?: string | null;
    group_title?: string | null;
    substitutes?: Array<{
      id?: string;
      name: string;
      qty?: number | null;
      unit?: string | null;
      position?: number;
    }>;
  }>;
  variants?: Array<Record<string, unknown>>;
  media?: Array<Record<string, unknown>>;
  sources?: RecipeDetailSource[];
}

/** GET /api/recipes/[id]/versions (scope=author, без snapshot). */
interface RecipeVersionRow {
  id: string;
  version_no: number;
  changelog: string | null;
  origin: string | null;
  created_by: string;
  created_at: string;
}

// ============================================================
// Ошибки API (422 details path→message)
// ============================================================
export class RecipeApiError extends Error {
  status: number;
  details: Array<{ path: string; message: string }>;
  constructor(status: number, message: string, details: Array<{ path: string; message: string }> = []) {
    super(message);
    this.name = "RecipeApiError";
    this.status = status;
    this.details = details;
  }
}

/** Обёртка csrfFetch → JSON с пробросом серверного текста ошибки. */
async function apiRequest<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<{ data: T; body: Record<string, unknown> }> {
  const res = await csrfFetch(url, init);
  const body: Record<string, unknown> = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = Array.isArray(body.details)
      ? (body.details as Array<{ path: string; message: string }>)
      : [];
    throw new RecipeApiError(
      res.status,
      typeof body.error === "string" ? body.error : `HTTP ${res.status}`,
      details
    );
  }
  return { data: (body.data as T) ?? (null as T), body };
}

// ============================================================
// Форматирование
// ============================================================
function formatRub(n: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDateRu(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

const STATUS_LABELS: Record<RecipeStatus, string> = {
  draft: "Черновик",
  pending_review: "На модерации",
  published: "Опубликован",
  rejected: "Отклонён",
  archived: "В архиве",
};

function StatusBadge({ status }: { status: RecipeStatus }): React.JSX.Element {
  switch (status) {
    case "draft":
      return <Badge variant="secondary">{STATUS_LABELS.draft}</Badge>;
    case "pending_review":
      return (
        <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-700">
          {STATUS_LABELS.pending_review}
        </Badge>
      );
    case "published":
      return <Badge variant="default" className="bg-emerald-600">{STATUS_LABELS.published}</Badge>;
    case "rejected":
      return <Badge variant="destructive">{STATUS_LABELS.rejected}</Badge>;
    case "archived":
      return <Badge variant="outline">{STATUS_LABELS.archived}</Badge>;
  }
}

function difficultyLabel(d: string | null): string {
  switch (d) {
    case "easy": return "Лёгкая";
    case "medium": return "Средняя";
    case "hard": return "Сложная";
    case "expert": return "Экспертная";
    default: return "—";
  }
}

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  telegram: "Telegram",
  vk: "ВКонтакте",
  site: "Сайт",
  document: "Документ",
  manual: "Вручную",
};

const IMPORT_METHOD_LABELS: Record<ImportMethod, string> = {
  ai: "ИИ-импорт",
  manual: "Вручную",
};

function offerText(row: RecipeListRow): string {
  if (!row.offer) return "Без оффера";
  return row.offer.is_published
    ? `Оффер: ${formatRub(row.offer.base_price)}, активен`
    : "Оффер скрыт";
}

// ============================================================
// Форма (create/edit): состояние
// ============================================================
interface IngredientFormRow {
  name: string;
  qty: string; // "" = «по вкусу» → null
  unit: Unit;
  is_optional: boolean;
  group_title: string;
  prep_note: string;
}

interface StepFormRow {
  title: string;
  description: string;
  time_min: string;
  temperature_c: string;
  tips: string;
}

interface SourceFormState {
  source_type: SourceType;
  source_url: string;
  source_author: string;
  import_method: ImportMethod;
}

interface RecipeFormState {
  title: string;
  description: string;
  subtitle: string;
  difficulty: Difficulty;
  prep_time_minutes: string;
  cook_time_minutes: string;
  servings: string;
  calories_per_serving: string;
  protein_g: string;
  fat_g: string;
  carb_g: string;
  tags: string;
  category: string;
  yield_text: string;
  storage_note: string;
  ingredients: IngredientFormRow[];
  steps: StepFormRow[];
  /** null = источник не задаём (не создаётся / не заменяется). */
  source: SourceFormState | null;
  /** Только edit: осознанная замена источника (сбрасывает права). */
  replaceSource: boolean;
}

function emptyIngredient(): IngredientFormRow {
  return { name: "", qty: "", unit: "г", is_optional: false, group_title: "", prep_note: "" };
}

function emptyStep(): StepFormRow {
  return { title: "", description: "", time_min: "", temperature_c: "", tips: "" };
}

function emptyForm(): RecipeFormState {
  return {
    title: "",
    description: "",
    subtitle: "",
    difficulty: "easy",
    prep_time_minutes: "",
    cook_time_minutes: "",
    servings: "",
    calories_per_serving: "",
    protein_g: "",
    fat_g: "",
    carb_g: "",
    tags: "",
    category: "",
    yield_text: "",
    storage_note: "",
    ingredients: [emptyIngredient()],
    steps: [emptyStep()],
    source: null,
    replaceSource: false,
  };
}

function detailToForm(d: RecipeDetailDto): RecipeFormState {
  const base = emptyForm();
  return {
    ...base,
    title: d.title ?? "",
    description: d.description ?? "",
    subtitle: d.subtitle ?? "",
    // "expert" есть в БД, но не в схеме create/patch — показываем как
    // неизменяемое значение (в PATCH не отправляется)
    difficulty: d.difficulty ?? "easy",
    prep_time_minutes: d.prep_time_minutes != null ? String(d.prep_time_minutes) : "",
    cook_time_minutes: d.cook_time_minutes != null ? String(d.cook_time_minutes) : "",
    servings: d.servings != null ? String(d.servings) : "",
    calories_per_serving: d.calories_per_serving != null ? String(d.calories_per_serving) : "",
    protein_g: d.protein_g != null ? String(d.protein_g) : "",
    fat_g: d.fat_g != null ? String(d.fat_g) : "",
    carb_g: d.carb_g != null ? String(d.carb_g) : "",
    tags: (d.tags ?? []).join(", "),
    category: d.category ?? "",
    yield_text: d.yield_text ?? "",
    storage_note: d.storage_note ?? "",
    ingredients: (d.ingredients ?? []).map((i) => ({
      name: i.name ?? "",
      qty: i.qty != null ? String(i.qty) : "",
      unit: i.unit === "мл" || i.unit === "шт" ? i.unit : "г",
      is_optional: Boolean(i.is_optional),
      group_title: i.group_title ?? "",
      prep_note: i.prep_note ?? "",
    })),
    steps: (d.steps ?? []).map((s) => ({
      title: s.title ?? "",
      description: s.description ?? "",
      time_min: s.time_min != null ? String(s.time_min) : "",
      temperature_c: s.temperature_c != null ? String(s.temperature_c) : "",
      tips: s.tips ?? "",
    })),
    source: null,
    replaceSource: false,
  };
}

// ============================================================
// DTO-сериализация формы → тела POST/PATCH (БЕЗ status/price/author)
// ============================================================
function numOrNull(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Нормализованный массив ингредиентов (используется и для diff, и для body). */
function ingredientPayload(rows: IngredientFormRow[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  rows.forEach((r, idx) => {
    const name = r.name.trim();
    const qty = numOrNull(r.qty);
    if (!name && qty === null) return; // полностью пустая строка
    const item: Record<string, unknown> = {
      name: name,
      qty: qty === null || qty <= 0 ? null : qty, // null = «по вкусу»
      unit: r.unit,
      is_optional: r.is_optional,
      position: idx + 1,
    };
    if (r.group_title.trim()) item.group_title = r.group_title.trim();
    if (r.prep_note.trim()) item.prep_note = r.prep_note.trim();
    out.push(item);
  });
  return out;
}

/** Нормализованный массив шагов (используется и для diff, и для body). */
function stepPayload(rows: StepFormRow[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  rows.forEach((r, idx) => {
    const description = r.description.trim();
    const title = r.title.trim();
    const time = numOrNull(r.time_min);
    const temp = numOrNull(r.temperature_c);
    const tips = r.tips.trim();
    if (!description && !title && time === null && temp === null && !tips) return;
    const item: Record<string, unknown> = { position: idx + 1, description: description };
    if (title) item.title = title;
    if (time !== null && time >= 0) item.time_min = Math.trunc(time);
    if (temp !== null) item.temperature_c = Math.trunc(temp);
    if (tips) item.tips = tips;
    out.push(item);
  });
  return out;
}

function sourcePayload(src: SourceFormState): Record<string, unknown> {
  const item: Record<string, unknown> = { source_type: src.source_type };
  if (src.source_url.trim()) item.source_url = src.source_url.trim();
  if (src.source_author.trim()) item.source_author = src.source_author.trim();
  if (src.import_method) item.import_method = src.import_method;
  return item;
}

/** Тело POST /api/recipes (создание черновика). */
function buildCreateBody(form: RecipeFormState): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: form.title.trim(),
    description: form.description.trim(),
    difficulty: form.difficulty,
  };
  if (form.subtitle.trim()) body.subtitle = form.subtitle.trim();
  const prep = numOrNull(form.prep_time_minutes);
  if (prep !== null) body.prep_time_minutes = Math.trunc(prep);
  const cook = numOrNull(form.cook_time_minutes);
  if (cook !== null) body.cook_time_minutes = Math.trunc(cook);
  const servings = numOrNull(form.servings);
  if (servings !== null && servings >= 1) body.servings = Math.trunc(servings);
  const kcal = numOrNull(form.calories_per_serving);
  if (kcal !== null) body.calories_per_serving = Math.trunc(kcal);
  const protein = numOrNull(form.protein_g);
  if (protein !== null) body.protein_g = protein;
  const fat = numOrNull(form.fat_g);
  if (fat !== null) body.fat_g = fat;
  const carb = numOrNull(form.carb_g);
  if (carb !== null) body.carb_g = carb;
  const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
  if (tags.length > 0) body.tags = tags;
  if (form.category.trim()) body.category = form.category.trim();
  if (form.yield_text.trim()) body.yield_text = form.yield_text.trim();
  if (form.storage_note.trim()) body.storage_note = form.storage_note.trim();
  body.ingredients = ingredientPayload(form.ingredients);
  body.steps = stepPayload(form.steps);
  if (form.source) body.source = sourcePayload(form.source);
  return body;
}

/** Тело PATCH /api/recipes/[id]: опущенные массивы сервер не трогает. */
function buildPatchBody(
  form: RecipeFormState,
  original: { ingredientsJson: string | null; stepsJson: string | null }
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: form.title.trim(),
    description: form.description.trim(),
  };
  if (form.difficulty !== "expert") body.difficulty = form.difficulty;
  body.subtitle = form.subtitle.trim();
  const prep = numOrNull(form.prep_time_minutes);
  body.prep_time_minutes = prep !== null ? Math.trunc(prep) : null;
  const cook = numOrNull(form.cook_time_minutes);
  body.cook_time_minutes = cook !== null ? Math.trunc(cook) : null;
  const servings = numOrNull(form.servings);
  body.servings = servings !== null && servings >= 1 ? Math.trunc(servings) : null;
  const kcal = numOrNull(form.calories_per_serving);
  body.calories_per_serving = kcal !== null ? Math.trunc(kcal) : null;
  body.protein_g = numOrNull(form.protein_g);
  body.fat_g = numOrNull(form.fat_g);
  body.carb_g = numOrNull(form.carb_g);
  body.tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
  body.category = form.category.trim();
  body.yield_text = form.yield_text.trim();
  body.storage_note = form.storage_note.trim();

  const ings = ingredientPayload(form.ingredients);
  if (original.ingredientsJson === null || JSON.stringify(ings) !== original.ingredientsJson) {
    body.ingredients = ings;
  }
  const steps = stepPayload(form.steps);
  if (original.stepsJson === null || JSON.stringify(steps) !== original.stepsJson) {
    body.steps = steps;
  }
  // Осознанная замена источника — заменяет recipe_sources и СБРАСЫВАЕТ права
  if (form.replaceSource && form.source) {
    body.sources = [sourcePayload(form.source)];
  }
  return body;
}

/** Клиентская валидация обязательных полей (минимальные длины). */
function validateForm(form: RecipeFormState): string[] {
  const errors: string[] = [];
  if (form.title.trim().length < 3) {
    errors.push("Название: минимум 3 символа");
  }
  if (!form.description.trim()) {
    errors.push("Описание: обязательно для заполнения");
  }
  ingredientPayload(form.ingredients).forEach((ing, idx) => {
    if (!String(ing.name ?? "").trim()) {
      errors.push(`Ингредиент ${idx + 1}: укажите название`);
    }
  });
  stepPayload(form.steps).forEach((s, idx) => {
    if (!String(s.description ?? "").trim()) {
      errors.push(`Шаг ${idx + 1}: описание обязательно`);
    }
  });
  return errors;
}

// ============================================================
// Главный компонент
// ============================================================
export function RecipeAuthorManager(): React.JSX.Element {
  const user = useAppStore((s) => s.user);
  const queryClient = useQueryClient();

  // --- Диалоги ---
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editRow, setEditRow] = React.useState<RecipeListRow | null>(null);
  const [publishRow, setPublishRow] = React.useState<RecipeListRow | null>(null);
  const [versionsRow, setVersionsRow] = React.useState<RecipeListRow | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  // --- Список ---
  const listQ = useQuery<RecipeListRow[]>({
    queryKey: MY_RECIPES_QUERY_KEY,
    queryFn: async () => {
      const { data } = await apiRequest<RecipeListRow[]>(
        "/api/recipes?scope=mine&limit=100"
      );
      return Array.isArray(data) ? data : [];
    },
    enabled: !!user,
  });

  // --- Архивация (DELETE — идемпотентный soft-delete) ---
  const archiveM = useMutation({
    mutationFn: async (id: string) => {
      const { body } = await apiRequest(`/api/recipes/${id}`, { method: "DELETE" });
      return body;
    },
    onSuccess: (body) => {
      queryClient.invalidateQueries({ queryKey: MY_RECIPES_QUERY_KEY });
      toast.success(
        typeof body.message === "string" && body.message
          ? body.message
          : "Рецепт перемещён в архив"
      );
    },
    onError: (err: Error) => toast.error("Не удалось архивировать", { description: err.message }),
    onSettled: () => setBusyId(null),
  });

  // --- Восстановление из архива (PATCH {status:"draft"} — единственный
  //     статус, который клиент может передать) ---
  const restoreM = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiRequest<{ id: string; status: string }>(`/api/recipes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "draft" }),
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MY_RECIPES_QUERY_KEY });
      toast.success("Рецепт восстановлен в черновики");
    },
    onError: (err: Error) => toast.error("Не удалось восстановить", { description: err.message }),
    onSettled: () => setBusyId(null),
  });

  // --- Подтверждение прав (одноразовое, RA.13) ---
  const rightsM = useMutation({
    mutationFn: async (id: string) => {
      const { body } = await apiRequest(`/api/recipes/${id}/rights-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      return body;
    },
    onSuccess: (body) => {
      queryClient.invalidateQueries({ queryKey: MY_RECIPES_QUERY_KEY });
      toast.success(
        typeof body.message === "string" && body.message
          ? body.message
          : "Права на контент подтверждены"
      );
    },
    onError: (err: Error) => toast.error("Не удалось подтвердить права", { description: err.message }),
    onSettled: () => setBusyId(null),
  });

  if (!user) {
    return (
      <Card className="p-8 text-center border-border/60">
        <BookOpen className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <h3 className="font-semibold mb-1">Мои рецепты</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Войдите, чтобы создавать и публиковать авторские рецепты
        </p>
        <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>Войти</Button>
      </Card>
    );
  }

  const rows = listQ.data ?? [];
  const draftCount = rows.filter((r) => r.status === "draft").length;
  const publishedCount = rows.filter((r) => r.status === "published").length;

  return (
    <div className="space-y-4">
      <Card className="p-4 border-border/60">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-amber-600" />
              Мои рецепты ({rows.length})
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Черновики: {draftCount} • Опубликовано: {publishedCount}. Статусы, цены и версии
              управляются сервером.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => listQ.refetch()}
              disabled={listQ.isFetching}
            >
              {listQ.isFetching ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Обновить
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Создать черновик
            </Button>
          </div>
        </div>

        {listQ.isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : listQ.error ? (
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertTitle>Не удалось загрузить рецепты</AlertTitle>
            <AlertDescription>
              {(listQ.error as Error).message}
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={() => listQ.refetch()}>
                  Повторить
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center">
            <BookOpen className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <h4 className="font-semibold mb-1">У вас ещё нет рецептов</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Создайте первый черновик, наполните составом и опубликуйте
            </p>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Создать черновик
            </Button>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-md border">
            {/* Таблица — md+ */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Рецепт</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Оффер</TableHead>
                    <TableHead>Обновлён</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <RecipeTableRow
                      key={row.id}
                      row={row}
                      busyId={busyId}
                      onEdit={() => setEditRow(row)}
                      onPublish={() => setPublishRow(row)}
                      onVersions={() => setVersionsRow(row)}
                      onArchive={() => { setBusyId(row.id); archiveM.mutate(row.id); }}
                      onRestore={() => { setBusyId(row.id); restoreM.mutate(row.id); }}
                      onRights={() => { setBusyId(row.id); rightsM.mutate(row.id); }}
                      archivePending={archiveM.isPending}
                      restorePending={restoreM.isPending}
                      rightsPending={rightsM.isPending}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Карточки — мобильные */}
            <div className="md:hidden divide-y">
              {rows.map((row) => (
                <RecipeRowCard
                  key={row.id}
                  row={row}
                  busyId={busyId}
                  onEdit={() => setEditRow(row)}
                  onPublish={() => setPublishRow(row)}
                  onVersions={() => setVersionsRow(row)}
                  onArchive={() => { setBusyId(row.id); archiveM.mutate(row.id); }}
                  onRestore={() => { setBusyId(row.id); restoreM.mutate(row.id); }}
                  onRights={() => { setBusyId(row.id); rightsM.mutate(row.id); }}
                  archivePending={archiveM.isPending}
                  restorePending={restoreM.isPending}
                  rightsPending={rightsM.isPending}
                />
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Создание черновика */}
      <RecipeFormDialog open={createOpen} onOpenChange={setCreateOpen} recipe={null} />

      {/* Редактирование */}
      <RecipeFormDialog
        open={editRow !== null}
        onOpenChange={(open) => { if (!open) setEditRow(null); }}
        recipe={editRow}
      />

      {/* Публикация / обновление */}
      <PublishDialog
        row={publishRow}
        open={publishRow !== null}
        onOpenChange={(open) => { if (!open) setPublishRow(null); }}
      />

      {/* Версии */}
      <VersionsDialog
        row={versionsRow}
        open={versionsRow !== null}
        onOpenChange={(open) => { if (!open) setVersionsRow(null); }}
      />
    </div>
  );
}

// ============================================================
// Строка таблицы (md+) и мобильная карточка — общие действия
// ============================================================
interface RowActionProps {
  row: RecipeListRow;
  busyId: string | null;
  onEdit: () => void;
  onPublish: () => void;
  onVersions: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onRights: () => void;
  archivePending: boolean;
  restorePending: boolean;
  rightsPending: boolean;
}

function getRowState(p: RowActionProps) {
  const isBusy = p.busyId === p.row.id;
  const rightsUnconfirmed = p.row.rights_confirmed === false;
  return { isBusy, rightsUnconfirmed };
}

function RowActionButtons(p: RowActionProps): React.JSX.Element {
  const { isBusy, rightsUnconfirmed } = getRowState(p);
  const row = p.row;
  const readOnly = row.status === "pending_review" || row.status === "rejected";

  return (
    <div className="flex flex-wrap justify-end gap-1">
      {row.status === "draft" && (
        <>
          <Button size="sm" variant="outline" onClick={p.onEdit} disabled={isBusy}>
            <Pencil className="w-3.5 h-3.5 mr-1" />Редактировать
          </Button>
          <Button size="sm" onClick={p.onPublish} disabled={isBusy}>
            <Send className="w-3.5 h-3.5 mr-1" />Опубликовать
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={p.onArchive}
            disabled={isBusy}
            title="В архив"
          >
            {p.archivePending && isBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Archive className="w-3.5 h-3.5" />
            )}
          </Button>
        </>
      )}
      {row.status === "published" && (
        <>
          <Button size="sm" variant="outline" onClick={p.onEdit} disabled={isBusy}>
            <Pencil className="w-3.5 h-3.5 mr-1" />Редактировать
          </Button>
          <Button size="sm" onClick={p.onPublish} disabled={isBusy}>
            <Send className="w-3.5 h-3.5 mr-1" />Опубликовать обновление
          </Button>
          <Button size="sm" variant="ghost" onClick={p.onArchive} disabled={isBusy} title="В архив">
            {p.archivePending && isBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Archive className="w-3.5 h-3.5" />
            )}
          </Button>
        </>
      )}
      {row.status === "archived" && (
        <Button size="sm" variant="outline" onClick={p.onRestore} disabled={isBusy}>
          {p.restorePending && isBusy ? (
            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
          ) : (
            <ArchiveRestore className="w-3.5 h-3.5 mr-1" />
          )}
          Восстановить
        </Button>
      )}
      {readOnly && (
        <span className="text-xs text-muted-foreground self-center px-1">
          {row.status === "pending_review"
            ? "Ожидает решения модератора"
            : "Отклонён модерацией (окончательный статус)"}
        </span>
      )}
      {rightsUnconfirmed && (
        <Button size="sm" variant="outline" onClick={p.onRights} disabled={isBusy}>
          {p.rightsPending && isBusy ? (
            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
          ) : (
            <ShieldCheck className="w-3.5 h-3.5 mr-1" />
          )}
          Подтвердить права
        </Button>
      )}
    </div>
  );
}

function RecipeTableRow(p: RowActionProps): React.JSX.Element {
  const { rightsUnconfirmed } = getRowState(p);
  const row = p.row;
  return (
    <TableRow className={row.status === "archived" ? "opacity-70" : undefined}>
      <TableCell className="max-w-[260px]">
        <div className="font-medium truncate" title={row.title}>{row.title}</div>
        <div className="text-xs text-muted-foreground truncate">
          {row.category || "Без категории"}
          {row.difficulty ? ` • ${difficultyLabel(row.difficulty)}` : ""}
          {row.tags.length > 0 ? ` • ${row.tags.slice(0, 3).join(", ")}` : ""}
        </div>
        {rightsUnconfirmed && (
          <div className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
            <AlertTriangle className="w-3 h-3" />
            Права не подтверждены
          </div>
        )}
      </TableCell>
      <TableCell><StatusBadge status={row.status} /></TableCell>
      <TableCell className="text-xs whitespace-nowrap">{offerText(row)}</TableCell>
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
        {formatDateRu(row.updated_at)}
      </TableCell>
      <TableCell><RowActionButtons {...p} /></TableCell>
    </TableRow>
  );
}

function RecipeRowCard(p: RowActionProps): React.JSX.Element {
  const { rightsUnconfirmed } = getRowState(p);
  const row = p.row;
  return (
    <div className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{row.title}</div>
          <div className="text-xs text-muted-foreground">
            {formatDateRu(row.updated_at)} • {offerText(row)}
          </div>
        </div>
        <StatusBadge status={row.status} />
      </div>
      {rightsUnconfirmed && (
        <div className="text-xs text-amber-600 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Права не подтверждены
        </div>
      )}
      <RowActionButtons {...p} />
    </div>
  );
}

// ============================================================
// Диалог создания/редактирования (общая форма)
// ============================================================
function RecipeFormDialog({
  open,
  onOpenChange,
  recipe,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipe: RecipeListRow | null;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const isEdit = recipe !== null;

  const [form, setForm] = React.useState<RecipeFormState>(emptyForm());
  const [clientErrors, setClientErrors] = React.useState<string[]>([]);
  const [serverError, setServerError] = React.useState<RecipeApiError | null>(null);
  // Секция «Источник (импорт)» — управляемое раскрытие (и в create, и в edit)
  const [sourceOpen, setSourceOpen] = React.useState(false);
  // Оригинальные сериализованные секции — чтобы PATCH отправлял массивы
  // только при реальном изменении (иначе зря бампается updated_at)
  const originalRef = React.useRef<{ ingredientsJson: string | null; stepsJson: string | null }>({
    ingredientsJson: null,
    stepsJson: null,
  });

  // --- Полная карточка (edit) ---
  const detailQ = useQuery<RecipeDetailDto>({
    queryKey: ["recipe-detail", recipe?.id ?? ""],
    queryFn: async () => {
      const { data } = await apiRequest<RecipeDetailDto>(`/api/recipes/${recipe?.id}`);
      return data;
    },
    enabled: open && isEdit,
  });

  // Заполнение формы: create — пустая; edit — из карточки. Инициализация
  // одноразовая на открытие диалога (рефери по id): фоновые рефетчи карточки
  // (напр. после подтверждения прав) НЕ затирают правки пользователя.
  const initializedForRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open) {
      initializedForRef.current = null;
      return;
    }
    setServerError(null);
    setClientErrors([]);
    setSourceOpen(false);
    if (!isEdit) {
      if (initializedForRef.current === "create") return;
      initializedForRef.current = "create";
      originalRef.current = { ingredientsJson: null, stepsJson: null };
      setForm(emptyForm());
      return;
    }
    const id = recipe?.id ?? "";
    const d = detailQ.data;
    if (d && initializedForRef.current !== id) {
      initializedForRef.current = id;
      const f = detailToForm(d);
      setForm(f);
      originalRef.current = {
        ingredientsJson: JSON.stringify(ingredientPayload(f.ingredients)),
        stepsJson: JSON.stringify(stepPayload(f.steps)),
      };
    }
  }, [open, isEdit, detailQ.data, recipe?.id]);

  const set = <K extends keyof RecipeFormState>(key: K, value: RecipeFormState[K]): void => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  // --- Источник (edit): текущее значение из карточки ---
  const existingSource = detailQ.data?.sources?.[0] ?? null;

  // --- Подтверждение прав (edit, одноразовое — RA.13) ---
  const rightsM = useMutation({
    mutationFn: async (id: string) => {
      const { body } = await apiRequest(`/api/recipes/${id}/rights-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      return body;
    },
    onSuccess: (body) => {
      queryClient.invalidateQueries({ queryKey: MY_RECIPES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["recipe-detail", recipe?.id ?? ""] });
      toast.success(
        typeof body.message === "string" && body.message
          ? body.message
          : "Права на контент подтверждены"
      );
    },
    onError: (err: Error) =>
      toast.error("Не удалось подтвердить права", { description: err.message }),
  });

  // --- Мутация сохранения ---
  const saveM = useMutation({
    mutationFn: async () => {
      if (isEdit && recipe) {
        const { data } = await apiRequest<{ id: string; status: string }>(
          `/api/recipes/${recipe.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildPatchBody(form, originalRef.current)),
          }
        );
        return { mode: "edit" as const, data };
      }
      const { data } = await apiRequest<{ id: string; slug: string; status: string }>(
        "/api/recipes",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildCreateBody(form)),
        }
      );
      return { mode: "create" as const, data };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: MY_RECIPES_QUERY_KEY });
      toast.success(
        res.mode === "create"
          ? `Черновик создан (slug: ${res.data?.slug ?? "—"})`
          : "Рецепт сохранён"
      );
      onOpenChange(false);
    },
    onError: (err: Error) => {
      setServerError(err instanceof RecipeApiError ? err : new RecipeApiError(0, err.message));
      toast.error("Не удалось сохранить рецепт", { description: err.message });
    },
  });

  const submit = (): void => {
    const errs = validateForm(form);
    setClientErrors(errs);
    setServerError(null);
    if (errs.length > 0) return;
    saveM.mutate();
  };

  // --- Редакторы состава ---
  const moveIngredient = (idx: number, dir: -1 | 1): void => {
    setForm((f) => {
      const next = [...f.ingredients];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return f;
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...f, ingredients: next };
    });
  };

  const moveStep = (idx: number, dir: -1 | 1): void => {
    setForm((f) => {
      const next = [...f.steps];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return f;
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...f, steps: next };
    });
  };

  const detailLoading = isEdit && detailQ.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Редактирование рецепта" : "Новый черновик рецепта"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Правки сохраняются в рабочей версии; история — в неизменяемых версиях публикаций."
              : "Рецепт сохранится как черновик. Публикация выполняется отдельно из списка."}
          </DialogDescription>
        </DialogHeader>

        {detailLoading ? (
          <div className="space-y-3 py-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : detailQ.error && isEdit ? (
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertTitle>Не удалось загрузить карточку рецепта</AlertTitle>
            <AlertDescription>
              {(detailQ.error as Error).message}
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={() => detailQ.refetch()}>
                  Повторить
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-5">
            {/* Неподтверждённые права — кнопка подтверждения прямо в диалоге */}
            {isEdit && recipe?.rights_confirmed === false && (
              <Alert className="border-amber-300 bg-amber-50 text-amber-800">
                <AlertTriangle className="w-4 h-4" />
                <AlertTitle>Права на импортированный контент не подтверждены</AlertTitle>
                <AlertDescription>
                  Публикация заблокирована, пока права не подтверждены. Подтверждение
                  одноразовое и фиксируется навсегда.
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => recipe && rightsM.mutate(recipe.id)}
                      disabled={rightsM.isPending}
                    >
                      {rightsM.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                      ) : (
                        <ShieldCheck className="w-3.5 h-3.5 mr-2" />
                      )}
                      Подтвердить права
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Клиентская валидация */}
            {clientErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="w-4 h-4" />
                <AlertTitle>Проверьте форму</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {clientErrors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Ошибки сервера (включая 422 details path→message) */}
            {serverError && (
              <Alert variant="destructive">
                <AlertTriangle className="w-4 h-4" />
                <AlertTitle>
                  Ошибка сервера {serverError.status > 0 ? `(${serverError.status})` : ""}
                </AlertTitle>
                <AlertDescription>
                  <div>{serverError.message}</div>
                  {serverError.details.length > 0 && (
                    <ul className="list-disc pl-4 space-y-0.5 mt-1">
                      {serverError.details.map((d, i) => (
                        <li key={`${d.path}-${i}`}>
                          <span className="font-mono text-xs">{d.path}</span>: {d.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* ---- Основные поля ---- */}
            <div className="space-y-3">
              <div>
                <Label htmlFor="ra-title">Название * (3–200 символов)</Label>
                <Input
                  id="ra-title"
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="Шоколадный торт с малиной"
                  maxLength={200}
                />
              </div>
              <div>
                <Label htmlFor="ra-description">Описание * (1–5000 символов)</Label>
                <Textarea
                  id="ra-description"
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Авторский рецепт с тёмным шоколадом и свежей малиной..."
                  rows={3}
                  maxLength={5000}
                />
              </div>
              <div>
                <Label htmlFor="ra-subtitle">Подзаголовок</Label>
                <Input
                  id="ra-subtitle"
                  value={form.subtitle}
                  onChange={(e) => set("subtitle", e.target.value)}
                  maxLength={300}
                  placeholder="Короткая аннотация для карточки"
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label>Сложность *</Label>
                  <Select
                    value={form.difficulty}
                    onValueChange={(v) => set("difficulty", v as Difficulty)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="easy">Лёгкая</SelectItem>
                      <SelectItem value="medium">Средняя</SelectItem>
                      <SelectItem value="hard">Сложная</SelectItem>
                      {isEdit && form.difficulty === "expert" && (
                        <SelectItem value="expert" disabled>Экспертная</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="ra-prep">Подготовка, мин</Label>
                  <Input
                    id="ra-prep"
                    type="number"
                    min={0}
                    value={form.prep_time_minutes}
                    onChange={(e) => set("prep_time_minutes", e.target.value)}
                    placeholder="20"
                  />
                </div>
                <div>
                  <Label htmlFor="ra-cook">Приготовление, мин</Label>
                  <Input
                    id="ra-cook"
                    type="number"
                    min={0}
                    value={form.cook_time_minutes}
                    onChange={(e) => set("cook_time_minutes", e.target.value)}
                    placeholder="60"
                  />
                </div>
                <div>
                  <Label htmlFor="ra-servings">Порций</Label>
                  <Input
                    id="ra-servings"
                    type="number"
                    min={1}
                    value={form.servings}
                    onChange={(e) => set("servings", e.target.value)}
                    placeholder="8"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label htmlFor="ra-kcal">Ккал / порция</Label>
                  <Input
                    id="ra-kcal"
                    type="number"
                    min={0}
                    value={form.calories_per_serving}
                    onChange={(e) => set("calories_per_serving", e.target.value)}
                    placeholder="350"
                  />
                </div>
                <div>
                  <Label htmlFor="ra-protein">Белки, г</Label>
                  <Input
                    id="ra-protein"
                    type="number"
                    min={0}
                    step="0.1"
                    value={form.protein_g}
                    onChange={(e) => set("protein_g", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="ra-fat">Жиры, г</Label>
                  <Input
                    id="ra-fat"
                    type="number"
                    min={0}
                    step="0.1"
                    value={form.fat_g}
                    onChange={(e) => set("fat_g", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="ra-carb">Углеводы, г</Label>
                  <Input
                    id="ra-carb"
                    type="number"
                    min={0}
                    step="0.1"
                    value={form.carb_g}
                    onChange={(e) => set("carb_g", e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="ra-tags">Теги (через запятую)</Label>
                  <Input
                    id="ra-tags"
                    value={form.tags}
                    onChange={(e) => set("tags", e.target.value)}
                    placeholder="шоколад, десерт, к чаю"
                  />
                </div>
                <div>
                  <Label htmlFor="ra-category">Категория</Label>
                  <Input
                    id="ra-category"
                    value={form.category}
                    onChange={(e) => set("category", e.target.value)}
                    maxLength={100}
                    placeholder="Торты"
                  />
                </div>
                <div>
                  <Label htmlFor="ra-yield">Выход (yield)</Label>
                  <Input
                    id="ra-yield"
                    value={form.yield_text}
                    onChange={(e) => set("yield_text", e.target.value)}
                    maxLength={200}
                    placeholder="1 торт Ø20 см"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="ra-storage">Хранение</Label>
                <Input
                  id="ra-storage"
                  value={form.storage_note}
                  onChange={(e) => set("storage_note", e.target.value)}
                  maxLength={500}
                  placeholder="В холодильнике до 3 суток"
                />
              </div>
            </div>

            <Separator />

            {/* ---- Ингредиенты ---- */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm">
                  Ингредиенты ({ingredientPayload(form.ingredients).length})
                </h4>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => set("ingredients", [...form.ingredients, emptyIngredient()])}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />Добавить
                </Button>
              </div>
              {form.ingredients.map((ing, idx) => (
                <div key={idx} className="rounded-md border p-2 space-y-2 bg-muted/20">
                  <div className="grid grid-cols-2 md:grid-cols-[1fr_110px_100px_auto] gap-2">
                    <Input
                      value={ing.name}
                      onChange={(e) => {
                        const next = [...form.ingredients];
                        next[idx] = { ...next[idx], name: e.target.value };
                        set("ingredients", next);
                      }}
                      placeholder="Название *"
                      maxLength={200}
                      className="col-span-2 md:col-span-1"
                    />
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={ing.qty}
                      onChange={(e) => {
                        const next = [...form.ingredients];
                        next[idx] = { ...next[idx], qty: e.target.value };
                        set("ingredients", next);
                      }}
                      placeholder="По вкусу"
                    />
                    <Select
                      value={ing.unit}
                      onValueChange={(v) => {
                        const next = [...form.ingredients];
                        next[idx] = { ...next[idx], unit: v as Unit };
                        set("ingredients", next);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="г">г</SelectItem>
                        <SelectItem value="мл">мл</SelectItem>
                        <SelectItem value="шт">шт</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex gap-1 justify-end">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        disabled={idx === 0}
                        onClick={() => moveIngredient(idx, -1)}
                        title="Выше"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        disabled={idx === form.ingredients.length - 1}
                        onClick={() => moveIngredient(idx, 1)}
                        title="Ниже"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        onClick={() =>
                          set(
                            "ingredients",
                            form.ingredients.filter((_, i) => i !== idx)
                          )
                        }
                        title="Удалить"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-[auto_1fr_1fr] gap-2 items-center">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`ing-opt-${idx}`}
                        checked={ing.is_optional}
                        onCheckedChange={(v) => {
                          const next = [...form.ingredients];
                          next[idx] = { ...next[idx], is_optional: v === true };
                          set("ingredients", next);
                        }}
                      />
                      <Label htmlFor={`ing-opt-${idx}`} className="text-xs cursor-pointer">
                        По желанию
                      </Label>
                    </div>
                    <Input
                      value={ing.group_title}
                      onChange={(e) => {
                        const next = [...form.ingredients];
                        next[idx] = { ...next[idx], group_title: e.target.value };
                        set("ingredients", next);
                      }}
                      placeholder="Группа (напр. «Тесто»)"
                      maxLength={100}
                    />
                    <Input
                      value={ing.prep_note}
                      onChange={(e) => {
                        const next = [...form.ingredients];
                        next[idx] = { ...next[idx], prep_note: e.target.value };
                        set("ingredients", next);
                      }}
                      placeholder="Подготовка (напр. «мелко нарезать»)"
                      maxLength={300}
                    />
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Пустое количество = «по вкусу» (уходит на сервер как null).
              </p>
            </div>

            <Separator />

            {/* ---- Шаги ---- */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm">
                  Шаги приготовления ({stepPayload(form.steps).length})
                </h4>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => set("steps", [...form.steps, emptyStep()])}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />Добавить
                </Button>
              </div>
              {form.steps.map((step, idx) => (
                <div key={idx} className="rounded-md border p-2 space-y-2 bg-muted/20">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground shrink-0 w-6">
                      №{idx + 1}
                    </span>
                    <Input
                      value={step.title}
                      onChange={(e) => {
                        const next = [...form.steps];
                        next[idx] = { ...next[idx], title: e.target.value };
                        set("steps", next);
                      }}
                      placeholder="Заголовок шага"
                      maxLength={200}
                    />
                    <div className="flex gap-1 shrink-0">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        disabled={idx === 0}
                        onClick={() => moveStep(idx, -1)}
                        title="Выше"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        disabled={idx === form.steps.length - 1}
                        onClick={() => moveStep(idx, 1)}
                        title="Ниже"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        onClick={() => set("steps", form.steps.filter((_, i) => i !== idx))}
                        title="Удалить"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={step.description}
                    onChange={(e) => {
                      const next = [...form.steps];
                      next[idx] = { ...next[idx], description: e.target.value };
                      set("steps", next);
                    }}
                    placeholder="Описание шага * (обязательно)"
                    rows={2}
                    maxLength={5000}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={1440}
                      value={step.time_min}
                      onChange={(e) => {
                        const next = [...form.steps];
                        next[idx] = { ...next[idx], time_min: e.target.value };
                        set("steps", next);
                      }}
                      placeholder="Время, мин"
                    />
                    <Input
                      type="number"
                      min={-50}
                      max={400}
                      value={step.temperature_c}
                      onChange={(e) => {
                        const next = [...form.steps];
                        next[idx] = { ...next[idx], temperature_c: e.target.value };
                        set("steps", next);
                      }}
                      placeholder="Температура, °C"
                    />
                    <Input
                      value={step.tips}
                      onChange={(e) => {
                        const next = [...form.steps];
                        next[idx] = { ...next[idx], tips: e.target.value };
                        set("steps", next);
                      }}
                      placeholder="Совет"
                      maxLength={2000}
                    />
                  </div>
                </div>
              ))}
            </div>

            <Separator />

            {/* ---- Источник (импорт) ---- */}
            <Collapsible
              open={sourceOpen || form.replaceSource}
              onOpenChange={(o) => {
                setSourceOpen(o);
                if (!o) {
                  // Схлопнули секцию — осознанную замену тоже снимаем
                  set("replaceSource", false);
                  return;
                }
                // create: при открытии инициализируем источник
                if (!isEdit && form.source === null) {
                  set("source", {
                    source_type: "telegram",
                    source_url: "",
                    source_author: "",
                    import_method: "manual",
                  });
                }
              }}
            >
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="px-2">
                  <Copy className="w-4 h-4 mr-2" />
                  Источник (импорт)
                  {isEdit && existingSource ? (
                    <Badge variant="outline" className="ml-2">
                      {SOURCE_TYPE_LABELS[existingSource.source_type as SourceType] ??
                        existingSource.source_type}
                    </Badge>
                  ) : null}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                {isEdit ? (
                  <>
                    {existingSource ? (
                      <div className="rounded-md border p-3 text-sm space-y-1 bg-muted/30">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {SOURCE_TYPE_LABELS[existingSource.source_type as SourceType] ??
                              existingSource.source_type}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {IMPORT_METHOD_LABELS[
                              (existingSource.import_method ?? "manual") as ImportMethod
                            ] ?? "Вручную"}
                          </span>
                          {existingSource.rights_confirmed === false ? (
                            <span className="text-xs text-amber-600 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              права не подтверждены
                            </span>
                          ) : (
                            <span className="text-xs text-emerald-600">
                              права подтверждены
                            </span>
                          )}
                        </div>
                        {existingSource.source_author && (
                          <div className="text-xs text-muted-foreground">
                            Автор источника: {existingSource.source_author}
                          </div>
                        )}
                        {existingSource.source_url && (
                          <a
                            href={existingSource.source_url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-xs text-primary inline-flex items-center gap-1 break-all"
                          >
                            {existingSource.source_url}
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        У рецепта нет записей об источниках — это оригинальный контент.
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="ra-replace-source"
                        checked={form.replaceSource}
                        onCheckedChange={(v) => {
                          const on = v === true;
                          set("replaceSource", on);
                          if (on && form.source === null) {
                            set("source", {
                              source_type: existingSource?.source_type as SourceType ?? "manual",
                              source_url: existingSource?.source_url ?? "",
                              source_author: existingSource?.source_author ?? "",
                              import_method:
                                (existingSource?.import_method as ImportMethod) ?? "manual",
                            });
                          }
                        }}
                      />
                      <Label htmlFor="ra-replace-source" className="text-sm cursor-pointer">
                        Заменить источник
                      </Label>
                    </div>
                    {form.replaceSource && (
                      <Alert className="border-amber-300 bg-amber-50 text-amber-800">
                        <AlertTriangle className="w-4 h-4" />
                        <AlertDescription>
                          Замена источника сбрасывает подтверждение прав — после сохранения
                          потребуется подтвердить права заново.
                        </AlertDescription>
                      </Alert>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Если рецепт импортирован (Telegram/ВК/сайт/документ) — укажите источник.
                    До подтверждения прав публикация будет заблокирована.
                  </p>
                )}

                {(form.source !== null && (!isEdit || form.replaceSource)) && (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <Label>Тип источника *</Label>
                        <Select
                          value={form.source.source_type}
                          onValueChange={(v) =>
                            set("source", { ...(form.source as SourceFormState), source_type: v as SourceType })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(SOURCE_TYPE_LABELS) as SourceType[]).map((t) => (
                              <SelectItem key={t} value={t}>
                                {SOURCE_TYPE_LABELS[t]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Способ импорта</Label>
                        <Select
                          value={form.source.import_method}
                          onValueChange={(v) =>
                            set("source", { ...(form.source as SourceFormState), import_method: v as ImportMethod })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="manual">Вручную</SelectItem>
                            <SelectItem value="ai">ИИ-импорт</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="ra-src-author">Автор источника</Label>
                        <Input
                          id="ra-src-author"
                          value={form.source.source_author}
                          onChange={(e) =>
                            set("source", { ...(form.source as SourceFormState), source_author: e.target.value })
                          }
                          maxLength={200}
                          placeholder="@канал или имя автора"
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="ra-src-url">Ссылка на источник</Label>
                      <Input
                        id="ra-src-url"
                        value={form.source.source_url}
                        onChange={(e) =>
                          set("source", { ...(form.source as SourceFormState), source_url: e.target.value })
                        }
                        maxLength={2048}
                        placeholder="https://t.me/..."
                      />
                    </div>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveM.isPending}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={saveM.isPending || detailLoading}>
            {saveM.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isEdit ? "Сохранить" : "Создать черновик"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Диалог публикации (changelog + результат: versionNo / idempotent)
// ============================================================
function PublishDialog({
  row,
  open,
  onOpenChange,
}: {
  row: RecipeListRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [changelog, setChangelog] = React.useState("");
  const [resultText, setResultText] = React.useState<string | null>(null);
  const [errorText, setErrorText] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setChangelog("");
      setResultText(null);
      setErrorText(null);
    }
  }, [open, row?.id]);

  const publishM = useMutation({
    mutationFn: async () => {
      const { body } = await apiRequest(`/api/recipes/${row?.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          changelog.trim() ? { changelog: changelog.trim().slice(0, 500) } : {}
        ),
      });
      return body as {
        data?: { id?: string; slug?: string; status?: string; versionNo?: number };
        idempotent?: boolean;
        message?: string;
      };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: MY_RECIPES_QUERY_KEY });
      if (res.idempotent) {
        setResultText(res.message || "Контент не менялся с последней публикации — новая версия не создана");
      } else {
        const versionNo = res.data?.versionNo;
        setResultText(
          typeof versionNo === "number"
            ? `Рецепт опубликован. Создана версия №${versionNo}.`
            : "Рецепт опубликован."
        );
      }
      toast.success("Публикация выполнена");
    },
    onError: (err: Error) => {
      setErrorText(err.message);
      toast.error("Публикация не выполнена", { description: err.message });
    },
  });

  const isUpdate = row?.status === "published";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isUpdate ? "Публикация обновления" : "Публикация рецепта"}
          </DialogTitle>
          <DialogDescription>
            {row ? `«${row.title}»` : ""}
            {". "}Сервер создаст неизменяемую версию контента.
          </DialogDescription>
        </DialogHeader>

        {errorText && (
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertTitle>Публикация отклонена сервером</AlertTitle>
            <AlertDescription>
              {errorText}
              {errorText.includes("Подтвердите права") && (
                <div className="mt-1 text-xs">
                  Нажмите «Подтвердить права» в строке рецепта и повторите публикацию.
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {resultText ? (
          <Alert className="border-emerald-300 bg-emerald-50 text-emerald-800">
            <ShieldCheck className="w-4 h-4" />
            <AlertTitle>Готово</AlertTitle>
            <AlertDescription>{resultText}</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            {row?.rights_confirmed === false && (
              <Alert className="border-amber-300 bg-amber-50 text-amber-800">
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription>
                  У рецепта есть непроверенный источник — подтвердите права перед публикацией.
                </AlertDescription>
              </Alert>
            )}
            <div>
              <Label htmlFor="ra-changelog">
                Что изменилось (changelog, до 500 символов)
              </Label>
              <Textarea
                id="ra-changelog"
                value={changelog}
                onChange={(e) => setChangelog(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder={
                  isUpdate
                    ? "Напр.: добавлен шаг темперирования шоколада"
                    : "Напр.: первая публикация"
                }
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={publishM.isPending}>
            {resultText ? "Закрыть" : "Отмена"}
          </Button>
          {!resultText && (
            <Button onClick={() => publishM.mutate()} disabled={publishM.isPending}>
              {publishM.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Send className="w-4 h-4 mr-2" />
              {isUpdate ? "Опубликовать обновление" : "Опубликовать"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Диалог версий (ленивая загрузка при открытии)
// ============================================================
function VersionsDialog({
  row,
  open,
  onOpenChange,
}: {
  row: RecipeListRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const versionsQ = useQuery<RecipeVersionRow[]>({
    queryKey: ["recipe-versions", row?.id ?? ""],
    queryFn: async () => {
      const { data } = await apiRequest<RecipeVersionRow[]>(
        `/api/recipes/${row?.id}/versions`
      );
      return Array.isArray(data) ? data : [];
    },
    enabled: open && !!row,
  });

  const versions = versionsQ.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Версии рецепта
          </DialogTitle>
          <DialogDescription>
            {row ? `«${row.title}»` : ""} — неизменяемые снапшоты публикаций.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-96 overflow-y-auto">
          {versionsQ.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : versionsQ.error ? (
            <Alert variant="destructive">
              <AlertTriangle className="w-4 h-4" />
              <AlertTitle>Не удалось загрузить версии</AlertTitle>
              <AlertDescription>{(versionsQ.error as Error).message}</AlertDescription>
            </Alert>
          ) : versions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Версий ещё нет — опубликуйте рецепт, чтобы зафиксировать первую.
            </p>
          ) : (
            <div className="divide-y">
              {versions.map((v) => (
                <div key={v.id} className="py-2 flex items-start gap-3">
                  <Badge variant="outline" className="shrink-0 mt-0.5">
                    v{v.version_no}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      {v.changelog?.trim() || "Без описания изменений"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateRu(v.created_at)}
                      {v.origin ? ` • ${v.origin}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
          <Button
            variant="outline"
            onClick={() => versionsQ.refetch()}
            disabled={versionsQ.isFetching}
          >
            {versionsQ.isFetching && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Обновить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
