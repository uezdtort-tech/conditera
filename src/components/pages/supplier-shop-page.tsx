"use client";

/**
 * SupplierShopPage — B2B-маркетплейс закупок для кондитера (Z-v17).
 *
 * Реальные данные (без mock): /api/suppliers + /api/b2b/catalog — только
 * одобренные поставщики и опубликованные товары (видимость на сервере).
 * Корзина закупки — локальное состояние страницы, один заказ = один поставщик.
 * Оформление: POST /api/purchase-orders с Idempotency-Key; цена/остаток/
 * MOQ проверяются сервером, клиентская сумма — только превью.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Store, ShoppingCart, Star, MapPin, Truck, Package, Plus, Minus,
  Trash2, Search, Building2, ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import { csrfFetch } from "@/lib/api-client";

interface Supplier {
  userId: string;
  companyName: string;
  description: string | null;
  productCategories: string[] | null;
  region: string | null;
  deliveryGeography: string | null;
  deliveryTerms: string | null;
  minOrderAmount: number;
  pickupAvailable: boolean;
  deliveryAvailable: boolean;
  rating: number;
  publishedProducts: number;
}

interface CatalogItem {
  id: string;
  productName: string;
  category: string | null;
  description: string | null;
  unit: string;
  price: number;
  minOrderQty: number;
  orderStep: number;
  availableQuantity: number;
  producer: string | null;
  brand: string | null;
  supplierId: string;
  supplier: {
    companyName: string;
    region: string | null;
    deliveryTerms: string | null;
    pickupAvailable: boolean;
    deliveryAvailable: boolean;
    minOrderAmount: number;
    rating: number;
  } | null;
}

interface CartLine {
  item: CatalogItem;
  quantity: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  flour: "Мука", sugar: "Сахар", chocolate: "Шоколад", dairy: "Молочка",
  eggs: "Яйца", oils: "Масла", nuts: "Орехи", berries: "Ягоды",
  fillings: "Начинки", colors: "Красители", flavors: "Ароматизаторы",
  decor: "Декор", packaging: "Упаковка", equipment: "Инвентарь", other: "Другое",
};

const UNIT_LABELS: Record<string, string> = {
  kg: "кг", g: "г", liter: "л", ml: "мл", piece: "шт", box: "кор.", pack: "уп.",
};

export function SupplierShopPage() {
  const user = useAppStore((s) => s.user);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<"delivery" | "pickup">("delivery");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [requestedDate, setRequestedDate] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittingItems, setSubmittingItems] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [supRes, catRes] = await Promise.all([
        fetch("/api/suppliers"),
        fetch(`/api/b2b/catalog?limit=200${onlyAvailable ? "&onlyAvailable=1" : ""}`),
      ]);
      const supJson = await supRes.json();
      const catJson = await catRes.json();
      if (!supRes.ok) throw new Error(supJson.error || "Ошибка загрузки поставщиков");
      if (!catRes.ok) throw new Error(catJson.error || "Ошибка загрузки каталога");
      setSuppliers(supJson.items ?? []);
      setItems(catJson.items ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [onlyAvailable]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let list = items;
    if (supplierFilter !== "all") list = list.filter((i) => i.supplierId === supplierFilter);
    if (category !== "all") list = list.filter((i) => i.category === category);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.productName.toLowerCase().includes(needle) ||
          (i.description ?? "").toLowerCase().includes(needle) ||
          (i.producer ?? "").toLowerCase().includes(needle) ||
          (i.brand ?? "").toLowerCase().includes(needle) ||
          (i.supplier?.companyName ?? "").toLowerCase().includes(needle)
      );
    }
    return list;
  }, [items, supplierFilter, category, q]);

  const cartLines = Object.values(cart);
  const cartBySupplier: Record<string, CartLine[]> = {};
  for (const line of cartLines) {
    (cartBySupplier[line.item.supplierId] ??= []).push(line);
  }
  const cartSuppliers = Object.keys(cartBySupplier);
  const cartTotal = cartLines.reduce((s, l) => s + l.item.price * l.quantity, 0);
  const cartCount = cartLines.reduce((s, l) => s + l.quantity, 0);
  const singleSupplier = cartSuppliers.length === 1 ? cartBySupplier[cartSuppliers[0]] : null;
  const activeSupplier = singleSupplier?.[0]?.item.supplier ?? null;

  const setQty = (item: CatalogItem, qty: number) => {
    if (qty <= 0) {
      setCart((c) => {
        const next = { ...c };
        delete next[item.id];
        return next;
      });
      return;
    }
    const moq = item.minOrderQty || 1;
    const step = item.orderStep || 1;
    const compliant = Math.min(item.availableQuantity, Math.max(moq, moq + Math.ceil((qty - moq) / step) * step));
    setCart((c) => ({ ...c, [item.id]: { item, quantity: compliant } }));
  };

  const addToCart = (item: CatalogItem) => {
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    if (cartSuppliers.length > 0 && !cartBySupplier[item.supplierId]) {
      toast.error("В одной закупке можно заказывать только у одного поставщика — очистите корзину");
      return;
    }
    if (item.availableQuantity <= 0) {
      toast.error("Нет в наличии");
      return;
    }
    setQty(item, (cart[item.id]?.quantity ?? 0) + (item.orderStep || 1) || item.minOrderQty);
    toast.success("Добавлено в закупку");
  };

  const submitOrder = async () => {
    if (!singleSupplier) return;
    setSubmitting(true);
    try {
      const idemKey = crypto.randomUUID();
      setSubmittingItems(Object.fromEntries(singleSupplier.map((l) => [l.item.id, l.quantity])));
      const res = await csrfFetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idemKey },
        body: JSON.stringify({
          supplierId: singleSupplier[0].item.supplierId,
          items: singleSupplier.map((l) => ({ productId: l.item.id, quantity: l.quantity })),
          buyerComment: comment || undefined,
          deliveryMethod,
          deliveryAddress: deliveryMethod === "delivery" ? deliveryAddress : undefined,
          requestedDeliveryDate: requestedDate || undefined,
          idempotencyKey: idemKey,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const details = typeof json.details === "string" ? `: ${json.details}` : "";
        throw new Error((json.error || "Ошибка создания заказа") + details);
      }
      toast.success(
        json.existing
          ? `Заказ ${json.order.number} уже создан`
          : `Заказ ${json.order.number} отправлен поставщику`
      );
      setCart({});
      setCheckoutOpen(false);
      setComment("");
      setDeliveryAddress("");
      setRequestedDate("");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const visibleSuppliers = useMemo(() => {
    if (supplierFilter !== "all") return suppliers.filter((s) => s.userId === supplierFilter);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      return suppliers.filter(
        (s) => s.companyName.toLowerCase().includes(needle) || (s.description ?? "").toLowerCase().includes(needle)
      );
    }
    return suppliers.slice(0, 6);
  }, [suppliers, supplierFilter, q]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      {/* Заголовок */}
      <div className="mb-5">
        <h1 className="font-display text-3xl font-bold flex items-center gap-2">
          <Building2 className="h-7 w-7 text-primary" /> Поставщики
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          B2B-каталог ингредиентов и упаковки от одобренных поставщиков. Закупки оформляются напрямую поставщику.
        </p>
      </div>

      {/* Поиск и фильтры */}
      <Card className="p-3 mb-5">
        <div className="flex flex-col md:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Товар, производитель, бренд, поставщик…" className="pl-9"
              value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full md:w-48"><SelectValue placeholder="Категория" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все категории</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger className="w-full md:w-52"><SelectValue placeholder="Поставщик" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все поставщики</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.userId} value={s.userId}>{s.companyName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm px-2 cursor-pointer whitespace-nowrap">
            <input type="checkbox" checked={onlyAvailable}
              onChange={(e) => setOnlyAvailable(e.target.checked)} className="accent-[var(--primary)]" />
            Только в наличии
          </label>
        </div>
      </Card>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="h-56 animate-pulse bg-muted/40" />
          ))}
        </div>
      ) : (
        <>
          {/* Витрина поставщиков */}
          {supplierFilter === "all" && (
            <section className="mb-6">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                <Store className="h-4 w-4" /> Поставщики ({suppliers.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {visibleSuppliers.map((s) => (
                  <Card key={s.userId} className="p-4 cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => setSupplierFilter(s.userId)}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{s.companyName}</span>
                      {s.rating > 0 && (
                        <span className="text-xs flex items-center gap-0.5 text-amber-600">
                          <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" /> {s.rating.toFixed(1)}
                        </span>
                      )}
                    </div>
                    {s.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-2">
                      <Badge variant="outline" className="text-[10px]">
                        {s.publishedProducts} товаров
                      </Badge>
                      {s.region && (
                        <Badge variant="outline" className="text-[10px]">
                          <MapPin className="h-2.5 w-2.5 mr-0.5" />{s.region}
                        </Badge>
                      )}
                      {s.minOrderAmount > 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          от {(s.minOrderAmount / 100).toLocaleString("ru-RU")} ₽
                        </Badge>
                      )}
                      {s.deliveryAvailable && (
                        <Badge variant="outline" className="text-[10px]"><Truck className="h-2.5 w-2.5 mr-0.5" />доставка</Badge>
                      )}
                      {s.pickupAvailable && (
                        <Badge variant="outline" className="text-[10px]">самовывоз</Badge>
                      )}
                    </div>
                  </Card>
                ))}
                {visibleSuppliers.length === 0 && (
                  <Card className="p-6 text-sm text-muted-foreground sm:col-span-2 lg:col-span-3 text-center">
                    Поставщики не найдены. Одобренные поставщики появятся здесь после модерации.
                  </Card>
                )}
              </div>
            </section>
          )}

          {/* Каталог товаров */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold flex items-center gap-2">
                <Package className="h-4 w-4" /> Товары ({filtered.length})
              </h2>
              {supplierFilter !== "all" && (
                <Button variant="ghost" size="sm" onClick={() => setSupplierFilter("all")}>
                  Показать всех поставщиков
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((item) => {
                const inCart = cart[item.id]?.quantity ?? 0;
                return (
                  <Card key={item.id} className="p-4 flex flex-col">
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-sm leading-snug">{item.productName}</span>
                        {item.availableQuantity > 0 ? (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {item.availableQuantity} {UNIT_LABELS[item.unit] ?? item.unit}
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-700 text-[10px] shrink-0">нет в наличии</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {item.supplier?.companyName}
                        {(item.producer || item.brand) && <> • {[item.producer, item.brand].filter(Boolean).join(" / ")}</>}
                      </div>
                      {item.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
                      )}
                      <div className="flex items-baseline gap-1 mt-2">
                        <span className="font-display text-xl font-bold">
                          {(item.price / 100).toLocaleString("ru-RU")} ₽
                        </span>
                        <span className="text-xs text-muted-foreground">/ {UNIT_LABELS[item.unit] ?? item.unit}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Мин. партия: {item.minOrderQty} {UNIT_LABELS[item.unit] ?? item.unit}
                        {item.orderStep > 1 && <> • шаг {item.orderStep}</>}
                        {item.supplier?.deliveryTerms && <> • {item.supplier.deliveryTerms}</>}
                      </div>
                    </div>
                    <div className="mt-3">
                      {inCart > 0 ? (
                        <div className="flex items-center justify-between border border-border rounded-lg p-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8"
                            onClick={() => setQty(item, inCart - (item.orderStep || 1))}>
                            <Minus className="h-4 w-4" />
                          </Button>
                          <span className="text-sm font-semibold">{inCart}</span>
                          <Button size="icon" variant="ghost" className="h-8 w-8"
                            onClick={() => setQty(item, inCart + (item.orderStep || 1))}>
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button className="w-full" size="sm" disabled={item.availableQuantity <= 0}
                          onClick={() => addToCart(item)}>
                          <ShoppingCart className="h-4 w-4 mr-1" /> В закупку
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
              {filtered.length === 0 && (
                <Card className="p-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  Товары не найдены. Измените фильтры или зайдите позже.
                </Card>
              )}
            </div>
          </section>
        </>
      )}

      {/* Панель корзины */}
      {cartLines.length > 0 && (
        <div className="sticky bottom-4 mt-6 z-10">
          <Card className="p-3 shadow-lg border-primary/30">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  <ShoppingCart className="h-4 w-4 text-primary" />
                  Закупка: {cartCount} {UNIT_LABELS[singleSupplier?.[0]?.item.unit ?? "piece"] ?? "ед."} • {singleSupplier?.[0]?.item.supplier?.companyName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {cartLines.length} поз. • {(cartTotal / 100).toLocaleString("ru-RU")} ₽ (предварительно)
                </span>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setCart({})}>
                  <Trash2 className="h-4 w-4 mr-1" /> Очистить
                </Button>
                <Button size="sm" onClick={() => setCheckoutOpen(true)} disabled={!singleSupplier}>
                  <ClipboardList className="h-4 w-4 mr-1" /> Оформить заказ
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Оформление */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Закупочный заказ</DialogTitle>
            <DialogDescription>
              Поставщик: {singleSupplier?.[0]?.item.supplier?.companyName}. Цена и остаток проверяются сервером при отправке.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="border border-border rounded-lg divide-y divide-border">
              {singleSupplier?.map((l) => (
                <div key={l.item.id} className="flex justify-between text-sm p-2">
                  <span>{l.item.productName} — {l.quantity} {UNIT_LABELS[l.item.unit] ?? l.item.unit}</span>
                  <span className="text-muted-foreground">
                    {((l.item.price * l.quantity) / 100).toLocaleString("ru-RU")} ₽
                  </span>
                </div>
              ))}
              <div className="flex justify-between font-semibold text-sm p-2">
                <span>Итого</span>
                <span>{(cartTotal / 100).toLocaleString("ru-RU")} ₽</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Способ получения</Label>
                <Select value={deliveryMethod} onValueChange={(v) => setDeliveryMethod(v as "delivery" | "pickup")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {singleSupplier?.[0]?.item.supplier?.deliveryAvailable && (
                      <SelectItem value="delivery">Доставка</SelectItem>
                    )}
                    {singleSupplier?.[0]?.item.supplier?.pickupAvailable && (
                      <SelectItem value="pickup">Самовывоз</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="poDate">Желаемая дата поставки</Label>
                <Input id="poDate" type="date" value={requestedDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setRequestedDate(e.target.value)} />
              </div>
            </div>
            {deliveryMethod === "delivery" && (
              <div className="space-y-1">
                <Label htmlFor="poAddr">Адрес доставки *</Label>
                <Input id="poAddr" value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)} />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="poComment">Комментарий поставщику</Label>
              <Textarea id="poComment" rows={2} value={comment}
                onChange={(e) => setComment(e.target.value)} />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCheckoutOpen(false)}>Отмена</Button>
              <Button onClick={submitOrder}
                disabled={submitting || (deliveryMethod === "delivery" && !deliveryAddress.trim())}>
                {submitting ? "Отправляем…" : "Отправить заказ"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Оплата не списывается: заказ передаётся поставщику для подтверждения. Согласование количества и отгрузка фиксируются в истории заказа.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
