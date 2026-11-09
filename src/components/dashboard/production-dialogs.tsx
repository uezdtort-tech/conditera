"use client";

/**
 * production-dialogs.tsx — диалоговые окна производственного контура кондитера
 * (RECIPE-05 / RA.11). Хелпер для ConfectionerProductionTab, сам нигде не монтируется.
 *
 * Контракты (живые API, сервер считает все количества/цены — клиент не придумывает):
 *  • POST/PATCH /api/production/cards — карта + нормы (полная замена норм в PATCH);
 *  • POST /api/production/batches — партия от card_version_id утверждённой карты;
 *  • GET /api/production/batches/[id] — expected_qty (серверный prefill) + write_off;
 *  • POST /api/inventory/write-off (batch-режим) — списание партии, ошибки сервера
 *    (409 «недостаточно остатка», 422 «допуск 5%») показываются ДОСЛОВНО в Alert.
 *
 * Все мутации — через csrfFetch (auto-CSRF double-submit).
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";

import { csrfFetch } from "@/lib/api-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

// ============================================================================
// Типы ответов API (snake_case, как отдаёт сервер)
// ============================================================================

export type CardStatus = "draft" | "approved" | "archived";
export type BatchStatus = "planned" | "in_progress" | "completed" | "cancelled";
export type CanonicalUnit = "г" | "мл" | "шт";

/** Норма карты (serializeIngredient, src/lib/recipes/production.ts) */
export interface SerializedNorm {
  id: string;
  card_id: string;
  source_ingredient_id: string | null;
  inventory_item_id: string | null;
  qty_per_unit: number;
  qty_per_batch: number | null;
  unit: string;
  brutto_qty: number | null;
  waste_pct: number;
  is_optional: boolean;
}

/** Производственная карта (serializeCard; ingredients — только свои карты) */
export interface SerializedCard {
  id: string;
  owner_id: string;
  recipe_id: string;
  recipe_version_id: string | null;
  product_id: string | null;
  title: string;
  status: CardStatus;
  approved_by: string | null;
  approved_at: string | null;
  batch_yield_qty: number | null;
  batch_yield_unit: string | null;
  portions_per_batch: number | null;
  created_at: string;
  updated_at: string;
  latest_version_no: number | null;
  latest_card_version_id: string | null;
  is_owner: boolean;
  ingredients?: SerializedNorm[];
}

/** Партия (serializeBatch) */
export interface SerializedBatch {
  id: string;
  card_version_id: string;
  owner_id: string;
  order_id: string | null;
  planned_qty: number;
  planned_unit: string;
  status: BatchStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Ожидаемое списание (GET /api/production/batches/[id]; expected_qty считает СЕРВЕР) */
export interface ExpectedItem {
  item_id: string;
  name: string;
  unit: string;
  qty_per_unit: number;
  waste_pct: number;
  is_optional: boolean;
  expected_qty: number;
}

/** Детали партии для диалога списания */
export interface BatchDetail {
  batch: SerializedBatch;
  card_version: { id: string; version_no: number; card_id: string };
  expected_items: ExpectedItem[];
  write_off: { id: string; created_at: string } | null;
}

/** Ответ POST /api/production/cards/[id]/approve (201 новая версия | 200 идемпотентный replay) */
export interface ApproveResponse {
  idempotent: boolean;
  cardVersionNo: number;
  cardVersionId?: string;
  cost?: {
    cost_per_unit_rub: number;
    cost_per_batch_rub: number;
    price_basis?: string;
    computed_at?: string;
    breakdown?: unknown;
  } | null;
  message?: string;
}

/** Позиция склада — подмножество GET /api/inventory/items для редактора норм */
export interface InventoryItemLite {
  id: string;
  name: string;
  unit: string;
  quantity: number;
}

/** Рецепт — подмножество GET /api/recipes?scope=mine */
export interface RecipeLite {
  id: string;
  title: string;
}

// ============================================================================
// Хелперы
// ============================================================================

const UNITS: CanonicalUnit[] = ["г", "мл", "шт"];
const MAX_NORMS = 200; // сервер: parseCardNormsInput

let rowSeq = 0;
function nextRowKey(): string {
  rowSeq += 1;
  return `norm-row-${rowSeq}`;
}

/** "1,5" → 1.5; невалидное/пустое → null (инпут — строка) */
function toNumber(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

async function parseJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Единый разбор ошибочного ответа: текст сервера показывается как есть */
async function apiError(res: Response): Promise<string> {
  const json = await parseJson<{ error?: string }>(res);
  return json?.error || `HTTP ${res.status}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ============================================================================
// CardFormDialog — «Создать карту» / «Редактировать нормы» (черновик)
// PATCH отправляет ПОЛНУЮ замену норм (norms[]) + поля выхода партии.
// ============================================================================

interface NormRowState {
  key: string;
  inventory_item_id: string; // "" — не привязано (разрешено в draft)
  qty_per_unit: string;
  unit: string;
  waste_pct: string;
  is_optional: boolean;
}

function emptyNormRow(): NormRowState {
  return { key: nextRowKey(), inventory_item_id: "", qty_per_unit: "", unit: "шт", waste_pct: "0", is_optional: false };
}

interface CardFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** create → POST /api/production/cards; edit → PATCH /api/production/cards/[id] */
  mode: "create" | "edit";
  /** Карта для режима edit (черновик — контент правится только в draft, RB.15) */
  card?: SerializedCard | null;
  recipes: RecipeLite[];
  inventoryItems: InventoryItemLite[];
  recipesLoading: boolean;
  /** Успешное сохранение → родитель инвалидирует ["production-cards"] */
  onSaved: () => void;
}

export function CardFormDialog({
  open,
  onOpenChange,
  mode,
  card,
  recipes,
  inventoryItems,
  recipesLoading,
  onSaved,
}: CardFormDialogProps) {
  const [recipeId, setRecipeId] = useState("");
  const [title, setTitle] = useState("");
  const [yieldQty, setYieldQty] = useState("");
  const [yieldUnit, setYieldUnit] = useState("");
  const [portions, setPortions] = useState("");
  const [rows, setRows] = useState<NormRowState[]>([emptyNormRow()]);
  const [error, setError] = useState<string | null>(null);

  const itemById = useMemo(
    () => new Map(inventoryItems.map((i) => [i.id, i])),
    [inventoryItems]
  );

  // Инициализация при открытии (create — пустая форма, edit — данные карты).
  // card?.id в deps: не ре-инициализируем при рефetchе списка, пока открыт диалог.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === "edit" && card) {
      setTitle(card.title);
      setYieldQty(card.batch_yield_qty !== null ? String(card.batch_yield_qty) : "");
      setYieldUnit(card.batch_yield_unit ?? "");
      setPortions(card.portions_per_batch !== null ? String(card.portions_per_batch) : "");
      const ing = card.ingredients ?? [];
      setRows(
        ing.length > 0
          ? ing.map((n) => ({
              key: nextRowKey(),
              inventory_item_id: n.inventory_item_id ?? "",
              qty_per_unit: String(n.qty_per_unit),
              unit: n.unit,
              waste_pct: String(n.waste_pct),
              is_optional: n.is_optional,
            }))
          : [emptyNormRow()]
      );
    } else {
      setTitle("");
      setYieldQty("");
      setYieldUnit("");
      setPortions("");
      setRows([emptyNormRow()]);
    }
  }, [open, mode, card?.id]);

  const updateRow = (key: string, patch: Partial<NormRowState>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const validate = (): string | null => {
    if (mode === "create" && !recipeId) return "Выберите рецепт для производственной карты";
    const t = title.trim();
    if (t.length < 1 || t.length > 200) return "Название обязательно (1..200 символов)";
    if (rows.length === 0) return "Добавьте хотя бы одну норму сырья";
    for (const row of rows) {
      const qty = toNumber(row.qty_per_unit);
      if (qty === null || qty <= 0) return "Количество на единицу должно быть числом > 0 в каждой норме";
      if (!row.unit.trim()) return "Укажите единицу измерения в каждой норме";
      const waste = toNumber(row.waste_pct);
      if (waste !== null && (waste < 0 || waste > 100)) return "Потери (waste_pct) — число 0..100";
    }
    if (yieldQty.trim()) {
      const y = toNumber(yieldQty);
      if (y === null || y <= 0) return "Выход партии должен быть числом > 0";
    }
    if (portions.trim()) {
      const p = Number(portions.trim().replace(",", "."));
      if (!Number.isInteger(p) || p < 0) return "Порций за партию — целое число ≥ 0";
    }
    return null;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const vErr = validate();
      if (vErr) throw new Error(vErr);

      const norms = rows.map((row) => ({
        qty_per_unit: toNumber(row.qty_per_unit) as number,
        unit: row.unit.trim() || "шт",
        waste_pct: toNumber(row.waste_pct) ?? 0,
        is_optional: row.is_optional,
        ...(row.inventory_item_id ? { inventory_item_id: row.inventory_item_id } : {}),
      }));

      const yq = toNumber(yieldQty);
      const yqValid = yq !== null && yq > 0 ? yq : null;
      const pRaw = portions.trim() ? Number(portions.trim().replace(",", ".")) : null;
      const portionsValid = pRaw !== null && Number.isInteger(pRaw) && pRaw >= 0 ? pRaw : null;

      const url =
        mode === "create"
          ? "/api/production/cards"
          : `/api/production/cards/${(card as SerializedCard).id}`;
      const body: Record<string, unknown> =
        mode === "create"
          ? {
              recipe_id: recipeId,
              title: title.trim(),
              norms,
              ...(yqValid !== null ? { batch_yield_qty: yqValid } : {}),
              ...(yieldUnit ? { batch_yield_unit: yieldUnit } : {}),
              ...(portionsValid !== null ? { portions_per_batch: portionsValid } : {}),
            }
          : // PATCH: полная замена перечисленных полей (null — очистить), нормы — REPLACE
            {
              title: title.trim(),
              batch_yield_qty: yqValid,
              batch_yield_unit: yieldUnit || null,
              portions_per_batch: portionsValid,
              norms,
            };

      const res = await csrfFetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await apiError(res));
    },
    onSuccess: () => {
      toast.success(
        mode === "create" ? "Производственная карта создана (черновик)" : "Карта обновлена — нормы заменены"
      );
      onSaved();
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  const busy = saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Создать производственную карту" : "Редактировать карту"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Карта создаётся черновиком: нормы сырья на единицу продукта. Все расчёты выполняет сервер."
              : "Правка доступна только в черновике. Нормы сохраняются полной заменой; утверждённые версии не переписываются."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Ошибка</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          {mode === "create" && (
            <div className="space-y-2">
              <Label htmlFor="prod-card-recipe">Рецепт *</Label>
              <Select
                value={recipeId || undefined}
                onValueChange={(v) => setRecipeId(v)}
                disabled={recipesLoading}
              >
                <SelectTrigger id="prod-card-recipe" className="h-11 w-full">
                  <SelectValue placeholder={recipesLoading ? "Загрузка рецептов…" : "Выберите рецепт"} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {recipes.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="prod-card-title">Название карты *</Label>
            <Input
              id="prod-card-title"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Торт «Прага» — производственная карта"
              className="h-11"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="prod-card-yield">Выход партии</Label>
              <Input
                id="prod-card-yield"
                type="number"
                min="0"
                step="0.001"
                value={yieldQty}
                onChange={(e) => setYieldQty(e.target.value)}
                placeholder="напр. 1200"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label>Единица выхода</Label>
              <Select
                value={yieldUnit || "none"}
                onValueChange={(v) => setYieldUnit(v === "none" ? "" : v)}
              >
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="— не задана —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— не задана —</SelectItem>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-card-portions">Порций за партию</Label>
              <Input
                id="prod-card-portions"
                type="number"
                min="0"
                step="1"
                value={portions}
                onChange={(e) => setPortions(e.target.value)}
                placeholder="напр. 12"
                className="h-11"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Нормы сырья (на единицу продукта) *</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11"
                onClick={() => setRows((prev) => [...prev, emptyNormRow()])}
                disabled={busy || rows.length >= MAX_NORMS}
              >
                <Plus className="h-4 w-4" /> Добавить норму
              </Button>
            </div>

            <div className="space-y-3">
              {rows.map((row, idx) => (
                <div key={row.key} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Норма {idx + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 text-destructive"
                      onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                      disabled={busy || rows.length <= 1}
                      aria-label="Удалить норму"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <Select
                    value={row.inventory_item_id || "none"}
                    onValueChange={(v) => {
                      if (v === "none") {
                        updateRow(row.key, { inventory_item_id: "" });
                        return;
                      }
                      const item = itemById.get(v);
                      updateRow(row.key, {
                        inventory_item_id: v,
                        // единица префиллится со складской позиции (можно править)
                        unit: item?.unit || row.unit,
                      });
                    }}
                  >
                    <SelectTrigger className="h-11 w-full">
                      <SelectValue placeholder="Складская позиция" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="none">— не привязано к складу —</SelectItem>
                      {inventoryItems.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} · {item.unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="space-y-1">
                      <Label htmlFor={`qty-${row.key}`} className="text-xs">
                        Кол-во / ед. *
                      </Label>
                      <Input
                        id={`qty-${row.key}`}
                        type="number"
                        min="0"
                        step="0.001"
                        value={row.qty_per_unit}
                        onChange={(e) => updateRow(row.key, { qty_per_unit: e.target.value })}
                        placeholder="напр. 200"
                        className="h-11"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`unit-${row.key}`} className="text-xs">
                        Ед. *
                      </Label>
                      <Input
                        id={`unit-${row.key}`}
                        value={row.unit}
                        maxLength={50}
                        onChange={(e) => updateRow(row.key, { unit: e.target.value })}
                        className="h-11"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`waste-${row.key}`} className="text-xs">
                        Потери, %
                      </Label>
                      <Input
                        id={`waste-${row.key}`}
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={row.waste_pct}
                        onChange={(e) => updateRow(row.key, { waste_pct: e.target.value })}
                        className="h-11"
                      />
                    </div>
                    <label
                      htmlFor={`opt-${row.key}`}
                      className="flex h-11 cursor-pointer items-center gap-2 self-end text-sm"
                    >
                      <Checkbox
                        id={`opt-${row.key}`}
                        checked={row.is_optional}
                        onCheckedChange={(checked) =>
                          updateRow(row.key, { is_optional: checked === true })
                        }
                      />
                      Опционально
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Утверждение требует привязки всех норм к позициям вашего склада. Опциональные нормы
              можно не списывать. Максимум норм: {MAX_NORMS}.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button type="button" className="h-11" onClick={() => saveMutation.mutate()} disabled={busy}>
            {busy ? "Сохранение…" : mode === "create" ? "Создать карту" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// CreateBatchDialog — «Создать партию» от утверждённой версии карты
// ============================================================================

interface CreateBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Только утверждённые карты с latest_card_version_id */
  approvedCards: SerializedCard[];
  /** Предвыбор карты (кнопка «Создать партию» в строке карты) */
  initialCardId?: string | null;
  /** Успех → родитель инвалидирует ["production-batches"] */
  onCreated: () => void;
}

export function CreateBatchDialog({
  open,
  onOpenChange,
  approvedCards,
  initialCardId,
  onCreated,
}: CreateBatchDialogProps) {
  const [cardId, setCardId] = useState("");
  const [plannedQty, setPlannedQty] = useState("");
  const [plannedUnit, setPlannedUnit] = useState<CanonicalUnit>("г");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPlannedQty("");
    setPlannedUnit("г");
    setNotes("");
    setCardId(initialCardId ?? approvedCards[0]?.id ?? "");
  }, [open, initialCardId]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!cardId) throw new Error("Выберите утверждённую карту");
      const qty = toNumber(plannedQty);
      if (qty === null || qty <= 0) throw new Error("Планируемый объём должен быть числом > 0");
      const card = approvedCards.find((c) => c.id === cardId);
      if (!card?.latest_card_version_id) {
        throw new Error("У карты нет утверждённой версии — сначала утвердите карту");
      }
      const res = await csrfFetch("/api/production/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card_version_id: card.latest_card_version_id,
          planned_qty: qty,
          planned_unit: plannedUnit,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error(await apiError(res));
      const json = await parseJson<{ batch?: { id: string } }>(res);
      return json?.batch?.id ?? null;
    },
    onSuccess: (batchId) => {
      toast.success(`Партия создана${batchId ? ` (${batchId.slice(0, 8)}…)` : ""}`, {
        description: "Статус: запланирована. Начните работу и выполните списание сырья.",
      });
      onCreated();
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  const busy = createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Создать партию</DialogTitle>
          <DialogDescription>
            Партия создаётся от утверждённой версии карты (card_version). Списание сырьёв будет
            сверяться с нормами этой версии (допуск 5%).
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Ошибка</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {approvedCards.length === 0 ? (
          <Alert>
            <AlertTitle>Нет утверждённых карт</AlertTitle>
            <AlertDescription>
              Партия создаётся от утверждённой версии карты. Сначала создайте и утвердите
              производственную карту.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Утверждённая карта *</Label>
              <Select value={cardId || undefined} onValueChange={(v) => setCardId(v)}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Выберите карту" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {approvedCards.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                      {c.latest_version_no !== null ? ` · версия №${c.latest_version_no}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="batch-qty">Планируемый объём *</Label>
                <Input
                  id="batch-qty"
                  type="number"
                  min="0"
                  step="0.001"
                  value={plannedQty}
                  onChange={(e) => setPlannedQty(e.target.value)}
                  placeholder="напр. 3"
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label>Единица *</Label>
                <Select
                  value={plannedUnit}
                  onValueChange={(v) => setPlannedUnit(v as CanonicalUnit)}
                >
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="batch-notes">Заметки</Label>
              <Textarea
                id="batch-notes"
                value={notes}
                maxLength={2000}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Например: партия к заказу №…, дегустация"
                className="min-h-20"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button
            type="button"
            className="h-11"
            onClick={() => createMutation.mutate()}
            disabled={busy || approvedCards.length === 0}
          >
            {busy ? "Создание…" : "Создать партию"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// WriteOffDialog — списание сырья по партии (batch-режим write-off)
// Prefill количеств — серверный expected_qty; ошибки сервера — дословно в Alert.
// ============================================================================

interface WriteOffDeviation {
  item_id: string;
  expected: number;
  got: number;
  unit: string;
}

interface WriteOffDialogProps {
  batchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Успех → родитель инвалидирует партии/детали/склад и помечает «списание: есть» */
  onWrittenOff: (batchId: string) => void;
}

export function WriteOffDialog({ batchId, open, onOpenChange, onWrittenOff }: WriteOffDialogProps) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [deviations, setDeviations] = useState<WriteOffDeviation[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Детали партии (серверный prefill expected_qty + честное состояние списания).
  // staleTime: 0 — при каждом открытии получаем свежее состояние write_off.
  const { data: detail, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: ["production-batch-detail", batchId],
    queryFn: async (): Promise<BatchDetail> => {
      const res = await csrfFetch(`/api/production/batches/${batchId as string}`);
      if (!res.ok) throw new Error(await apiError(res));
      const json = await parseJson<BatchDetail>(res);
      if (!json?.batch) throw new Error("Не удалось загрузить партию");
      return json;
    },
    enabled: open && !!batchId,
    staleTime: 0,
    retry: 1,
  });

  // Prefill редактируемых количеств СЕРВЕРНЫМИ значениями expected_qty
  useEffect(() => {
    if (!open || !detail) return;
    const next: Record<string, string> = {};
    for (const it of detail.expected_items) next[it.item_id] = String(it.expected_qty);
    setQuantities(next);
    setError(null);
    setDeviations([]);
  }, [open, detail]);

  const expectedItems = detail?.expected_items ?? [];
  const nameById = useMemo(
    () => new Map(expectedItems.map((i) => [i.item_id, i.name])),
    [expectedItems]
  );

  const parsedRows = expectedItems.map((it) => ({
    item_id: it.item_id,
    unit: it.unit,
    is_optional: it.is_optional,
    quantity: toNumber(quantities[it.item_id] ?? ""),
  }));
  const rowsToSend = parsedRows.filter(
    (r): r is { item_id: string; unit: string; is_optional: boolean; quantity: number } =>
      r.quantity !== null && r.quantity > 0
  );
  const missingRequired = parsedRows.some((r) => !r.is_optional && !(r.quantity !== null && r.quantity > 0));

  const submit = async () => {
    if (!batchId || !detail) return;
    if (rowsToSend.length === 0) {
      setError("Укажите количество хотя бы для одной позиции");
      return;
    }
    setSubmitting(true);
    setError(null);
    setDeviations([]);
    try {
      const res = await csrfFetch("/api/inventory/write-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_id: batchId,
          items: rowsToSend.map((r) => ({ item_id: r.item_id, quantity: r.quantity, unit: r.unit })),
        }),
      });
      if (!res.ok) {
        const json = await parseJson<{ error?: string; deviations?: WriteOffDeviation[] }>(res);
        setError(json?.error || `HTTP ${res.status}`);
        setDeviations(json?.deviations ?? []);
        return;
      }
      const json = await parseJson<{
        batch_id: string;
        applied?: Array<{ item_id: string }>;
        write_off_id?: string | null;
        idempotent?: boolean;
        message?: string;
      }>(res);
      toast.success(`Списано позиций: ${json?.applied?.length ?? 0}`, {
        description: json?.idempotent && json.message ? json.message : undefined,
      });
      onWrittenOff(batchId);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выполнить списание");
    } finally {
      setSubmitting(false);
    }
  };

  const alreadyWritten = !!detail?.write_off;
  const noNorms = !isLoading && !!detail && expectedItems.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Списание сырья по партии</DialogTitle>
          <DialogDescription>
            {detail ? (
              <>
                Партия {detail.batch.id.slice(0, 8)}… · объём {detail.batch.planned_qty}{" "}
                {detail.batch.planned_unit} · версия карты №{detail.card_version.version_no}.
                Ожидания рассчитаны сервером из снапшота норм; допуск расхождения — 5%.
              </>
            ) : (
              "Загрузка ожидаемых списаний…"
            )}
          </DialogDescription>
        </DialogHeader>

        {isError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Не удалось загрузить партию</AlertTitle>
            <AlertDescription>
              {loadError instanceof Error ? loadError.message : "Ошибка сервера"}
              <div className="mt-2">
                <Button type="button" variant="outline" size="sm" className="h-11" onClick={() => void refetch()}>
                  Повторить
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Ошибка списания</AlertTitle>
            <AlertDescription>
              <span>{error}</span>
              {deviations.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs">
                  {deviations.map((d) => (
                    <li key={d.item_id}>
                      {nameById.get(d.item_id) ?? d.item_id.slice(0, 8)}: ожидалось {d.expected} {d.unit},
                      получено {d.got} {d.unit}
                    </li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}

        {alreadyWritten && (
          <Alert>
            <AlertTitle>Партия уже списана</AlertTitle>
            <AlertDescription>
              Списание выполнено {detail?.write_off ? fmtDate(detail.write_off.created_at) : ""}.
              Повторное списание запрещено (один batch_id — одно списание).
            </AlertDescription>
          </Alert>
        )}

        {noNorms && (
          <Alert>
            <AlertTitle>Нет норм в снапшоте версии</AlertTitle>
            <AlertDescription>
              В утверждённой версии карты нет привязанных к складу норм — списание невозможно.
            </AlertDescription>
          </Alert>
        )}

        {expectedItems.length > 0 && (
          <div className="max-h-72 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Позиция склада</TableHead>
                  <TableHead className="text-right">Норма/ед.</TableHead>
                  <TableHead className="text-right">Потери</TableHead>
                  <TableHead className="text-right">Ожидается</TableHead>
                  <TableHead className="w-28 text-right">
                    {alreadyWritten ? "Списано" : "Количество"}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expectedItems.map((it) => (
                  <TableRow key={it.item_id}>
                    <TableCell>
                      <div className="font-medium">{it.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {it.unit}
                        {it.is_optional ? " · опционально" : ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {it.qty_per_unit} {it.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{it.waste_pct}%</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {it.expected_qty} {it.unit}
                    </TableCell>
                    <TableCell>
                      {alreadyWritten ? (
                        <div className="text-right text-sm tabular-nums">
                          {quantities[it.item_id] ?? String(it.expected_qty)} {it.unit}
                        </div>
                      ) : (
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          aria-label={`Количество списания: ${it.name}`}
                          value={quantities[it.item_id] ?? ""}
                          onChange={(e) =>
                            setQuantities((prev) => ({ ...prev, [it.item_id]: e.target.value }))
                          }
                          className="h-11 text-right"
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!alreadyWritten && !noNorms && expectedItems.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Количества предзаполнены серверным расчётом (норма × объём партии × потери). Опциональные
            позиции можно обнулить. Расхождение сверх допуска 5% сервер отклонит с полным откатом.
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={submitting}>
            {alreadyWritten ? "Закрыть" : "Отмена"}
          </Button>
          {!alreadyWritten && expectedItems.length > 0 && (
            <Button
              type="button"
              className="h-11"
              onClick={() => void submit()}
              disabled={submitting || isLoading || rowsToSend.length === 0 || missingRequired}
              title={missingRequired ? "Все обязательные (не опциональные) позиции должны быть заполнены" : undefined}
            >
              {submitting ? "Списание…" : "Списать со склада"}
            </Button>
          )}
        </DialogFooter>

        {!alreadyWritten && missingRequired && expectedItems.length > 0 && (
          <p className="text-xs text-amber-700">
            Все обязательные (не опциональные) позиции должны иметь количество больше нуля — сервер
            не примет частичный комплект обязательных норм.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
