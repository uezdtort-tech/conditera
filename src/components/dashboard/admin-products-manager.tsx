"use client";

/**
 * AdminProductsManager — управление каталогом товаров (Task 4-a, персистентный).
 *
 * Изменения Task 4-a:
 *   • редактор карточки — Tabs «Основное / Характеристики / Состав / Медиа»;
 *   • «Сохранить» → PATCH /api/products/{id} (camelCase, только изменённые поля),
 *     ответ маппится snake→camel и мерджится в zustand store;
 *   • «Опубликовать / Снять с публикации» → PATCH status published/archived
 *     (422 PUBLISH_VALIDATION_FAILED → список missing);
 *   • «Создать товар» → POST /api/products {confectionerId, title, description,
 *     price, status: "draft"} (+ категория slug'ом);
 *   • «Скрыть/Показать» → PATCH archived/published вместо клиентского toggle;
 *   • кнопка «Удалить» заменена на «Архивировать» (PATCH archived) —
 *     DELETE-эндпоинта товара нет;
 *   • таб «Медиа» — ProductMediaManager (реальные медиа-API).
 *
 * Легаси-поля без серверного контракта (isPopular/isNew/isHit/arEnabled,
 * images по URL, prepTime, confectioner) продолжают работать локально в store.
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Pencil, Eye, Search, Plus, Check, AlertCircle, EyeOff, Star, Package,
  Archive, Loader2, X, Globe, ListChecks,
} from "lucide-react";
import { formatCurrency } from "@/lib/finance";
import { toast } from "sonner";
import { csrfFetch } from "@/lib/api-client";
import { ProductMediaManager } from "@/components/dashboard/product-media-manager";
import type { Product, ProductCategory } from "@/lib/types";
import type { ProductCompletenessResponse } from "@/lib/ops-client-types";

const PRODUCT_CATEGORIES: { value: ProductCategory; label: string }[] = [
  { value: "cakes", label: "Торты" },
  { value: "cupcakes", label: "Капкейки" },
  { value: "pastries", label: "Пирожные" },
  { value: "cookies", label: "Печенье" },
  { value: "chocolate", label: "Шоколад" },
  { value: "macarons", label: "Макаронс" },
  { value: "bento", label: "Бенто-торты" },
  { value: "desserts", label: "Десерты" },
  { value: "gingerbread", label: "Пряники" },
  { value: "pies", label: "Пироги" },
  { value: "rolls", label: "Рулеты" },
  { value: "healthy", label: "ПП изделия" },
  { value: "zephyr_bouquets", label: "Зефирные букеты" },
  { value: "oriental_sweets", label: "Восточные сладости" },
];

// Стандартный список аллергенов (тогглы в табе «Состав»)
const COMMON_ALLERGENS = [
  "Глютен",
  "Молоко",
  "Яйца",
  "Орехи",
  "Арахис",
  "Соя",
  "Рыба",
  "Морепродукты",
  "Кунжут",
];

type ProductStatus = "draft" | "published" | "archived";

const STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "Черновик",
  published: "Опубликован",
  archived: "Архив",
};

const STATUS_BADGE: Record<ProductStatus, string> = {
  draft: "bg-amber-100 text-amber-800 border-amber-300",
  published: "bg-emerald-100 text-emerald-800 border-emerald-300",
  archived: "bg-red-100 text-red-800 border-red-300",
};

// Человекочитаемые имена полей для PUBLISH_VALIDATION_FAILED.missing
const MISSING_FIELD_LABELS: Record<string, string> = {
  title: "название (мин. 3 символа)",
  description: "описание (мин. 10 символов)",
  price: "цена (минимум 1 ₽)",
};

/** Числовой input-хелпер: "" → null */
function numOrNull(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function mapMissingToLabels(missing: string[]): string {
  if (missing.length === 0) return "";
  return missing
    .map((m) => MISSING_FIELD_LABELS[m] || m)
    .join("; ");
}

// ==================== Основной компонент ====================

export function AdminProductsManager() {
  const products = useAppStore((s) => s.products);
  const confectioners = useAppStore((s) => s.confectioners);
  const updateProduct = useAppStore((s) => s.updateProduct);
  const user = useAppStore((s) => s.user);

  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("all");
  const [filterVisibility, setFilterVisibility] = useState<string>("all");
  const [filterConfectioner, setFilterConfectioner] = useState<string>("all");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [hideDialogProduct, setHideDialogProduct] = useState<Product | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  const canModerate = useMemo(() => {
    const roles = user?.roles || [];
    return roles.includes("ADMIN") || roles.includes("SUPER_ADMIN") || roles.includes("MODERATOR");
  }, [user]);

  const canPublish = useMemo(() => {
    const roles = user?.roles || [];
    return roles.includes("ADMIN") || roles.includes("SUPER_ADMIN");
  }, [user]);

  const filtered = useMemo(() => {
    return products.filter((p: Product) => {
      if (search) {
        const q = search.toLowerCase();
        if (!p.title.toLowerCase().includes(q) && !p.confectionerName?.toLowerCase().includes(q)) return false;
      }
      if (filterCat !== "all" && p.category !== filterCat) return false;
      if (filterVisibility === "visible" && p.isHidden) return false;
      if (filterVisibility === "hidden" && !p.isHidden) return false;
      if (filterConfectioner !== "all" && p.confectionerId !== filterConfectioner) return false;
      return true;
    });
  }, [products, search, filterCat, filterVisibility, filterConfectioner]);

  const stats = {
    total: products.length,
    visible: products.filter((p: Product) => !p.isHidden).length,
    hidden: products.filter((p: Product) => p.isHidden).length,
    popular: products.filter((p: Product) => p.isPopular).length,
  };

  /** PATCH статуса товара (published | archived | draft) + merge в store. */
  const patchStatus = useCallback(
    async (p: Product, status: ProductStatus, successLabel: string) => {
      setBusyActionId(p.id);
      try {
        const res = await csrfFetch(`/api/products/${p.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string; missing?: string[] }
            | null;
          if (res.status === 422 && body?.error === "PUBLISH_VALIDATION_FAILED") {
            toast.error("Публикация невозможна — заполните обязательные поля", {
              description: mapMissingToLabels(body?.missing || []),
            });
            return;
          }
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { product?: Record<string, unknown> };
        const merged = mapServerRowToProductPatch(data.product);
        updateProduct(p.id, {
          ...merged,
          isHidden: status !== "published",
          hiddenReason: status === "archived" ? `Статус: ${STATUS_LABELS[status]}` : undefined,
        });
        toast.success(successLabel, { description: p.title });
      } catch (e) {
        toast.error("Действие не выполнено", {
          description: e instanceof Error ? e.message : undefined,
        });
      } finally {
        setBusyActionId(null);
      }
    },
    [updateProduct],
  );

  const handleConfirmHide = () => {
    if (!hideDialogProduct) return;
    const target = hideDialogProduct;
    setHideDialogProduct(null);
    void patchStatus(
      target,
      target.isHidden ? "published" : "archived",
      target.isHidden ? "Товар снова опубликован" : "Товар скрыт из каталога",
    );
  };

  const handleArchive = (p: Product) => {
    if (confirm(`Архивировать «${p.title}»? Товар исчезнет из публичного каталога (восстановимо).`)) {
      void patchStatus(p, "archived", "Товар архивирован");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Товары платформы
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Управление каталогом: карточки, медиа, публикация и архивирование
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setCreateDialogOpen(true)} disabled={!canPublish}>
            <Plus className="h-4 w-4 mr-1" />
            Создать товар
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Всего товаров</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Видимых</div>
          <div className="text-2xl font-bold text-emerald-600">{stats.visible}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Скрытых</div>
          <div className="text-2xl font-bold text-amber-600">{stats.hidden}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Популярных</div>
          <div className="text-2xl font-bold text-purple-600">{stats.popular}</div>
        </Card>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию или кондитеру..."
            className="pl-9"
          />
        </div>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger><SelectValue placeholder="Категория" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все категории</SelectItem>
            {PRODUCT_CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterVisibility} onValueChange={setFilterVisibility}>
          <SelectTrigger><SelectValue placeholder="Видимость" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="visible">Только видимые</SelectItem>
            <SelectItem value="hidden">Только скрытые</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
            Товары не найдены. Измените фильтры.
          </Card>
        ) : filtered.map((p: Product) => (
          <Card key={p.id} className={`p-3 ${p.isHidden ? "opacity-60 border-amber-300 bg-amber-50/30" : ""}`}>
            <div className="flex gap-3">
              <div className="w-20 h-20 rounded bg-muted overflow-hidden flex-shrink-0 relative">
                <img src={p.images?.[0]} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                {p.isHidden && (
                  <div className="absolute inset-0 bg-amber-900/40 flex items-center justify-center">
                    <EyeOff className="h-5 w-5 text-white" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm line-clamp-2 flex items-start gap-1">
                  {p.title}
                  {p.isPopular && <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0 mt-0.5" />}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{p.confectionerName}</div>
                <div className="flex items-center justify-between mt-1 flex-wrap gap-1">
                  <span className="font-semibold text-sm">{formatCurrency(p.price)}</span>
                  <Badge variant="secondary" className="text-[10px]">{p.category}</Badge>
                </div>
                {p.isHidden && (
                  <div className="text-[10px] text-amber-700 mt-1 line-clamp-1">
                    Скрыт: {p.hiddenReason || "администратором"}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-1 mt-2 pt-2 border-t">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs flex-1"
                onClick={() => setViewingProduct(p)}
                title="Просмотр"
              >
                <Eye className="h-3 w-3 mr-1" />Просмотр
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs flex-1 text-primary"
                onClick={() => setEditingProduct(p)}
                title="Редактировать"
              >
                <Pencil className="h-3 w-3 mr-1" />Изменить
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className={`h-7 text-xs ${p.isHidden ? "text-emerald-600" : "text-amber-600"}`}
                disabled={busyActionId === p.id || !canPublish}
                onClick={() => setHideDialogProduct(p)}
                title={p.isHidden ? "Показать (PATCH published)" : "Скрыть (PATCH archived)"}
              >
                {busyActionId === p.id ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : p.isHidden ? (
                  <><Eye className="h-3 w-3 mr-1" />Показать</>
                ) : (
                  <><EyeOff className="h-3 w-3 mr-1" />Скрыть</>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-red-600"
                disabled={busyActionId === p.id || !canPublish || p.isHidden}
                onClick={() => handleArchive(p)}
                title="Архивировать (PATCH archived)"
              >
                <Archive className="h-3 w-3" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Edit Dialog */}
      {editingProduct && (
        <ProductEditAdminDialog
          product={editingProduct}
          canModerate={canModerate}
          canSetCover={canPublish}
          confectioners={confectioners}
          onClose={() => setEditingProduct(null)}
        />
      )}

      {/* View Dialog */}
      {viewingProduct && (
        <ProductViewDialog
          product={viewingProduct}
          onClose={() => setViewingProduct(null)}
          onEdit={() => { setEditingProduct(viewingProduct); setViewingProduct(null); }}
        />
      )}

      {/* Create Dialog */}
      {createDialogOpen && (
        <CreateProductDialog
          onClose={() => setCreateDialogOpen(false)}
        />
      )}

      {/* Hide/Show confirm (PATCH archived / published) */}
      <AlertDialog open={!!hideDialogProduct} onOpenChange={(o) => !o && setHideDialogProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hideDialogProduct?.isHidden ? "Показать товар?" : "Скрыть товар?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hideDialogProduct?.isHidden
                ? "Товар будет снова опубликован (PATCH status: published) и вернётся в публичный каталог."
                : "Товар будет скрыт из публичного каталога (PATCH status: archived). Покупатели не смогут его видеть и заказывать."}
              {" "}Статус сохраняется на сервере.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmHide}>
              <Check className="h-4 w-4 mr-1" />
              {hideDialogProduct?.isHidden ? "Показать" : "Скрыть"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ==================== snake → camel маппинг ответа PATCH/POST ====================

/**
 * Маппинг серверной строки products (snake_case) в патч для store (camelCase).
 * Используется после PATCH и POST — «маппинг сделан руками», numeric поля
 * приходят строками ("18.50") → Number().
 */
function mapServerRowToProductPatch(row: Record<string, unknown> | undefined | null): Partial<Product> {
  if (!row) return {};
  const out: Partial<Product> = {};
  const n = (v: unknown): number | null => (v == null ? null : Number(v));
  const s = (v: unknown): string | null => (v == null ? null : String(v));

  if (row.title !== undefined) out.title = String(row.title);
  if (row.description !== undefined) out.description = String(row.description ?? "");
  if (row.price !== undefined && row.price !== null) out.price = Math.round(Number(row.price));
  if (row.old_price !== undefined) {
    out.oldPrice = row.old_price != null ? Math.round(Number(row.old_price)) : undefined;
  }
  if (row.weight_grams !== undefined) {
    out.weight = row.weight_grams != null ? `${Number(row.weight_grams)} г` : undefined;
  }
  if (row.servings !== undefined) out.servings = row.servings != null ? Number(row.servings) : undefined;
  if (row.short_description !== undefined) out.shortDescription = s(row.short_description) ?? undefined;
  if (row.diameter_cm !== undefined) out.diameterCm = n(row.diameter_cm);
  if (row.height_cm !== undefined) out.heightCm = n(row.height_cm);
  if (row.size_text !== undefined) out.sizeText = s(row.size_text);
  if (row.shape !== undefined) out.shape = s(row.shape);
  if (row.product_type !== undefined) out.productType = s(row.product_type);
  if (row.filling_description !== undefined) out.fillingDescription = s(row.filling_description);
  if (row.layers_count !== undefined) out.layersCount = n(row.layers_count);
  if (row.min_order_qty !== undefined) out.minOrderQty = row.min_order_qty != null ? Number(row.min_order_qty) : undefined;
  if (row.custom_order_available !== undefined) out.customOrderAvailable = Boolean(row.custom_order_available);
  if (row.is_available !== undefined) out.isAvailable = Boolean(row.is_available);
  if (row.production_time_hours !== undefined) out.productionTimeHours = n(row.production_time_hours);
  if (row.composition !== undefined && row.composition && typeof row.composition === "object") {
    out.composition = row.composition as Product["composition"];
  }
  return out;
}

// =================== Product Edit Dialog (admin, персистентный) ===================

/** Локальная форма карточки — camelCase (как Product) + composition-поля. */
interface EditFormState {
  title: string;
  shortDescription: string;
  description: string;
  price: number;
  oldPrice: number | null;
  category: ProductCategory;
  weightGrams: number | null;
  servings: number | null;
  diameterCm: number | null;
  heightCm: number | null;
  sizeText: string;
  shape: string;
  productType: string;
  fillingDescription: string;
  layersCount: number | null;
  minOrderQty: number;
  customOrderAvailable: boolean;
  isAvailable: boolean;
  productionTimeHours: number | null;
  ingredients: string[];
  allergens: string[];
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  storageConditions: string;
  shelfLife: string;
}

function formFromProduct(p: Product): EditFormState {
  const c = p.composition || {
    ingredients: [],
    allergens: [],
    nutritionalValue: {},
    storageConditions: "",
    shelfLife: "",
  };
  return {
    title: p.title || "",
    shortDescription: p.shortDescription || "",
    description: p.description || "",
    price: p.price || 0,
    oldPrice: p.oldPrice ?? null,
    category: p.category,
    weightGrams: p.weight ? Number(String(p.weight).replace(/[^\d.,]/g, "").replace(",", ".")) || null : null,
    servings: p.servings ?? null,
    diameterCm: p.diameterCm ?? null,
    heightCm: p.heightCm ?? null,
    sizeText: p.sizeText || "",
    shape: p.shape || "",
    productType: p.productType || "",
    fillingDescription: p.fillingDescription || "",
    layersCount: p.layersCount ?? null,
    minOrderQty: p.minOrderQty ?? 1,
    customOrderAvailable: p.customOrderAvailable ?? true,
    isAvailable: p.isAvailable ?? true,
    productionTimeHours: p.productionTimeHours ?? null,
    ingredients: c.ingredients || [],
    allergens: c.allergens || [],
    calories: c.nutritionalValue?.calories ?? null,
    protein: c.nutritionalValue?.protein ?? null,
    fat: c.nutritionalValue?.fat ?? null,
    carbs: c.nutritionalValue?.carbs ?? null,
    storageConditions: c.storageConditions || "",
    shelfLife: c.shelfLife || "",
  };
}

function ProductEditAdminDialog({
  product,
  canModerate,
  canSetCover,
  confectioners,
  onClose,
}: {
  product: Product;
  canModerate: boolean;
  canSetCover: boolean;
  confectioners: { id: string; businessName?: string; name?: string }[];
  onClose: () => void;
}) {
  const updateProduct = useAppStore((s) => s.updateProduct);

  const [form, setForm] = useState<EditFormState>(() => formFromProduct(product));
  const [initial, setInitial] = useState<EditFormState>(() => formFromProduct(product));
  // Легаси-поля (только store, не API)
  const [imageUrl, setImageUrl] = useState("");
  const [images, setImages] = useState<string[]>(product.images || []);
  const [isPopular, setIsPopular] = useState(!!product.isPopular);
  const [isNew, setIsNew] = useState(!!product.isNew);
  const [isHit, setIsHit] = useState(!!product.isHit);
  const [arEnabled, setArEnabled] = useState(!!product.arEnabled);
  const [prepTime, setPrepTime] = useState(product.prepTime || "");
  const [confectionerId, setConfectionerId] = useState(product.confectionerId || "");
  // Серверные метаданные
  const [serverStatus, setServerStatus] = useState<ProductStatus | null>(null);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [serverCategoryId, setServerCategoryId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Реальные категории (slug → UUID) для PATCH categoryId
  const categoriesQuery = useQuery<{ id: string; slug: string; name: string }[]>({
    queryKey: ["categories"],
    staleTime: 10 * 60 * 1000,
  });
  const categories = categoriesQuery.data || [];
  const effectiveCategorySlug = useMemo(() => {
    // Реальная категория с сервера точнее клиентской догадки (guessCategory)
    const fromServer = serverCategoryId
      ? categories.find((c) => c.id === serverCategoryId)?.slug
      : undefined;
    return (fromServer as ProductCategory | undefined) ?? form.category;
  }, [serverCategoryId, categories, form.category]);

  const set = <K extends keyof EditFormState>(key: K, value: EditFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Обогащение формы полными данными карточки (GET /api/products/{id}).
  // Для draft/archived публичный GET отдаёт 404 — тогда работаем с копией из store.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await csrfFetch(`/api/products/${product.id}`);
        if (!res.ok) return;
        const data = (await res.json()) as { product?: Record<string, unknown> };
        if (cancelled || !data.product) return;
        const row = data.product;
        const patch = mapServerRowToProductPatch(row);
        setForm((prev) => ({ ...prev, ...formFromProduct({ ...product, ...patch }) }));
        setInitial((prev) => ({ ...prev, ...formFromProduct({ ...product, ...patch }) }));
        setServerStatus((row.status as ProductStatus) ?? null);
        setPublishedAt((row.published_at as string | null) ?? null);
        setServerCategoryId((row.category_id as string | null) ?? null);
      } catch {
        // 404 draft / сеть — остаёмся на данных store
      }
    })();
    return () => { cancelled = true; };
  }, [product.id]);

  const status: ProductStatus = serverStatus ?? (product.isHidden ? "archived" : "published");

  // ==================== Готовность карточки (completeness, Task 3-F) ====================
  const queryClient = useQueryClient();
  const completenessQuery = useQuery<ProductCompletenessResponse>({
    queryKey: ["product-completeness", product.id],
    enabled: !!product.id,
    queryFn: async () => {
      const res = await csrfFetch(`/api/products/${product.id}/completeness`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ProductCompletenessResponse;
    },
  });
  const completeness = completenessQuery.data;
  const completenessScore = completeness?.score ?? null;
  const missingRequired = (completeness?.checks ?? [])
    .filter((c) => !c.done && c.required)
    .map((c) => c.label);
  // Блокируем кнопку публикации ТОЛЬКО когда чек-лист реально получен и
  // ready_to_publish=false (требуемые поля совпадают с серверным гейтом
  // PUBLISH_VALIDATION_FAILED: title/description/price). Если API недоступен —
  // кнопка остаётся активной, решения принимает сервер.
  const publishBlocked = !!completeness && !completeness.ready_to_publish;
  const refreshCompleteness = () =>
    void queryClient.invalidateQueries({ queryKey: ["product-completeness", product.id] });

  // ==================== Сохранение (PATCH только изменённых полей) ====================

  const buildPatchBody = useCallback((): Record<string, unknown> | null => {
    const body: Record<string, unknown> = {};

    if (form.title.trim() !== initial.title.trim()) body.title = form.title.trim();
    if (form.shortDescription.trim() !== initial.shortDescription.trim()) {
      body.shortDescription = form.shortDescription.trim() || null;
    }
    if (form.description.trim() !== initial.description.trim()) {
      body.description = form.description.trim();
    }
    if (Math.round(form.price) !== Math.round(initial.price)) body.price = Math.round(form.price);
    if ((form.oldPrice ?? null) !== (initial.oldPrice ?? null)) body.oldPrice = form.oldPrice;

    // Категория: slug → UUID (только если реально изменена)
    if (form.category !== effectiveCategorySlug) {
      const uuid = categories.find((c) => c.slug === form.category)?.id;
      if (uuid) body.categoryId = uuid;
    }

    if ((form.weightGrams ?? null) !== (initial.weightGrams ?? null)) body.weightGrams = form.weightGrams;
    if ((form.servings ?? null) !== (initial.servings ?? null)) body.servings = form.servings;
    if ((form.diameterCm ?? null) !== (initial.diameterCm ?? null)) body.diameterCm = form.diameterCm;
    if ((form.heightCm ?? null) !== (initial.heightCm ?? null)) body.heightCm = form.heightCm;
    if (form.sizeText.trim() !== initial.sizeText.trim()) body.sizeText = form.sizeText.trim() || null;
    if (form.shape.trim() !== initial.shape.trim()) body.shape = form.shape.trim() || null;
    if (form.productType.trim() !== initial.productType.trim()) body.productType = form.productType.trim() || null;
    if (form.fillingDescription.trim() !== initial.fillingDescription.trim()) {
      body.fillingDescription = form.fillingDescription.trim() || null;
    }
    if ((form.layersCount ?? null) !== (initial.layersCount ?? null)) body.layersCount = form.layersCount;
    if (form.minOrderQty !== initial.minOrderQty) body.minOrderQty = form.minOrderQty;
    if (form.customOrderAvailable !== initial.customOrderAvailable) body.customOrderAvailable = form.customOrderAvailable;
    if (form.isAvailable !== initial.isAvailable) body.isAvailable = form.isAvailable;
    if ((form.productionTimeHours ?? null) !== (initial.productionTimeHours ?? null)) {
      body.productionTimeHours = form.productionTimeHours;
    }

    // Состав — сравниваем как объект целиком
    const currentComposition = {
      ingredients: form.ingredients,
      allergens: form.allergens,
      nutritionalValue: {
        ...(form.calories != null ? { calories: form.calories } : {}),
        ...(form.protein != null ? { protein: form.protein } : {}),
        ...(form.fat != null ? { fat: form.fat } : {}),
        ...(form.carbs != null ? { carbs: form.carbs } : {}),
      },
      storageConditions: form.storageConditions.trim(),
      shelfLife: form.shelfLife.trim(),
    };
    const initialComposition = {
      ingredients: initial.ingredients,
      allergens: initial.allergens,
      nutritionalValue: {
        ...(initial.calories != null ? { calories: initial.calories } : {}),
        ...(initial.protein != null ? { protein: initial.protein } : {}),
        ...(initial.fat != null ? { fat: initial.fat } : {}),
        ...(initial.carbs != null ? { carbs: initial.carbs } : {}),
      },
      storageConditions: initial.storageConditions.trim(),
      shelfLife: initial.shelfLife.trim(),
    };
    if (JSON.stringify(currentComposition) !== JSON.stringify(initialComposition)) {
      body.composition = currentComposition;
    }

    return Object.keys(body).length > 0 ? body : null;
  }, [form, initial, effectiveCategorySlug, categories]);

  const handleSave = async () => {
    // Клиентская предвалидация ключевых полей (контракт PATCH: title≥3, description≥10, price≥1)
    if (form.title.trim().length < 3) {
      toast.error("Название слишком короткое", { description: "Минимум 3 символа" });
      return;
    }
    if (!form.price || form.price <= 0) {
      toast.error("Укажите корректную цену");
      return;
    }
    if (form.description.trim().length < 10) {
      toast.error("Описание слишком короткое", { description: "Минимум 10 символов (требование публикации)" });
      return;
    }

    const body = buildPatchBody();
    setSaving(true);
    try {
      // Легаси-поля применяются к store независимо от PATCH
      const legacyPatch: Partial<Product> = {
        images,
        isPopular,
        isNew,
        isHit,
        arEnabled,
        prepTime: prepTime || undefined,
        confectionerId,
        confectionerName: confectioners.find((c) => c.id === confectionerId)?.businessName || product.confectionerName,
        category: form.category,
      };

      if (!body) {
        // Нечего отправлять на сервер — только локальные поля
        updateProduct(product.id, legacyPatch);
        toast.success("Товар обновлён", { description: form.title });
        refreshCompleteness();
        onClose();
        return;
      }

      const res = await csrfFetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 422) {
        const err = (await res.json().catch(() => null)) as
          | { error?: string; missing?: string[]; issues?: { formErrors?: string[]; fieldErrors?: Record<string, string[]> } }
          | null;
        if (err?.error === "PUBLISH_VALIDATION_FAILED") {
          toast.error("Публикация невозможна", { description: mapMissingToLabels(err?.missing || []) });
          return;
        }
        const parts: string[] = [];
        if (err?.issues?.formErrors?.length) parts.push(...err.issues.formErrors);
        if (err?.issues?.fieldErrors) {
          for (const [field, messages] of Object.entries(err.issues.fieldErrors)) {
            if (messages?.length) parts.push(`${field}: ${messages[0]}`);
          }
        }
        toast.error("Проверьте правильность полей", {
          description: parts.slice(0, 3).join(" • ") || "Некоторые поля не прошли валидацию",
        });
        return;
      }
      if (res.status === 401) {
        toast.error("Требуется вход в систему");
        return;
      }
      if (res.status === 403) {
        toast.error("Недостаточно прав для редактирования этого товара");
        return;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error || `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { product?: Record<string, unknown> };
      const serverPatch = mapServerRowToProductPatch(data.product);
      updateProduct(product.id, { ...serverPatch, ...legacyPatch });
      if (data.product?.published_at !== undefined) {
        setPublishedAt((data.product.published_at as string | null) ?? null);
      }
      if (data.product?.status) setServerStatus(data.product.status as ProductStatus);
      setInitial({ ...form });
      toast.success("Товар обновлён", { description: "Изменения сохранены на сервере" });
      refreshCompleteness();
      onClose();
    } catch (e) {
      toast.error("Не удалось сохранить товар", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  // ==================== Публикация / снятие с публикации ====================

  const togglePublish = async () => {
    const nextStatus: ProductStatus = status === "published" ? "archived" : "published";
    setPublishing(true);
    try {
      const res = await csrfFetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as
          | { error?: string; missing?: string[] }
          | null;
        if (res.status === 422 && err?.error === "PUBLISH_VALIDATION_FAILED") {
          toast.error("Публикация невозможна — заполните обязательные поля", {
            description: mapMissingToLabels(err?.missing || []),
          });
          return;
        }
        if (res.status === 403) {
          toast.error("Недостаточно прав для изменения статуса публикации");
          return;
        }
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { product?: Record<string, unknown> };
      const serverPatch = mapServerRowToProductPatch(data.product);
      updateProduct(product.id, {
        ...serverPatch,
        isHidden: nextStatus !== "published",
        hiddenReason: nextStatus === "archived" ? "Снят с публикации" : undefined,
      });
      setServerStatus(nextStatus);
      if (data.product?.published_at !== undefined) {
        setPublishedAt((data.product.published_at as string | null) ?? null);
      }
      toast.success(
        nextStatus === "published" ? "Товар опубликован" : "Товар снят с публикации",
        { description: form.title },
      );
    } catch (e) {
      toast.error("Действие не выполнено", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setPublishing(false);
    }
  };

  // ==================== Легаси-изображения (URL) ====================

  const addImage = () => {
    if (imageUrl.trim()) {
      setImages((prev) => [...prev, imageUrl.trim()]);
      setImageUrl("");
    }
  };
  const removeImage = (idx: number) => setImages((prev) => prev.filter((_, i) => i !== idx));

  // ==================== Чип-инпут ингредиентов ====================

  const [ingredientDraft, setIngredientDraft] = useState("");
  const addIngredient = () => {
    const v = ingredientDraft.trim();
    if (v && !form.ingredients.includes(v)) set("ingredients", [...form.ingredients, v]);
    setIngredientDraft("");
  };
  const removeIngredient = (name: string) =>
    set("ingredients", form.ingredients.filter((i) => i !== name));
  const toggleAllergen = (name: string) =>
    set("allergens", form.allergens.includes(name)
      ? form.allergens.filter((a) => a !== name)
      : [...form.allergens, name]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap pr-6">
            Редактирование товара
            <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[status]}`}>
              {STATUS_LABELS[status]}
            </Badge>
            {completenessScore != null && (
              <span className="flex items-center gap-2 ml-1">
                <span className="text-[11px] text-muted-foreground">Готовность карточки</span>
                <Progress value={completenessScore} className="w-24 h-2" />
                <span className={`text-[11px] font-medium ${publishBlocked ? "text-amber-700" : "text-emerald-700"}`}>
                  {completenessScore}%
                </span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      aria-label="Чек-лист готовности карточки"
                    >
                      <ListChecks className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72" align="start">
                    <div className="text-xs font-semibold mb-2">Готовность карточки</div>
                    <div className="space-y-1.5 max-h-64 overflow-y-auto">
                      {(completeness?.checks ?? []).map((c) => (
                        <div key={c.key} className="flex items-start gap-2 text-xs">
                          {c.done ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />
                          ) : (
                            <AlertCircle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                          )}
                          <span className={c.done ? "text-muted-foreground line-through" : ""}>{c.label}</span>
                          {c.required && !c.done && (
                            <Badge variant="outline" className="text-[9px] border-red-200 text-red-700 ml-auto shrink-0">
                              обязательно
                            </Badge>
                          )}
                        </div>
                      ))}
                      {(completeness?.checks ?? []).length === 0 && (
                        <p className="text-xs text-muted-foreground">Чек-лист недоступен</p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3">
            <span>{product.confectionerName || product.confectionerId}</span>
            {publishedAt && (
              <span className="text-emerald-700">
                Опубликован: {new Date(publishedAt).toLocaleString("ru-RU")}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic">
          <TabsList className="w-full justify-start flex-wrap h-auto">
            <TabsTrigger value="basic">Основное</TabsTrigger>
            <TabsTrigger value="specs">Характеристики</TabsTrigger>
            <TabsTrigger value="composition">Состав</TabsTrigger>
            <TabsTrigger value="media">Медиа</TabsTrigger>
          </TabsList>

          {/* ==================== ОСНОВНОЕ ==================== */}
          <TabsContent value="basic" className="space-y-3 mt-3">
            <div>
              <Label>Название</Label>
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
            </div>

            <div>
              <Label>Краткое описание (витрина)</Label>
              <Input
                value={form.shortDescription}
                onChange={(e) => set("shortDescription", e.target.value)}
                placeholder="Одна строка для карточек каталога"
              />
            </div>

            <div>
              <Label>Описание</Label>
              <Textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                rows={4}
                placeholder="Полное описание товара (минимум 10 символов для публикации)"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Цена, ₽</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.price}
                  onChange={(e) => set("price", Number(e.target.value))}
                />
              </div>
              <div>
                <Label>Старая цена, ₽ (опционально)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.oldPrice ?? ""}
                  onChange={(e) => set("oldPrice", e.target.value ? Number(e.target.value) : null)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Категория</Label>
                <Select value={form.category} onValueChange={(v) => set("category", v as ProductCategory)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRODUCT_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Кондитер</Label>
                <Select
                  value={confectionerId}
                  onValueChange={(v) => {
                    const c = confectioners.find((x) => x.id === v);
                    updateProduct(product.id, {
                      confectionerId: v,
                      confectionerName: c?.businessName || c?.name || product.confectionerName,
                    });
                    setConfectionerId(v);
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Кондитер" /></SelectTrigger>
                  <SelectContent>
                    {confectioners.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.businessName || c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Срок изготовления (текст)</Label>
              <Input value={prepTime} onChange={(e) => setPrepTime(e.target.value)} placeholder="2 дня" />
            </div>

            <div>
              <Label>Изображения (URL)</Label>
              <div className="flex gap-2">
                <Input
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://..."
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addImage(); } }}
                />
                <Button type="button" onClick={addImage}><Plus className="h-4 w-4" /></Button>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {images.map((img, i) => (
                  <div key={i} className="relative w-16 h-16 rounded overflow-hidden border">
                    <img src={img} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeImage(i)}
                      className="absolute top-0 right-0 bg-red-500 text-white p-0.5 rounded-bl"
                      type="button"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Загружайте настоящие фото и видео на вкладке «Медиа» — они попадут в карточку после модерации.
              </p>
            </div>

            <div className="flex flex-wrap gap-4 pt-1">
              {([
                ["Популярный", isPopular, setIsPopular],
                ["Новинка", isNew, setIsNew],
                ["Хит", isHit, setIsHit],
                ["AR-просмотр", arEnabled, setArEnabled],
              ] as [string, boolean, (v: boolean) => void][]).map(([label, value, setter]) => (
                <div key={label} className="flex items-center gap-2">
                  <Switch checked={value} onCheckedChange={setter} id={`flag-${label}`} />
                  <Label htmlFor={`flag-${label}`} className="text-sm cursor-pointer">{label}</Label>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ==================== ХАРАКТЕРИСТИКИ ==================== */}
          <TabsContent value="specs" className="space-y-3 mt-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <Label>Вес, г</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.weightGrams ?? ""}
                  onChange={(e) => set("weightGrams", numOrNull(e.target.value))}
                  placeholder="1200"
                />
              </div>
              <div>
                <Label>Порций</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.servings ?? ""}
                  onChange={(e) => set("servings", numOrNull(e.target.value))}
                />
              </div>
              <div>
                <Label>Срок изготовления, часов</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.productionTimeHours ?? ""}
                  onChange={(e) => set("productionTimeHours", numOrNull(e.target.value))}
                  placeholder="48"
                />
              </div>
              <div>
                <Label>Диаметр, см</Label>
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  value={form.diameterCm ?? ""}
                  onChange={(e) => set("diameterCm", numOrNull(e.target.value))}
                />
              </div>
              <div>
                <Label>Высота, см</Label>
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  value={form.heightCm ?? ""}
                  onChange={(e) => set("heightCm", numOrNull(e.target.value))}
                />
              </div>
              <div>
                <Label>Размер (текст)</Label>
                <Input
                  value={form.sizeText}
                  onChange={(e) => set("sizeText", e.target.value)}
                  placeholder="16 × 12 см"
                />
              </div>
              <div>
                <Label>Форма</Label>
                <Input
                  value={form.shape}
                  onChange={(e) => set("shape", e.target.value)}
                  placeholder="Круг, сердце..."
                />
              </div>
              <div>
                <Label>Тип изделия</Label>
                <Input
                  value={form.productType}
                  onChange={(e) => set("productType", e.target.value)}
                  placeholder="Ярусный торт"
                />
              </div>
              <div>
                <Label>Количество ярусов</Label>
                <Input
                  type="number"
                  min={0}
                  max={20}
                  value={form.layersCount ?? ""}
                  onChange={(e) => set("layersCount", numOrNull(e.target.value))}
                />
              </div>
              <div>
                <Label>Мин. количество для заказа</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.minOrderQty}
                  onChange={(e) => set("minOrderQty", Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            </div>

            <div>
              <Label>Описание начинки</Label>
              <Textarea
                value={form.fillingDescription}
                onChange={(e) => set("fillingDescription", e.target.value)}
                rows={2}
                placeholder="Шоколадный бисквит, вишнёвое конфи, мусс на белом шоколаде..."
              />
            </div>

            <div className="flex flex-wrap gap-6 pt-2 border-t">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.isAvailable}
                  onCheckedChange={(v) => set("isAvailable", v)}
                  id="spec-available"
                />
                <Label htmlFor="spec-available" className="text-sm cursor-pointer">
                  Доступен к заказу
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.customOrderAvailable}
                  onCheckedChange={(v) => set("customOrderAvailable", v)}
                  id="spec-custom"
                />
                <Label htmlFor="spec-custom" className="text-sm cursor-pointer">
                  Изготовление на заказ
                </Label>
              </div>
            </div>
          </TabsContent>

          {/* ==================== СОСТАВ ==================== */}
          <TabsContent value="composition" className="space-y-4 mt-3">
            <div>
              <Label>Ингредиенты</Label>
              <div className="flex gap-2">
                <Input
                  value={ingredientDraft}
                  onChange={(e) => setIngredientDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addIngredient(); } }}
                  placeholder="Мука пшеничная, введите и нажмите Enter"
                />
                <Button type="button" variant="outline" onClick={addIngredient}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {form.ingredients.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {form.ingredients.map((ing) => (
                    <Badge key={ing} variant="secondary" className="gap-1 pr-1">
                      {ing}
                      <button
                        type="button"
                        onClick={() => removeIngredient(ing)}
                        className="rounded-full hover:bg-destructive/20 p-0.5"
                        aria-label={`Удалить ${ing}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label>Аллергены</Label>
              <div className="flex flex-wrap gap-3 pt-1">
                {COMMON_ALLERGENS.map((a) => (
                  <div key={a} className="flex items-center gap-1.5">
                    <Switch
                      checked={form.allergens.includes(a)}
                      onCheckedChange={() => toggleAllergen(a)}
                      id={`allergen-${a}`}
                    />
                    <Label htmlFor={`allergen-${a}`} className="text-sm cursor-pointer">{a}</Label>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label>КБЖУ на 100 г</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-1">
                <div>
                  <Label className="text-xs text-muted-foreground">Калории, ккал</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.calories ?? ""}
                    onChange={(e) => set("calories", numOrNull(e.target.value))}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Белки, г</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    value={form.protein ?? ""}
                    onChange={(e) => set("protein", numOrNull(e.target.value))}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Жиры, г</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    value={form.fat ?? ""}
                    onChange={(e) => set("fat", numOrNull(e.target.value))}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Углеводы, г</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    value={form.carbs ?? ""}
                    onChange={(e) => set("carbs", numOrNull(e.target.value))}
                  />
                </div>
              </div>
            </div>

            <div>
              <Label>Условия хранения</Label>
              <Textarea
                value={form.storageConditions}
                onChange={(e) => set("storageConditions", e.target.value)}
                rows={2}
                placeholder="Хранить при температуре 2-6°C не более 48 часов"
              />
            </div>
            <div>
              <Label>Срок годности</Label>
              <Input
                value={form.shelfLife}
                onChange={(e) => set("shelfLife", e.target.value)}
                placeholder="48 часов с момента изготовления"
              />
            </div>
          </TabsContent>

          {/* ==================== МЕДИА ==================== */}
          <TabsContent value="media" className="mt-3">
            <ProductMediaManager
              productId={product.id}
              canModerate={canModerate}
              canSetCover={canSetCover}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2 border-t">
          <div className="flex-1 text-left">
            <span
              title={
                publishBlocked
                  ? `Заполните обязательные поля: ${missingRequired.join(", ")}`
                  : undefined
              }
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={publishing || publishBlocked}
                onClick={() => void togglePublish()}
              >
                {publishing ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : status === "published" ? (
                  <EyeOff className="h-4 w-4 mr-1" />
                ) : (
                  <Globe className="h-4 w-4 mr-1" />
                )}
                {status === "published" ? "Снять с публикации" : "Опубликовать"}
              </Button>
            </span>
            {publishBlocked && missingRequired.length > 0 && (
              <p className="text-[11px] text-amber-700 mt-1">
                Не хватает: {missingRequired.join(", ")}
              </p>
            )}
          </div>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =================== Create Product Dialog ===================

interface ConfectionerOption {
  id: string;
  userId: string | null;
  businessName: string;
  city?: string | null;
}

function CreateProductDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [confectionerId, setConfectionerId] = useState("");
  const [category, setCategory] = useState<string>("none");
  const [saving, setSaving] = useState(false);

  // Реальный список кондитеров (GET /api/confectioners)
  const confQuery = useQuery<ConfectionerOption[]>({
    queryKey: ["admin-confectioners-options"],
    queryFn: async () => {
      const res = await csrfFetch("/api/confectioners?verified_only=false&limit=100");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { confectioners?: ConfectionerOption[] };
      return data.confectioners || [];
    },
    staleTime: 60 * 1000,
  });

  const handleCreate = async () => {
    if (title.trim().length < 3) {
      toast.error("Укажите название товара", { description: "Минимум 3 символа" });
      return;
    }
    if (!description.trim()) {
      toast.error("Укажите описание товара");
      return;
    }
    const priceNum = Math.round(Number(price));
    if (!priceNum || priceNum < 1) {
      toast.error("Укажите корректную цену");
      return;
    }
    if (!confectionerId) {
      toast.error("Выберите кондитера");
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        confectionerId,
        title: title.trim(),
        description: description.trim(),
        price: priceNum,
        status: "draft",
      };
      if (category !== "none") body.category = category;

      const res = await csrfFetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 422) {
        const err = (await res.json().catch(() => null)) as
          | { error?: string; missing?: string[]; issues?: { formErrors?: string[] } }
          | null;
        toast.error("Товар не создан — проверьте поля", {
          description:
            (err?.missing && mapMissingToLabels(err.missing)) ||
            err?.issues?.formErrors?.[0] ||
            err?.error ||
            "Некоторые поля не прошли валидацию",
        });
        return;
      }
      if (res.status === 403) {
        toast.error("Недостаточно прав для создания товаров");
        return;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error || `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { product?: Record<string, unknown> };
      const row = data.product || {};

      // Добавляем товар в store с РЕАЛЬНЫМ id с сервера (не через addProduct —
      // он перегенерирует id, что сломало бы последующие PATCH и медиа-API)
      const newProduct: Product = {
        id: String(row.id || `tmp_${Date.now()}`),
        title: String(row.title || title),
        slug: String(row.slug || ""),
        description: String(row.description || description),
        price: Math.round(Number(row.price ?? priceNum)),
        category: (category !== "none" ? category : "cakes") as ProductCategory,
        images: [],
        confectionerId: confectionerId,
        confectionerName: confQuery.data?.find((c) => c.userId === confectionerId)?.businessName,
        rating: 0,
        reviewsCount: 0,
        isHidden: true, // черновик — скрыт до публикации
        hiddenReason: "Черновик (создан админом)",
        minOrderQty: 1,
        customOrderAvailable: true,
        isAvailable: true,
      };
      useAppStore.setState((state) => ({ products: [newProduct, ...state.products] }));

      toast.success("Товар создан", { description: `${newProduct.title} — черновик, опубликуйте из редактора` });
      onClose();
    } catch (e) {
      toast.error("Не удалось создать товар", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Создать товар</DialogTitle>
          <DialogDescription>
            Черновик от имени кондитера. Заполните карточку и опубликуйте через редактор.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Название</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Торт «Красный бархат»" />
          </div>
          <div>
            <Label>Описание</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Краткое описание товара..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Цена, ₽</Label>
              <Input type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <Label>Категория (опционально)</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Не выбрана" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не выбрана</SelectItem>
                  {PRODUCT_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Кондитер</Label>
            <Select value={confectionerId} onValueChange={setConfectionerId}>
              <SelectTrigger><SelectValue placeholder={confQuery.isLoading ? "Загружаем..." : "Выберите кондитера"} /></SelectTrigger>
              <SelectContent>
                {(confQuery.data || []).map((c) => (
                  <SelectItem key={c.id} value={c.userId || c.id}>
                    {c.businessName}{c.city ? ` — ${c.city}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {confQuery.isError && (
              <p className="text-xs text-destructive mt-1">
                Не удалось загрузить список кондитеров. <AlertCircle className="h-3 w-3 inline" />
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={() => void handleCreate()} disabled={saving || confQuery.isLoading}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
            Создать черновик
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =================== Product View Dialog ===================
function ProductViewDialog({
  product,
  onClose,
  onEdit,
}: {
  product: Product;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [activeImg, setActiveImg] = useState(0);
  const images = product.images || [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {product.title}
            {product.isPopular && <Badge className="bg-amber-500 text-white text-[10px]"><Star className="h-2.5 w-2.5 mr-0.5 fill-white" />Популярный</Badge>}
            {product.isHidden && <Badge className="bg-amber-700 text-white text-[10px]">Скрыт</Badge>}
          </DialogTitle>
          <DialogDescription>
            {product.confectionerName} • {product.category}
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Image carousel */}
          <div className="space-y-2">
            <div className="aspect-square rounded-lg overflow-hidden bg-muted">
              <img
                src={images[activeImg] || "/placeholder.svg"}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto">
                {images.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveImg(i)}
                    className={`w-16 h-16 rounded overflow-hidden border-2 shrink-0 ${
                      activeImg === i ? "border-primary" : "border-transparent"
                    }`}
                  >
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="space-y-3 text-sm">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-primary">{formatCurrency(product.price)}</span>
              {product.oldPrice && (
                <span className="text-sm text-muted-foreground line-through">{formatCurrency(product.oldPrice)}</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-muted-foreground">Вес:</span> {product.weight || "—"}</div>
              <div><span className="text-muted-foreground">Порций:</span> {product.servings || "—"}</div>
              <div><span className="text-muted-foreground">Срок:</span> {product.prepTime || "—"}</div>
              <div><span className="text-muted-foreground">Рейтинг:</span> {product.rating || "—"} ⭐ ({product.reviewsCount || 0})</div>
            </div>

            <div>
              <div className="text-xs font-semibold mb-1">Описание</div>
              <p className="text-sm text-muted-foreground">{product.description || "Описание отсутствует"}</p>
            </div>

            {product.tags && product.tags.length > 0 && (
              <div>
                <div className="text-xs font-semibold mb-1">Теги</div>
                <div className="flex flex-wrap gap-1">
                  {product.tags.map((t, i) => (
                    <Badge key={i} variant="secondary" className="text-[10px]">{t}</Badge>
                  ))}
                </div>
              </div>
            )}

            {product.isHidden && (
              <div className="p-2 rounded border border-amber-300 bg-amber-50 text-xs">
                <div className="font-semibold text-amber-800 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />Товар скрыт
                </div>
                <div className="text-amber-700 mt-1">Причина: {product.hiddenReason || "администратором"}</div>
                {product.hiddenAt && (
                  <div className="text-amber-600 text-[10px] mt-0.5">
                    {new Date(product.hiddenAt).toLocaleString("ru-RU")}
                  </div>
                )}
              </div>
            )}

            <Button onClick={onEdit} className="w-full">
              <Pencil className="h-4 w-4 mr-1" />Редактировать
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
