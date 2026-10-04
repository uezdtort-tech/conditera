"use client";
/**
 * use-real-inventory.ts — живой склад из /api/inventory/* для кабинета кондитера.
 *
 * Заменяет MOCK-инвентарь store.inventory (zustand) реальным источником данных:
 *  - useRealInventory()        — GET  /api/inventory/items
 *  - useCreateInventoryItem()  — POST /api/inventory/items
 *  - useUpdateInventoryItem()  — PATCH /api/inventory/items
 *  - useDeleteInventoryItem()  — DELETE /api/inventory/items?id= (soft-delete)
 *  - useInventoryMovements()   — GET  /api/inventory/movements(?item_id=)
 *  - useCreateMovement()       — POST /api/inventory/movements (IN/OUT/ADJUST)
 *  - useWriteOffInventory()    — POST /api/inventory/write-off (списание по заказу)
 *
 * API отдаёт snake_case-строки БД (inventory_items/inventory_movements) —
 * здесь они мапятся в camelCase-модели UI. Колонок expiry_date/storage_location
 * в схеме НЕТ — поля не эмулируются. Ошибки сервера (напр. 409 «Недостаточно
 * на складе») всплывают в тост с сообщением бэкенда.
 */
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { getSessionAuthHeaders, getCsrfToken } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";

/** Сырая строка inventory_items из API (snake_case, как в БД) */
export interface ApiInventoryItem {
  id: string;
  owner_id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit: string | null;
  min_quantity: number;
  cost_per_unit: number;
  supplier: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Сырое движение из API (+item_name, обогащение сервера) */
export interface ApiInventoryMovement {
  id: string;
  item_id: string;
  item_name?: string | null;
  user_id?: string | null;
  type: "IN" | "OUT" | "ADJUST";
  quantity: number;
  reason?: string | null;
  order_id?: string | null;
  created_at: string;
}

/** UI-модель позиции склада (без выдуманных колонок) */
export interface RealInventoryItem {
  id: string;
  ownerId: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  minQuantity: number;
  costPerUnit: number;
  supplier: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** UI-модель движения склада */
export interface RealInventoryMovement {
  id: string;
  itemId: string;
  itemName: string;
  type: "IN" | "OUT" | "ADJUST";
  quantity: number;
  reason: string;
  orderId: string | null;
  createdAt: string;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

/** Адаптер snake_case API → UI-модель позиции */
export function mapApiItem(raw: ApiInventoryItem): RealInventoryItem {
  return {
    id: raw.id,
    ownerId: raw.owner_id,
    name: raw.name,
    category: raw.category || "",
    quantity: num(raw.quantity),
    unit: raw.unit || "шт",
    minQuantity: num(raw.min_quantity),
    costPerUnit: num(raw.cost_per_unit),
    supplier: raw.supplier || "",
    isActive: raw.is_active !== false,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/** Адаптер движения */
export function mapApiMovement(raw: ApiInventoryMovement): RealInventoryMovement {
  return {
    id: raw.id,
    itemId: raw.item_id,
    itemName: raw.item_name || "",
    type: raw.type,
    quantity: num(raw.quantity),
    reason: raw.reason || "",
    orderId: raw.order_id || null,
    createdAt: raw.created_at,
  };
}

async function fetchInventoryItems(): Promise<RealInventoryItem[]> {
  const headers = await getSessionAuthHeaders();
  const res = await fetch("/api/inventory/items", { headers, credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { items?: ApiInventoryItem[] };
  return (data.items || []).map(mapApiItem);
}

export interface RealInventoryResult {
  /** Реальные позиции (API доступен) */
  realItems: RealInventoryItem[] | null;
  /** Фолбэк из store (mock) — только если API не ответил */
  fallbackItems: RealInventoryItem[];
  /** Итоговый список для рендера: real ?? fallback */
  items: RealInventoryItem[];
  /** true → показан фолбэк (API недоступен), данные устаревшие */
  isStale: boolean;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

const mapStoreItemsToFallback = (storeInventory: unknown): RealInventoryItem[] => {
  // store-модель InventoryItem (camelCase, mock) → RealInventoryItem.
  // expiryDate/storageLocation в БД нет — при фолбэке тоже не показываем их.
  const list = Array.isArray(storeInventory) ? storeInventory : [];
  return list.map((i) => {
    const item = i as {
      id: string;
      confectionerId?: string;
      name: string;
      category?: string;
      quantity: number;
      unit?: string;
      minQuantity?: number;
      costPerUnit?: number;
      supplierName?: string;
      createdAt?: string;
      updatedAt?: string;
    };
    return {
      id: item.id,
      ownerId: item.confectionerId || "",
      name: item.name,
      category: item.category || "",
      quantity: num(item.quantity),
      unit: item.unit || "шт",
      minQuantity: num(item.minQuantity),
      costPerUnit: num(item.costPerUnit),
      supplier: item.supplierName || "",
      isActive: true,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
    };
  });
};

/** Живой склад; при сбое API — фолбэк на store (mock, помечен stale) */
export function useRealInventory(options?: { fallback?: boolean }): RealInventoryResult {
  const storeInventory = useAppStore((s) => s.inventory);
  const user = useAppStore((s) => s.user);

  const query = useQuery<RealInventoryItem[], Error>({
    queryKey: ["inventory-real", user?.id ?? null],
    queryFn: fetchInventoryItems,
    staleTime: 30_000,
    retry: 1,
    enabled: !!user,
  });

  const fallbackItems = options?.fallback === false ? [] : mapStoreItemsToFallback(storeInventory);
  const realItems = query.data ?? null;
  const failed = !!query.error;

  return {
    realItems,
    fallbackItems,
    items: realItems ?? fallbackItems,
    isStale: failed,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

/** Создание позиции: POST /api/inventory/items */
export function useCreateInventoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      category?: string;
      quantity?: number;
      unit?: string;
      minQuantity?: number;
      costPerUnit?: number;
      supplier?: string;
    }) => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch("/api/inventory/items", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          name: input.name,
          category: input.category || null,
          quantity: input.quantity ?? 0,
          unit: input.unit || "шт",
          min_quantity: input.minQuantity ?? 0,
          cost_per_unit: input.costPerUnit ?? 0,
          supplier: input.supplier || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ item: ApiInventoryItem }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-real"] });
      toast.success("Позиция добавлена на склад");
    },
    onError: (error: Error) => {
      toast.error("Не удалось добавить позицию", { description: error.message });
    },
  });
}

/** Обновление позиции: PATCH /api/inventory/items (whitelist-поля) */
export function useUpdateInventoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      category?: string;
      quantity?: number;
      unit?: string;
      minQuantity?: number;
      costPerUnit?: number;
      supplier?: string;
      isActive?: boolean;
    }) => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch("/api/inventory/items", {
        method: "PATCH",
        headers,
        credentials: "include",
        body: JSON.stringify({
          id: input.id,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
          ...(input.unit !== undefined ? { unit: input.unit } : {}),
          ...(input.minQuantity !== undefined ? { min_quantity: input.minQuantity } : {}),
          ...(input.costPerUnit !== undefined ? { cost_per_unit: input.costPerUnit } : {}),
          ...(input.supplier !== undefined ? { supplier: input.supplier } : {}),
          ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ item: ApiInventoryItem }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-real"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-movements-real"] });
      toast.success("Позиция обновлена");
    },
    onError: (error: Error) => {
      toast.error("Не удалось обновить позицию", { description: error.message });
    },
  });
}

/** Soft-delete позиции: DELETE /api/inventory/items?id= */
export function useDeleteInventoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch(`/api/inventory/items?id=${encodeURIComponent(itemId)}`, {
        method: "DELETE",
        headers,
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ success: boolean }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-real"] });
      toast.success("Позиция удалена со склада");
    },
    onError: (error: Error) => {
      toast.error("Не удалось удалить позицию", { description: error.message });
    },
  });
}

/** Журнал движений: GET /api/inventory/movements(?item_id=) */
export function useInventoryMovements(itemId?: string | null) {
  const user = useAppStore((s) => s.user);
  return useQuery<RealInventoryMovement[], Error>({
    queryKey: ["inventory-movements-real", itemId ?? "all", user?.id ?? null],
    queryFn: async () => {
      const headers = await getSessionAuthHeaders();
      const url = itemId
        ? `/api/inventory/movements?item_id=${encodeURIComponent(itemId)}`
        : "/api/inventory/movements";
      const res = await fetch(url, { headers, credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { movements?: ApiInventoryMovement[] };
      return (data.movements || []).map(mapApiMovement);
    },
    enabled: !!user,
    staleTime: 15_000,
    retry: 1,
  });
}

/** Одиночное движение: POST /api/inventory/movements */
export function useCreateMovement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      itemId: string;
      type: "IN" | "OUT" | "ADJUST";
      quantity: number;
      reason?: string;
      orderId?: string;
    }) => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch("/api/inventory/movements", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          item_id: input.itemId,
          type: input.type,
          quantity: input.quantity,
          reason: input.reason || null,
          order_id: input.orderId || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ movement: ApiInventoryMovement; item: ApiInventoryItem }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-real"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-movements-real"] });
      toast.success("Движение по складу записано");
    },
    onError: (error: Error) => {
      toast.error("Не удалось записать движение", { description: error.message });
    },
  });
}

/** Списание набора позиций по заказу: POST /api/inventory/write-off */
export function useWriteOffInventory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      orderId?: string;
      items: Array<{ itemId: string; quantity: number }>;
      reason?: string;
    }) => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch("/api/inventory/write-off", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          order_id: input.orderId || null,
          items: input.items.map((it) => ({ item_id: it.itemId, quantity: it.quantity })),
          reason: input.reason || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<{
        applied: Array<{ item_id: string; item_name: string; remaining: number; unit: string | null }>;
        failed: Array<{ item_id: string; error: string }>;
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["inventory-real"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-movements-real"] });
      toast.success(`Списано позиций: ${data.applied.length}`, {
        description: data.failed.length
          ? `Не удалось списать: ${data.failed.length}`
          : undefined,
      });
    },
    onError: (error: Error) => {
      toast.error("Списание не выполнено", { description: error.message });
    },
  });
}
