"use client";

import { useState, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Pencil, UserX, Eye, Trash2, Search, Filter, Download, Plus,
  Check, AlertCircle, EyeOff, Star, Package,
} from "lucide-react";
import { formatCurrency } from "@/lib/finance";
import { toast } from "sonner";
import type { Product, ProductCategory } from "@/lib/types";

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

export function AdminProductsManager() {
  const products = useAppStore((s) => s.products);
  const confectioners = useAppStore((s) => s.confectioners);
  const updateProduct = useAppStore((s) => s.updateProduct);
  const deleteProduct = useAppStore((s) => s.deleteProduct);
  const toggleProductVisibility = useAppStore((s) => s.toggleProductVisibility);

  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("all");
  const [filterVisibility, setFilterVisibility] = useState<string>("all");
  const [filterConfectioner, setFilterConfectioner] = useState<string>("all");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [hideDialogProduct, setHideDialogProduct] = useState<Product | null>(null);
  const [hideReason, setHideReason] = useState("");

  const filtered = useMemo(() => {
    return products.filter((p: any) => {
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
    visible: products.filter((p: any) => !p.isHidden).length,
    hidden: products.filter((p: any) => p.isHidden).length,
    popular: products.filter((p: any) => p.isPopular).length,
  };

  const handleSaveEdit = (updated: Product) => {
    updateProduct(updated.id, updated);
    setEditingProduct(null);
    toast.success("Товар обновлён", { description: updated.title });
  };

  const handleConfirmHide = () => {
    if (!hideDialogProduct) return;
    toggleProductVisibility(hideDialogProduct.id, hideReason || "Скрыт администратором");
    toast.success(hideDialogProduct.isHidden ? "Товар восстановлен" : "Товар скрыт", {
      description: hideDialogProduct.title,
    });
    setHideDialogProduct(null);
    setHideReason("");
  };

  const handleDelete = (p: Product) => {
    if (confirm(`Удалить «${p.title}» безвозвратно?`)) {
      deleteProduct(p.id);
      toast.success("Товар удалён", { description: p.title });
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
            Управление всем каталогом товаров: редактирование, скрытие, удаление
          </p>
        </div>
        <Button variant="outline" size="sm">
          <Download className="h-3.5 w-3.5 mr-1" />Экспорт
        </Button>
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
        ) : filtered.map((p: any) => (
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
                onClick={() => setHideDialogProduct(p)}
                title={p.isHidden ? "Показать" : "Скрыть"}
              >
                {p.isHidden ? <><Eye className="h-3 w-3 mr-1" />Показать</> : <><UserX className="h-3 w-3 mr-1" />Скрыть</>}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-destructive"
                onClick={() => handleDelete(p)}
                title="Удалить"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Edit Dialog */}
      {editingProduct && (
        <ProductEditAdminDialog
          product={editingProduct}
          onSave={handleSaveEdit}
          onClose={() => setEditingProduct(null)}
          confectioners={confectioners}
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

      {/* Hide/Show Dialog */}
      <Dialog open={!!hideDialogProduct} onOpenChange={(o) => !o && setHideDialogProduct(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{hideDialogProduct?.isHidden ? "Показать товар" : "Скрыть товар"}</DialogTitle>
            <DialogDescription>
              {hideDialogProduct?.isHidden
                ? "Товар вернётся в публичный каталог."
                : "Товар будет скрыт из публичного каталога. Покупатели не смогут его видеть и заказывать."}
            </DialogDescription>
          </DialogHeader>
          {!hideDialogProduct?.isHidden && (
            <div className="space-y-2">
              <Label>Причина скрытия (видит только админ и кондитер)</Label>
              <Textarea
                value={hideReason}
                onChange={(e) => setHideReason(e.target.value)}
                placeholder="Например: нарушение правил площадки, жалобы покупателей, устаревшая цена..."
                rows={3}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHideDialogProduct(null)}>Отмена</Button>
            <Button onClick={handleConfirmHide}>
              <Check className="h-4 w-4 mr-1" />
              {hideDialogProduct?.isHidden ? "Показать" : "Скрыть"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// =================== Product Edit Dialog (admin) ===================
function ProductEditAdminDialog({
  product,
  onSave,
  onClose,
  confectioners,
}: {
  product: Product;
  onSave: (p: Product) => void;
  onClose: () => void;
  confectioners: any[];
}) {
  const [form, setForm] = useState<Product>({ ...product });
  const [imageUrl, setImageUrl] = useState("");

  const addImage = () => {
    if (imageUrl.trim()) {
      setForm({ ...form, images: [...(form.images || []), imageUrl.trim()] });
      setImageUrl("");
    }
  };

  const removeImage = (idx: number) => {
    setForm({ ...form, images: form.images.filter((_, i) => i !== idx) });
  };

  const handleSave = () => {
    if (!form.title.trim()) {
      toast.error("Укажите название товара");
      return;
    }
    if (!form.price || form.price <= 0) {
      toast.error("Укажите корректную цену");
      return;
    }
    onSave(form);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Редактирование товара</DialogTitle>
          <DialogDescription>Изменение карточки товара платформы</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Название</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>

          <div>
            <Label>Описание</Label>
            <Textarea
              value={form.description || ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Цена, ₽</Label>
              <Input
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Старая цена, ₽ (опционально)</Label>
              <Input
                type="number"
                value={form.oldPrice || ""}
                onChange={(e) => setForm({ ...form, oldPrice: e.target.value ? Number(e.target.value) : undefined })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Категория</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as ProductCategory })}>
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
                value={form.confectionerId}
                onValueChange={(v) => {
                  const c = confectioners.find((x) => x.id === v);
                  setForm({
                    ...form,
                    confectionerId: v,
                    confectionerName: c?.businessName || c?.name || form.confectionerName,
                  });
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {confectioners.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.businessName || c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Вес</Label>
              <Input value={form.weight || ""} onChange={(e) => setForm({ ...form, weight: e.target.value })} placeholder="1.2 кг" />
            </div>
            <div>
              <Label>Порций</Label>
              <Input
                type="number"
                value={form.servings || ""}
                onChange={(e) => setForm({ ...form, servings: e.target.value ? Number(e.target.value) : undefined })}
              />
            </div>
            <div>
              <Label>Срок изготовления</Label>
              <Input value={form.prepTime || ""} onChange={(e) => setForm({ ...form, prepTime: e.target.value })} placeholder="2 дня" />
            </div>
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
              {(form.images || []).map((img, i) => (
                <div key={i} className="relative w-16 h-16 rounded overflow-hidden border">
                  <img src={img} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute top-0 right-0 bg-red-500 text-white p-0.5 rounded-bl"
                    type="button"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.isPopular}
                onChange={(e) => setForm({ ...form, isPopular: e.target.checked })}
                className="w-4 h-4 accent-primary"
              />
              Популярный
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.isNew}
                onChange={(e) => setForm({ ...form, isNew: e.target.checked })}
                className="w-4 h-4 accent-primary"
              />
              Новинка
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.isHit}
                onChange={(e) => setForm({ ...form, isHit: e.target.checked })}
                className="w-4 h-4 accent-primary"
              />
              Хит
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.arEnabled}
                onChange={(e) => setForm({ ...form, arEnabled: e.target.checked })}
                className="w-4 h-4 accent-primary"
              />
              AR-просмотр
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave}>
            <Check className="h-4 w-4 mr-1" />Сохранить
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
