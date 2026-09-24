"use client";

/**
 * SupplierProductsManager — CRUD товаров поставщика (ингредиенты, упаковка,
 * оборудование, инвентарь) через /api/supplier/products (таблица inventory_items).
 *
 * Операции: список (GET), создание (POST), редактирование (PATCH),
 * удаление (DELETE). Все мутации несут x-csrf-token (double-submit cookie).
 * Роль: SUPPLIER; ownership проверяется на сервере (confectioner_id === userId).
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Package, Pencil, Plus, Trash2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/finance";

const CATEGORIES = [
  { value: "ingredients", label: "Ингредиенты" },
  { value: "packaging", label: "Упаковка" },
  { value: "equipment", label: "Оборудование" },
  { value: "tools", label: "Инструменты" },
];

const UNITS = [
  { value: "kg", label: "кг" },
  { value: "g", label: "г" },
  { value: "l", label: "л" },
  { value: "ml", label: "мл" },
  { value: "pcs", label: "шт" },
  { value: "pack", label: "упаковка" },
  { value: "box", label: "коробка" },
];

interface SupplierProduct {
  id: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  min_quantity: number;
  cost_per_unit: number;
  expiry_date: string | null;
  storage_location: string | null;
  created_at: string;
}

interface FormState {
  name: string;
  category: string;
  unit: string;
  quantity: string;
  minQuantity: string;
  costPerUnit: string;
  expiryDate: string;
  storageLocation: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  category: "ingredients",
  unit: "kg",
  quantity: "0",
  minQuantity: "0",
  costPerUnit: "0",
  expiryDate: "",
  storageLocation: "",
};

async function getCsrfToken(): Promise<string> {
  const res = await fetch("/api/csrf-token");
  if (!res.ok) throw new Error("Не удалось получить CSRF-токен");
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("CSRF-токен не получен");
  return data.token;
}

function mutationHeaders(csrf: string): HeadersInit {
  return { "Content-Type": "application/json", "x-csrf-token": csrf };
}

export function SupplierProductsManager() {
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/supplier/products");
      const data = (await res.json()) as { products?: SupplierProduct[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      setProducts(data.products || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить товары");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (p: SupplierProduct) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      category: p.category || "ingredients",
      unit: p.unit || "kg",
      quantity: String(p.quantity ?? 0),
      minQuantity: String(p.min_quantity ?? 0),
      costPerUnit: String(p.cost_per_unit ?? 0),
      expiryDate: p.expiry_date ? p.expiry_date.slice(0, 10) : "",
      storageLocation: p.storage_location || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Укажите название товара");
      return;
    }
    setSaving(true);
    try {
      const csrf = await getCsrfToken();
      const payload = {
        ...(editingId ? { id: editingId } : {}),
        name: form.name.trim(),
        category: form.category,
        unit: form.unit,
        quantity: Number(form.quantity) || 0,
        minQuantity: Number(form.minQuantity) || 0,
        costPerUnit: Number(form.costPerUnit) || 0,
        expiryDate: form.expiryDate || null,
        storageLocation: form.storageLocation.trim() || null,
      };
      const res = await fetch("/api/supplier/products", {
        method: editingId ? "PATCH" : "POST",
        headers: mutationHeaders(csrf),
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string; requiresApproval?: boolean };
      if (!res.ok) {
        throw new Error(data.error || "Ошибка сохранения");
      }
      toast.success(editingId ? "Товар обновлён" : "Товар добавлен");
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Удалить товар «${name}»?`)) return;
    try {
      const csrf = await getCsrfToken();
      const res = await fetch(`/api/supplier/products?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: mutationHeaders(csrf),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Ошибка удаления");
      toast.success("Товар удалён");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const categoryLabel = (v: string) =>
    CATEGORIES.find((c) => c.value === v)?.label || v;
  const unitLabel = (v: string) => UNITS.find((u) => u.value === v)?.label || v;

  if (loading) {
    return (
      <Card className="p-12 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground mt-2">Загружаем товары…</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Товары ({products.length})</h1>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Добавить товар
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {products.map((p) => (
          <Card key={p.id} className="p-3 group relative">
            <div className="aspect-square rounded bg-muted mb-2 flex items-center justify-center">
              <Package className="h-10 w-10 text-muted-foreground/40" />
            </div>
            <div className="font-medium text-sm line-clamp-2 mb-1">{p.name}</div>
            <Badge variant="outline" className="text-[10px] mb-1">
              {categoryLabel(p.category)}
            </Badge>
            <div className="flex items-center justify-between mt-1">
              <span className="font-semibold text-sm">
                {formatCurrency(p.cost_per_unit)}
                <span className="text-[10px] text-muted-foreground font-normal">
                  {" "}
                  / {unitLabel(p.unit)}
                </span>
              </span>
              <span className="text-[10px] text-muted-foreground">
                {p.quantity > 0 ? `${p.quantity} ${unitLabel(p.unit)}` : "нет в наличии"}
              </span>
            </div>
            {p.quantity > 0 && p.min_quantity > 0 && p.quantity <= p.min_quantity && (
              <Badge className="text-[9px] mt-1 bg-amber-100 text-amber-800 border-amber-200">
                мало на складе
              </Badge>
            )}
            <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button size="sm" variant="outline" className="h-7 flex-1" onClick={() => openEdit(p)}>
                <Pencil className="h-3 w-3 mr-1" /> Изменить
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-destructive hover:text-destructive"
                onClick={() => handleDelete(p.id, p.name)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </Card>
        ))}
        {products.length === 0 && (
          <Card className="p-12 text-center col-span-full">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground mb-3">Товаров пока нет</p>
            <Button onClick={openCreate} variant="outline">
              <Plus className="h-4 w-4 mr-1" /> Добавить первый товар
            </Button>
          </Card>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Редактировать товар" : "Новый товар"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="sp-name">Название *</Label>
              <Input
                id="sp-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Мука пшеничная в/с"
                maxLength={200}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Категория</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Единица</Label>
                <Select value={form.unit} onValueChange={(v) => setForm((f) => ({ ...f, unit: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="sp-qty">Кол-во</Label>
                <Input
                  id="sp-qty"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sp-min">Мин. остаток</Label>
                <Input
                  id="sp-min"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.minQuantity}
                  onChange={(e) => setForm((f) => ({ ...f, minQuantity: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sp-cost">Цена, ₽</Label>
                <Input
                  id="sp-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.costPerUnit}
                  onChange={(e) => setForm((f) => ({ ...f, costPerUnit: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="sp-exp">Срок годности</Label>
                <Input
                  id="sp-exp"
                  type="date"
                  value={form.expiryDate}
                  onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sp-loc">Место хранения</Label>
                <Input
                  id="sp-loc"
                  value={form.storageLocation}
                  onChange={(e) => setForm((f) => ({ ...f, storageLocation: e.target.value }))}
                  placeholder="Склад А, стеллаж 3"
                  maxLength={200}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editingId ? "Сохранить" : "Добавить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
