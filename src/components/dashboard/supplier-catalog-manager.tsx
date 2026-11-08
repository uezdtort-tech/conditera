"use client";

/**
 * SupplierCatalogManager — каталог продаж поставщика (Z-v17).
 *
 * Реальные операции через /api/supplier/warehouse (supplier_products):
 *  - создание товара (черновик);
 *  - редактирование полей; пополнение остатка (движение IN);
 *  - публикация/снятие с публикации/архивация;
 *  - видимость: физический остаток / резерв / доступно к заказу.
 * Публикация доступна только одобренным поставщикам (серверная проверка).
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { csrfFetch } from "@/lib/api-client";
import {
  Plus, Package, Eye, EyeOff, Archive, PackagePlus, Pencil, Boxes,
} from "lucide-react";

const UNIT_OPTIONS = [
  { value: "kg", label: "кг" },
  { value: "g", label: "г" },
  { value: "liter", label: "л" },
  { value: "ml", label: "мл" },
  { value: "piece", label: "шт" },
  { value: "box", label: "коробка" },
  { value: "pack", label: "упаковка" },
];

const CATEGORY_OPTIONS = [
  { value: "flour", label: "Мука и смеси" },
  { value: "sugar", label: "Сахар" },
  { value: "chocolate", label: "Шоколад и какао" },
  { value: "dairy", label: "Молочка" },
  { value: "eggs", label: "Яйца" },
  { value: "oils", label: "Масла и жиры" },
  { value: "nuts", label: "Орехи" },
  { value: "berries", label: "Ягоды и фрукты" },
  { value: "fillings", label: "Начинки" },
  { value: "colors", label: "Красители" },
  { value: "flavors", label: "Ароматизаторы" },
  { value: "decor", label: "Декор" },
  { value: "packaging", label: "Упаковка" },
  { value: "equipment", label: "Инвентарь" },
  { value: "other", label: "Другое" },
];

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft: { label: "Черновик", className: "bg-stone-100 text-stone-700" },
  published: { label: "Опубликовано", className: "bg-emerald-100 text-emerald-800" },
  archived: { label: "В архиве", className: "bg-red-100 text-red-700" },
};

interface Product {
  id: string;
  product_name: string;
  category: string | null;
  description: string | null;
  unit: string;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  price: number;
  min_order_qty: number;
  order_step: number;
  status: string;
  producer: string | null;
  brand: string | null;
}

const emptyForm = {
  productName: "", category: "chocolate", unit: "kg", price: 0, quantity: 0,
  minOrderQty: 1, orderStep: 1, description: "", producer: "", brand: "",
};

export function SupplierCatalogManager({ canPublish }: { canPublish: boolean }) {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [restockFor, setRestockFor] = useState<Product | null>(null);
  const [restockQty, setRestockQty] = useState("10");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await csrfFetch("/api/supplier/warehouse");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка загрузки");
      setItems(json.items ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveProduct = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        productName: form.productName,
        category: form.category,
        unit: form.unit,
        price: form.price,
        minOrderQty: form.minOrderQty,
        orderStep: form.orderStep,
        description: form.description,
        producer: form.producer,
        brand: form.brand,
      };
      if (editId) {
        const res = await csrfFetch("/api/supplier/warehouse", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editId, ...payload }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Ошибка сохранения");
        toast.success("Товар обновлён");
      } else {
        // Остаток задаётся только при создании (дальше — restock с журналом).
        (payload as Record<string, unknown>).quantity = form.quantity;
        const res = await csrfFetch("/api/supplier/warehouse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) {
          const details = Array.isArray(json.details) ? `\n${json.details.join("\n")}` : "";
          throw new Error((json.error || "Ошибка создания") + details);
        }
        toast.success("Товар создан (черновик). Опубликуйте его после проверки полей.");
      }
      setDialogOpen(false);
      setEditId(null);
      setForm(emptyForm);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const act = async (id: string, action: string) => {
    try {
      const res = await csrfFetch("/api/supplier/warehouse", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка действия");
      toast.success(
        action === "publish" ? "Товар опубликован в B2B-каталоге"
        : action === "unpublish" ? "Товар снят с публикации"
        : "Товар архивирован"
      );
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const restock = async () => {
    if (!restockFor) return;
    try {
      const res = await csrfFetch("/api/supplier/warehouse", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: restockFor.id,
          action: "restock",
          restockQuantity: Number(restockQty),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка пополнения");
      toast.success(`Остаток пополнен на ${restockQty}`);
      setRestockFor(null);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await csrfFetch(`/api/supplier/warehouse?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка удаления");
      toast.success("Товар удалён");
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const openEdit = (p: Product) => {
    setEditId(p.id);
    setForm({
      productName: p.product_name,
      category: p.category ?? "other",
      unit: p.unit,
      price: p.price,
      quantity: p.quantity,
      minOrderQty: p.min_order_qty,
      orderStep: p.order_step,
      description: p.description ?? "",
      producer: p.producer ?? "",
      brand: p.brand ?? "",
    });
    setDialogOpen(true);
  };

  if (loading) return <Card className="p-6 text-sm text-muted-foreground">Загружаем каталог…</Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Каталог и остатки</h2>
          <p className="text-xs text-muted-foreground">
            Товары, которые видят кондитеры в B2B-каталоге. Резерв — количество под активные закупочные заказы.
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditId(null); setForm(emptyForm); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Добавить товар
        </Button>
      </div>

      {!canPublish && (
        <Card className="p-3 text-sm bg-amber-50 border-amber-200 text-amber-900">
          Публикация товаров доступна после одобрения профиля администратором.
        </Card>
      )}

      {items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Товаров пока нет. Добавьте первый товар, чтобы кондитеры могли его заказать.
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((p) => {
            const badge = STATUS_BADGE[p.status] ?? STATUS_BADGE.draft;
            return (
              <Card key={p.id} className="p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm">{p.product_name}</span>
                      <Badge className={badge.className}>{badge.label}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {p.producer && <>Производитель: {p.producer} • </>}
                      Цена: <b>{(p.price / 100).toLocaleString("ru-RU")} ₽</b> / {unitLabel(p.unit)} •
                      Мин. партия: {p.min_order_qty} {unitLabel(p.unit)}
                      {p.order_step > 1 && <> • Шаг: {p.order_step}</>}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-2 text-xs">
                      <span className="flex items-center gap-1"><Boxes className="h-3.5 w-3.5 text-stone-500" />
                        Остаток: <b>{p.quantity}</b></span>
                      {p.reserved_quantity > 0 && (
                        <span className="text-amber-700">Резерв: <b>{p.reserved_quantity}</b></span>
                      )}
                      <span className="text-emerald-700">Доступно: <b>{p.available_quantity}</b></span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => { setRestockFor(p); setRestockQty("10"); }}>
                      <PackagePlus className="h-4 w-4" /> Пополнить
                    </Button>
                    {p.status !== "published" && (
                      <Button size="sm" onClick={() => act(p.id, "publish")} disabled={!canPublish}>
                        <Eye className="h-4 w-4" /> Опубликовать
                      </Button>
                    )}
                    {p.status === "published" && (
                      <Button size="sm" variant="outline" onClick={() => act(p.id, "unpublish")}>
                        <EyeOff className="h-4 w-4" /> Снять
                      </Button>
                    )}
                    {p.status !== "archived" && (
                      <Button size="sm" variant="ghost" onClick={() => act(p.id, "archive")}>
                        <Archive className="h-4 w-4" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Диалог создания/редактирования */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Редактирование товара" : "Новый товар"}</DialogTitle>
            <DialogDescription>
              {editId ? "Измените поля товара." : "Товар создаётся черновиком — опубликуйте его отдельно."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="pName">Название *</Label>
              <Input id="pName" value={form.productName}
                onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Категория</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Единица измерения</Label>
                <Select value={form.unit} onValueChange={(v) => setForm((f) => ({ ...f, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNIT_OPTIONS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pPrice">Цена за единицу, копейки *</Label>
                <Input id="pPrice" type="number" min={0} value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: Math.max(0, Number(e.target.value) || 0) }))} />
                <p className="text-[10px] text-muted-foreground">
                  {(form.price / 100).toLocaleString("ru-RU")} ₽ — хранится в копейках
                </p>
              </div>
              {!editId && (
                <div className="space-y-1">
                  <Label htmlFor="pQty">Начальный остаток</Label>
                  <Input id="pQty" type="number" min={0} value={form.quantity}
                    onChange={(e) => setForm((f) => ({ ...f, quantity: Math.max(0, Number(e.target.value) || 0) }))} />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="pMoq">Мин. партия</Label>
                <Input id="pMoq" type="number" min={1} value={form.minOrderQty}
                  onChange={(e) => setForm((f) => ({ ...f, minOrderQty: Math.max(1, Number(e.target.value) || 1) }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pStep">Кратность заказа</Label>
                <Input id="pStep" type="number" min={1} value={form.orderStep}
                  onChange={(e) => setForm((f) => ({ ...f, orderStep: Math.max(1, Number(e.target.value) || 1) }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pProducer">Производитель</Label>
                <Input id="pProducer" value={form.producer}
                  onChange={(e) => setForm((f) => ({ ...f, producer: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pBrand">Бренд</Label>
                <Input id="pBrand" value={form.brand}
                  onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pDesc">Описание</Label>
              <Textarea id="pDesc" rows={2} value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
              <Button onClick={saveProduct} disabled={saving || form.productName.trim().length < 2}>
                {saving ? "Сохраняем…" : "Сохранить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Диалог пополнения */}
      <Dialog open={!!restockFor} onOpenChange={(v) => !v && setRestockFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Пополнение остатка</DialogTitle>
            <DialogDescription>
              {restockFor?.product_name} — текущий остаток {restockFor?.quantity} {restockFor && unitLabel(restockFor.unit)}.
              Пополнение фиксируется в журнале движений.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="rQty">Количество</Label>
              <Input id="rQty" type="number" min={1} value={restockQty}
                onChange={(e) => setRestockQty(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRestockFor(null)}>Отмена</Button>
              <Button onClick={restock} disabled={!Number(restockQty) || Number(restockQty) < 1}>
                Пополнить
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function unitLabel(unit: string): string {
  return UNIT_OPTIONS.find((u) => u.value === unit)?.label ?? unit;
}
