"use client";

/**
 * Confectioner catalog manager — full CRUD for products.
 *
 * Features:
 *   - Product list with edit/delete buttons
 *   - Add/Edit modal with all fields: title, description, price, category,
 *     images (URL input), weight, servings, prepTime, tags,
 *     fillings, coatings, decorations, composition (ingredients, allergens,
 *     nutritional value, storage), detail images
 *   - Delete with confirmation
 *   - Product detail view with full description and composition
 */
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Pencil,
  Trash2,
  Package,
  X,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  AlertCircle,
  Info,
  Eye,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import type { Product } from "@/lib/types";
import { formatCurrency } from "@/lib/finance";
import { toast } from "sonner";

const CATEGORIES = [
  { value: "cakes", label: "Торты" },
  { value: "cupcakes", label: "Капкейки" },
  { value: "bento", label: "Бенто-торты" },
  { value: "macarons", label: "Макаронс" },
  { value: "cheesecakes", label: "Чизкейки" },
  { value: "cookies", label: "Печенье" },
  { value: "desserts", label: "Десерты" },
  { value: "pastries", label: "Пирожные" },
  { value: "chocolate", label: "Шоколад" },
  { value: "zephyr_bouquets", label: "Зефирные букеты" },
  { value: "pies", label: "Пироги" },
  { value: "patties", label: "Пирожки" },
  { value: "rolls", label: "Рулеты" },
  { value: "healthy", label: "ПП изделия" },
  { value: "pastila", label: "Пастила" },
  { value: "oriental_sweets", label: "Восточные сладости" },
  { value: "candies", label: "Конфеты" },
  { value: "marmalade", label: "Мармелад" },
  { value: "lollipops", label: "Леденцы" },
  { value: "gingerbread", label: "Пряники" },
  { value: "realistic_cakes", label: "Реалистичные пирожные" },
  { value: "custom", label: "На заказ" },
];

const COMMON_ALLERGENS = ["Глютен", "Молоко", "Яйца", "Орехи", "Арахис", "Соя", "Кунжут", "Мёд"];

interface ProductFormData {
  title: string;
  description: string;
  price: number;
  oldPrice?: number;
  category: string;
  images: string[];
  weight: string;
  servings: number;
  prepTime: string;
  tags: string[];
  fillings: { name: string; priceModifier: number }[];
  coatings: { name: string; priceModifier: number }[];
  decorations: { name: string; priceModifier: number }[];
  composition: {
    ingredients: string[];
    allergens: string[];
    nutritionalValue?: { calories?: number; protein?: number; fat?: number; carbs?: number };
    storageConditions?: string;
    shelfLife?: string;
  };
  detailImages: string[];
}

const EMPTY_FORM: ProductFormData = {
  title: "",
  description: "",
  price: 0,
  oldPrice: undefined,
  category: "cakes",
  images: [],
  weight: "",
  servings: 0,
  prepTime: "",
  tags: [],
  fillings: [],
  coatings: [],
  decorations: [],
  composition: { ingredients: [], allergens: [] },
  detailImages: [],
};

export function ConfectionerCatalogManager({ confectionerId }: { confectionerId: string }) {
  const products = useAppStore((s) => s.products);
  const addProduct = useAppStore((s) => s.addProduct);
  const updateProduct = useAppStore((s) => s.updateProduct);
  const deleteProduct = useAppStore((s) => s.deleteProduct);
  const confectioners = useAppStore((s) => s.confectioners);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductFormData>(EMPTY_FORM);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const myProducts = products.filter((p) => p.confectionerId === confectionerId);
  const confectioner = confectioners.find((c) => c.id === confectionerId);

  const handleAdd = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowModal(true);
  };

  const handleEdit = (product: Product) => {
    setForm({
      title: product.title,
      description: product.description,
      price: product.price,
      oldPrice: product.oldPrice,
      category: product.category,
      images: product.images || [],
      weight: product.weight || "",
      servings: product.servings || 0,
      prepTime: product.prepTime || "",
      tags: product.tags || [],
      fillings: product.fillings || [],
      coatings: product.coatings || [],
      decorations: product.decorations || [],
      composition: product.composition || { ingredients: [], allergens: [] },
      detailImages: product.detailImages || [],
    });
    setEditingId(product.id);
    setShowModal(true);
  };

  const handleSave = () => {
    if (!form.title.trim()) {
      toast.error("Введите название товара");
      return;
    }
    if (form.price <= 0) {
      toast.error("Укажите цену больше 0");
      return;
    }
    if (form.images.length === 0) {
      toast.error("Добавьте хотя бы одно изображение");
      return;
    }

    const slug = form.title.toLowerCase().replace(/[^a-z0-9а-я]+/gi, "-");

    if (editingId) {
      updateProduct(editingId, {
        ...form,
        slug,
      } as Partial<Product>);
      toast.success("Товар обновлён");
    } else {
      addProduct({
        ...form,
        slug,
        confectionerId,
        confectionerName: confectioner?.businessName || "",
        confectionerAvatar: confectioner?.avatar,
        isPopular: false,
        isNew: true,
        isHit: false,
      } as Omit<Product, "id" | "rating" | "reviewsCount" | "createdAt">);
      toast.success("Товар добавлен в каталог");
    }
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    deleteProduct(id);
    setDeleteConfirmId(null);
    toast.success("Товар удалён");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Каталог продукции</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {myProducts.length} товаров · добавляйте, редактируйте и удаляйте
          </p>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="h-4 w-4 mr-1" />
          Добавить товар
        </Button>
      </div>

      {/* Product list */}
      {myProducts.length === 0 ? (
        <Card className="p-12 text-center">
          <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-4">
            В каталоге пока нет товаров
          </p>
          <Button onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-1" />
            Добавить первый товар
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {myProducts.map((product) => {
            const isExpanded = expandedProduct === product.id;
            return (
              <Card key={product.id} className="overflow-hidden">
                {/* Product header row */}
                <div className="flex items-start gap-3 p-3">
                  {/* Image */}
                  <div className="w-20 h-20 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                    {product.images[0] ? (
                      <img src={product.images[0]} alt={product.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{product.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {formatCurrency(product.price)}
                          {product.oldPrice && (
                            <span className="line-through ml-1 opacity-60">{formatCurrency(product.oldPrice)}</span>
                          )}
                          {product.weight && ` · ${product.weight}`}
                          {product.servings ? ` · ${product.servings} порц.` : ""}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          <Badge variant="outline" className="text-[10px]">
                            {CATEGORIES.find((c) => c.value === product.category)?.label || product.category}
                          </Badge>
                          {product.isHit && <Badge className="text-[10px] bg-primary">Хит</Badge>}
                          {product.isNew && <Badge className="text-[10px] bg-emerald-600">Новинка</Badge>}
                          {product.tags?.slice(0, 2).map((t) => (
                            <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                          ))}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setExpandedProduct(isExpanded ? null : product.id)}>
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleEdit(product)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteConfirmId(product.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t px-3 py-3 bg-muted/30 space-y-3">
                    {/* Description */}
                    {product.description && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground mb-1">Описание</div>
                        <p className="text-sm text-foreground whitespace-pre-wrap">{product.description}</p>
                      </div>
                    )}

                    {/* Composition */}
                    {product.composition && (
                      <div className="grid sm:grid-cols-2 gap-3">
                        {/* Ingredients */}
                        {product.composition.ingredients.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                              <Info className="h-3 w-3" /> Состав
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {product.composition.ingredients.map((ing, i) => (
                                <Badge key={i} variant="outline" className="text-[10px]">{ing}</Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Allergens */}
                        {product.composition.allergens.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" /> Аллергены
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {product.composition.allergens.map((a, i) => (
                                <Badge key={i} className="text-[10px] bg-red-100 text-red-700">{a}</Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Nutritional value */}
                        {product.composition.nutritionalValue && (
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground mb-1">КБЖУ (на 100г)</div>
                            <div className="text-xs text-muted-foreground">
                              {product.composition.nutritionalValue.calories ? `${product.composition.nutritionalValue.calories} ккал` : ""}
                              {product.composition.nutritionalValue.protein ? ` · Б: ${product.composition.nutritionalValue.protein}г` : ""}
                              {product.composition.nutritionalValue.fat ? ` · Ж: ${product.composition.nutritionalValue.fat}г` : ""}
                              {product.composition.nutritionalValue.carbs ? ` · У: ${product.composition.nutritionalValue.carbs}г` : ""}
                            </div>
                          </div>
                        )}

                        {/* Storage */}
                        {product.composition.storageConditions && (
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground mb-1">Хранение</div>
                            <div className="text-xs text-muted-foreground">{product.composition.storageConditions}</div>
                            {product.composition.shelfLife && (
                              <div className="text-xs text-muted-foreground">Срок годности: {product.composition.shelfLife}</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Customization options */}
                    {(product.fillings?.length || 0) > 0 || (product.coatings?.length || 0) > 0 || (product.decorations?.length || 0) > 0 ? (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground mb-1">Опции кастомизации</div>
                        <div className="flex flex-wrap gap-2">
                          {product.fillings?.map((f, i) => (
                            <Badge key={`f${i}`} variant="secondary" className="text-[10px]">
                              🍰 {f.name}{f.priceModifier > 0 ? ` +${formatCurrency(f.priceModifier)}` : ""}
                            </Badge>
                          ))}
                          {product.coatings?.map((c, i) => (
                            <Badge key={`c${i}`} variant="secondary" className="text-[10px]">
                              🎨 {c.name}{c.priceModifier > 0 ? ` +${formatCurrency(c.priceModifier)}` : ""}
                            </Badge>
                          ))}
                          {product.decorations?.map((d, i) => (
                            <Badge key={`d${i}`} variant="secondary" className="text-[10px]">
                              ✨ {d.name}{d.priceModifier > 0 ? ` +${formatCurrency(d.priceModifier)}` : ""}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* All images */}
                    {product.images.length > 1 && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground mb-1">Все изображения ({product.images.length})</div>
                        <div className="flex flex-wrap gap-2">
                          {product.images.map((img, i) => (
                            <img key={i} src={img} alt="" className="w-16 h-16 rounded-md object-cover border" loading="lazy" decoding="async" />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Add/Edit Dialog */}
      {showModal && (
        <ProductEditDialog
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
          isEditing={!!editingId}
        />
      )}

      {/* Delete confirmation */}
      {deleteConfirmId && (
        <Dialog open onOpenChange={() => setDeleteConfirmId(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Удалить товар?</DialogTitle>
              <DialogDescription>
                Товар будет удалён из каталога без возможности восстановления.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Отмена</Button>
              <Button variant="destructive" onClick={() => handleDelete(deleteConfirmId)}>
                <Trash2 className="h-4 w-4 mr-1" /> Удалить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ===== Product Edit Dialog =====

function ProductEditDialog({
  form,
  setForm,
  onSave,
  onClose,
  isEditing,
}: {
  form: ProductFormData;
  setForm: (f: ProductFormData) => void;
  onSave: () => void;
  onClose: () => void;
  isEditing: boolean;
}) {
  const [imageUrl, setImageUrl] = useState("");
  const [detailImageUrl, setDetailImageUrl] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [ingredientInput, setIngredientInput] = useState("");
  const [fillingName, setFillingName] = useState("");
  const [fillingPrice, setFillingPrice] = useState("0");

  const addImage = () => {
    if (imageUrl.trim()) {
      setForm({ ...form, images: [...form.images, imageUrl.trim()] });
      setImageUrl("");
    }
  };

  const removeImage = (idx: number) => {
    setForm({ ...form, images: form.images.filter((_, i) => i !== idx) });
  };

  const addTag = () => {
    if (tagInput.trim()) {
      setForm({ ...form, tags: [...form.tags, tagInput.trim()] });
      setTagInput("");
    }
  };

  const addIngredient = () => {
    if (ingredientInput.trim()) {
      setForm({
        ...form,
        composition: {
          ...form.composition,
          ingredients: [...form.composition.ingredients, ingredientInput.trim()],
        },
      });
      setIngredientInput("");
    }
  };

  const toggleAllergen = (allergen: string) => {
    const has = form.composition.allergens.includes(allergen);
    setForm({
      ...form,
      composition: {
        ...form.composition,
        allergens: has
          ? form.composition.allergens.filter((a) => a !== allergen)
          : [...form.composition.allergens, allergen],
      },
    });
  };

  const addFilling = () => {
    if (fillingName.trim()) {
      setForm({
        ...form,
        fillings: [...form.fillings, { name: fillingName.trim(), priceModifier: parseInt(fillingPrice) || 0 }],
      });
      setFillingName("");
      setFillingPrice("0");
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Редактировать товар" : "Новый товар"}</DialogTitle>
          <DialogDescription>
            Заполните информацию о товаре. Поля со * обязательны.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Basic info */}
          <div className="space-y-2">
            <Label>* Название товара</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Торт «Свадебный»"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>* Цена, ₽</Label>
              <Input
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
                placeholder="2500"
              />
            </div>
            <div className="space-y-2">
              <Label>Старая цена (для скидки)</Label>
              <Input
                type="number"
                value={form.oldPrice || ""}
                onChange={(e) => setForm({ ...form, oldPrice: e.target.value ? parseInt(e.target.value) : undefined })}
                placeholder="3000"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Категория</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Вес</Label>
              <Input value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} placeholder="1.5 кг" />
            </div>
            <div className="space-y-2">
              <Label>Порций</Label>
              <Input type="number" value={form.servings || ""} onChange={(e) => setForm({ ...form, servings: parseInt(e.target.value) || 0 })} placeholder="10" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Срок изготовления</Label>
            <Input value={form.prepTime} onChange={(e) => setForm({ ...form, prepTime: e.target.value })} placeholder="2-3 дня" />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>* Описание</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Подробное описание товара: вкус, текстура, особенности изготовления..."
              rows={4}
            />
          </div>

          {/* Images */}
          <div className="space-y-2">
            <Label>Изображения *</Label>
            <div className="flex gap-2">
              <Input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://images.unsplash.com/..."
                onKeyDown={(e) => e.key === "Enter" && addImage()}
              />
              <Button type="button" size="sm" onClick={addImage}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {form.images.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {form.images.map((img, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border">
                    <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute top-0 right-0 bg-black/60 text-white p-0.5 rounded-bl-md"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Вставьте URL изображения. Первое изображение — главное.
            </p>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Теги</Label>
            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="бисквит, свадебный, ягоды..."
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
              />
              <Button type="button" size="sm" variant="outline" onClick={addTag}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {form.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {form.tags.map((t, i) => (
                  <Badge key={i} variant="secondary" className="text-xs cursor-pointer" onClick={() => setForm({ ...form, tags: form.tags.filter((_, j) => j !== i) })}>
                    {t} <X className="h-3 w-3 ml-1" />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Composition */}
          <div className="border-t pt-3 space-y-3">
            <div className="font-semibold text-sm">Состав продукта</div>

            {/* Ingredients */}
            <div className="space-y-2">
              <Label>Ингредиенты (из чего состоит)</Label>
              <div className="flex gap-2">
                <Input
                  value={ingredientInput}
                  onChange={(e) => setIngredientInput(e.target.value)}
                  placeholder="Мука пшеничная, сахар, масло сливочное..."
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addIngredient())}
                />
                <Button type="button" size="sm" variant="outline" onClick={addIngredient}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {form.composition.ingredients.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {form.composition.ingredients.map((ing, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="text-xs cursor-pointer"
                      onClick={() => setForm({
                        ...form,
                        composition: {
                          ...form.composition,
                          ingredients: form.composition.ingredients.filter((_, j) => j !== i),
                        },
                      })}
                    >
                      {ing} <X className="h-3 w-3 ml-1" />
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Allergens */}
            <div className="space-y-2">
              <Label>Аллергены</Label>
              <div className="flex flex-wrap gap-1">
                {COMMON_ALLERGENS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => toggleAllergen(a)}
                    className={`px-2 py-1 rounded-md text-xs border transition-colors ${
                      form.composition.allergens.includes(a)
                        ? "bg-red-100 text-red-700 border-red-300"
                        : "bg-background text-muted-foreground border-border hover:border-red-300"
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            {/* Nutritional value */}
            <div className="grid grid-cols-4 gap-2">
              <div>
                <Label className="text-xs">Ккал</Label>
                <Input type="number" placeholder="350"
                  value={form.composition.nutritionalValue?.calories || ""}
                  onChange={(e) => setForm({
                    ...form,
                    composition: {
                      ...form.composition,
                      nutritionalValue: {
                        ...form.composition.nutritionalValue,
                        calories: e.target.value ? parseInt(e.target.value) : undefined,
                      },
                    },
                  })}
                />
              </div>
              <div>
                <Label className="text-xs">Белки</Label>
                <Input type="number" placeholder="5"
                  value={form.composition.nutritionalValue?.protein || ""}
                  onChange={(e) => setForm({
                    ...form,
                    composition: {
                      ...form.composition,
                      nutritionalValue: {
                        ...form.composition.nutritionalValue,
                        protein: e.target.value ? parseInt(e.target.value) : undefined,
                      },
                    },
                  })}
                />
              </div>
              <div>
                <Label className="text-xs">Жиры</Label>
                <Input type="number" placeholder="15"
                  value={form.composition.nutritionalValue?.fat || ""}
                  onChange={(e) => setForm({
                    ...form,
                    composition: {
                      ...form.composition,
                      nutritionalValue: {
                        ...form.composition.nutritionalValue,
                        fat: e.target.value ? parseInt(e.target.value) : undefined,
                      },
                    },
                  })}
                />
              </div>
              <div>
                <Label className="text-xs">Углев.</Label>
                <Input type="number" placeholder="45"
                  value={form.composition.nutritionalValue?.carbs || ""}
                  onChange={(e) => setForm({
                    ...form,
                    composition: {
                      ...form.composition,
                      nutritionalValue: {
                        ...form.composition.nutritionalValue,
                        carbs: e.target.value ? parseInt(e.target.value) : undefined,
                      },
                    },
                  })}
                />
              </div>
            </div>

            {/* Storage */}
            <div className="grid grid-cols-1 gap-2">
              <div>
                <Label className="text-xs">Условия хранения</Label>
                <Input placeholder="Хранить при 2-6°C не более 48 часов"
                  value={form.composition.storageConditions || ""}
                  onChange={(e) => setForm({
                    ...form,
                    composition: { ...form.composition, storageConditions: e.target.value },
                  })}
                />
              </div>
              <div>
                <Label className="text-xs">Срок годности</Label>
                <Input placeholder="48 часов с момента изготовления"
                  value={form.composition.shelfLife || ""}
                  onChange={(e) => setForm({
                    ...form,
                    composition: { ...form.composition, shelfLife: e.target.value },
                  })}
                />
              </div>
            </div>
          </div>

          {/* Customization options */}
          <div className="border-t pt-3 space-y-3">
            <div className="font-semibold text-sm">Опции кастомизации</div>

            {/* Fillings — choose from DB + custom */}
            <div className="space-y-2">
              <Label className="text-xs">Начинки (выберите из базы или добавьте свою)</Label>
              {/* DB fillings selector */}
              <FillingSelector
                selectedFillings={form.fillings}
                onAdd={(name, price) => {
                  setForm({
                    ...form,
                    fillings: [...form.fillings, { name, priceModifier: price }],
                  });
                }}
              />
              {/* Custom filling input */}
              <div className="text-xs text-muted-foreground mt-2">Или добавьте свою начинку:</div>
              <div className="flex gap-2">
                <Input
                  value={fillingName}
                  onChange={(e) => setFillingName(e.target.value)}
                  placeholder="Своя начинка"
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={fillingPrice}
                  onChange={(e) => setFillingPrice(e.target.value)}
                  placeholder="0"
                  className="w-24"
                />
                <Button type="button" size="sm" variant="outline" onClick={addFilling}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {form.fillings.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {form.fillings.map((f, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="text-xs cursor-pointer"
                      onClick={() => setForm({ ...form, fillings: form.fillings.filter((_, j) => j !== i) })}
                    >
                      🍰 {f.name} {f.priceModifier > 0 ? `+${f.priceModifier}₽` : ""} <X className="h-3 w-3 ml-1" />
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={onSave}>
            {isEditing ? "Сохранить" : "Добавить товар"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===== Filling Selector (from DB) =====
function FillingSelector({
  selectedFillings,
  onAdd,
}: {
  selectedFillings: { name: string; priceModifier: number }[];
  onAdd: (name: string, price: number) => void;
}) {
  const [dbFillings, setDbFillings] = useState<Array<{
    id: string; name: string; description: string; category: string;
    suggestedPriceModifier: number; color: string | null; allergens: string[];
  }>>([]);
  const [search, setSearch] = useState("");
  const [showList, setShowList] = useState(false);
  const [selectedFilling, setSelectedFilling] = useState("");
  const [customPrice, setCustomPrice] = useState("");

  useEffect(() => {
    fetch("/api/fillings/list?status=APPROVED&limit=100")
      .then((r) => r.json())
      .then((data) => setDbFillings(data.fillings || []))
      .catch(() => {});
  }, []);

  const filtered = dbFillings.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectedNames = selectedFillings.map((f) => f.name);

  const handleSelect = (filling: typeof dbFillings[0]) => {
    const price = parseInt(customPrice) || filling.suggestedPriceModifier || 0;
    onAdd(filling.name, price);
    setSelectedFilling("");
    setCustomPrice("");
    setShowList(false);
  };

  return (
    <div className="space-y-2">
      {/* Search + price input */}
      <div className="flex gap-2">
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setShowList(true); }}
          onFocus={() => setShowList(true)}
          placeholder="Поиск начинки из базы (53 начинок)..."
          className="flex-1"
        />
        <Input
          type="number"
          value={customPrice}
          onChange={(e) => setCustomPrice(e.target.value)}
          placeholder="Цена"
          className="w-24"
        />
      </div>

      {/* Dropdown list */}
      {showList && filtered.length > 0 && (
        <div className="border rounded-lg max-h-60 overflow-y-auto bg-background shadow-lg">
          {filtered.slice(0, 20).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => handleSelect(f)}
              disabled={selectedNames.includes(f.name)}
              className={`w-full text-left p-2 hover:bg-muted/50 border-b last:border-0 transition-colors ${
                selectedNames.includes(f.name) ? "opacity-40 cursor-not-allowed" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                {f.color && (
                  <div
                    className="w-4 h-4 rounded-full border flex-shrink-0"
                    style={{ backgroundColor: f.color }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{f.name}</div>
                  <div className="text-xs text-muted-foreground line-clamp-1">{f.description}</div>
                  {f.allergens.length > 0 && (
                    <div className="text-[10px] text-red-600">{f.allergens.join(", ")}</div>
                  )}
                </div>
                {f.suggestedPriceModifier > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    +{f.suggestedPriceModifier}₽
                  </Badge>
                )}
              </div>
            </button>
          ))}
          {filtered.length > 20 && (
            <div className="p-2 text-center text-xs text-muted-foreground">
              ещё {filtered.length - 20} начинок...
            </div>
          )}
        </div>
      )}

      {showList && filtered.length === 0 && search && (
        <div className="text-xs text-muted-foreground p-2">
          Не найдено. Добавьте свою начинку ниже.
        </div>
      )}
    </div>
  );
}
