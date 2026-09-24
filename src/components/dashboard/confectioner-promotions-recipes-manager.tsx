"use client";

/**
 * Confectioner promotions manager — full CRUD for promotions.
 * Confectioner recipes manager — full CRUD with ingredients and steps.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Pencil, Trash2, Gift, ChefHat, X, Clock, Users, Star, ListOrdered,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import type { Promotion, Recipe } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/finance";
import { toast } from "sonner";

// ===== PROMOTIONS MANAGER =====

const PROMO_TYPES = [
  { value: "discount_percent", label: "Скидка %" },
  { value: "discount_fixed", label: "Скидка ₽" },
  { value: "free_delivery", label: "Бесплатная доставка" },
  { value: "gift", label: "Подарок" },
  { value: "bundle", label: "Комплект" },
];

export function ConfectionerPromotionsManager({ confectionerId }: { confectionerId: string }) {
  const promotions = useAppStore((s) => s.promotions);
  const addPromotion = useAppStore((s) => s.addPromotion);
  const updatePromotion = useAppStore((s) => s.updatePromotion);
  const deletePromotion = useAppStore((s) => s.deletePromotion);
  const confectioners = useAppStore((s) => s.confectioners);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    type: "discount_percent" as any,
    value: 0,
    promoCode: "",
    minOrderAmount: 0,
    startDate: new Date().toISOString().split("T")[0],
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    cities: [] as string[],
    image: "",
  });

  const myPromos = promotions.filter((p) => p.confectionerId === confectionerId);

  const handleAdd = () => {
    setForm({
      title: "", description: "", type: "discount_percent" as any, value: 0, promoCode: "",
      minOrderAmount: 0, startDate: new Date().toISOString().split("T")[0],
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      cities: [], image: "",
    });
    setEditingId(null);
    setShowModal(true);
  };

  const handleEdit = (promo: Promotion) => {
    setForm({
      title: promo.title,
      description: promo.description,
      type: promo.type as any,
      value: promo.value || 0,
      promoCode: promo.promoCode || "",
      minOrderAmount: promo.minOrderAmount || 0,
      startDate: promo.startDate?.split("T")[0] || "",
      endDate: promo.endDate?.split("T")[0] || "",
      cities: promo.cities || [],
      image: promo.image || "",
    });
    setEditingId(promo.id);
    setShowModal(true);
  };

  const handleSave = () => {
    if (!form.title.trim()) { toast.error("Введите название акции"); return; }
    const confectioner = confectioners.find((c) => c.id === confectionerId);
    const data = {
      ...form,
      startDate: new Date(form.startDate).toISOString(),
      endDate: new Date(form.endDate).toISOString(),
      status: "active" as const,
      isPromoted: false,
      confectionerId,
      confectionerName: confectioner?.businessName || "",
      confectionerAvatar: confectioner?.avatar,
    };
    if (editingId) {
      updatePromotion(editingId, data);
      toast.success("Акция обновлена");
    } else {
      addPromotion(data as Omit<Promotion, "id" | "createdAt" | "views" | "clicks" | "conversions" | "usedCount">);
      toast.success("Акция создана");
    }
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    deletePromotion(id);
    toast.success("Акция удалена");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Акции</h1>
          <p className="text-sm text-muted-foreground mt-1">{myPromos.length} активных акций</p>
        </div>
        <Button onClick={handleAdd}><Plus className="h-4 w-4 mr-1" />Создать акцию</Button>
      </div>

      {myPromos.length === 0 ? (
        <Card className="p-12 text-center">
          <Gift className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-4">Акций пока нет</p>
          <Button onClick={handleAdd}><Plus className="h-4 w-4 mr-1" />Создать первую акцию</Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {myPromos.map((promo) => (
            <Card key={promo.id} className="p-4">
              <div className="flex items-start gap-3">
                {promo.image && <img src={promo.image} alt="" className="w-16 h-16 rounded-lg object-cover" loading="lazy" decoding="async" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{promo.title}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {PROMO_TYPES.find((t) => t.value === promo.type)?.label || promo.type}
                    </Badge>
                    {promo.status === "active" && <Badge className="text-[10px] bg-emerald-600">Активна</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{promo.description}</p>
                  <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                    {promo.value ? <span>Скидка: {promo.value}{promo.type === "discount_percent" ? "%" : "₽"}</span> : null}
                    {promo.promoCode && <span>Промокод: <strong className="font-mono">{promo.promoCode}</strong></span>}
                    {promo.minOrderAmount ? <span>Мин. заказ: {formatCurrency(promo.minOrderAmount)}</span> : null}
                    <span>До: {promo.endDate ? formatDate(promo.endDate) : "—"}</span>
                    <span>Использовано: {promo.usedCount || 0}</span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleEdit(promo)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => handleDelete(promo.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showModal && (
        <Dialog open onOpenChange={() => setShowModal(false)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingId ? "Редактировать акцию" : "Новая акция"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div><Label>Название *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Скидка 20% на свадебные торты" /></div>
              <div><Label>Описание</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} placeholder="Подробное описание акции..." /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Тип акции</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PROMO_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Размер скидки</Label><Input type="number" value={form.value || ""} onChange={(e) => setForm({ ...form, value: parseInt(e.target.value) || 0 })} placeholder="20" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Промокод</Label><Input value={form.promoCode} onChange={(e) => setForm({ ...form, promoCode: e.target.value.toUpperCase() })} placeholder="WEDDING20" /></div>
                <div><Label>Мин. сумма заказа</Label><Input type="number" value={form.minOrderAmount || ""} onChange={(e) => setForm({ ...form, minOrderAmount: parseInt(e.target.value) || 0 })} placeholder="3000" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Начало</Label><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
                <div><Label>Окончание</Label><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
              </div>
              <div><Label>URL изображения</Label><Input value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="https://..." /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowModal(false)}>Отмена</Button>
              <Button onClick={handleSave}>{editingId ? "Сохранить" : "Создать"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ===== RECIPES MANAGER =====

const RECIPE_DIFFICULTIES = [
  { value: "easy", label: "Лёгкий" },
  { value: "medium", label: "Средний" },
  { value: "hard", label: "Сложный" },
];

export function ConfectionerRecipesManager({ confectionerId }: { confectionerId: string }) {
  const recipes = useAppStore((s) => s.recipes);
  const addRecipe = useAppStore((s) => s.addRecipe);
  const updateRecipe = useAppStore((s) => s.updateRecipe);
  const deleteRecipe = useAppStore((s) => s.deleteRecipe);
  const confectioners = useAppStore((s) => s.confectioners);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    coverImage: "",
    prepTime: 0,
    cookTime: 0,
    difficulty: "easy" as string,
    servings: 1,
    ingredients: [] as { name: string; amount: string; unit: string }[],
    steps: [] as { title: string; description: string; image?: string }[],
    tips: [] as string[],
    tags: [] as string[],
    category: "",
    access: "free" as string,
    price: 0,
    type: "recipe" as any,
  });

  // Temp inputs
  const [ingName, setIngName] = useState("");
  const [ingAmount, setIngAmount] = useState("");
  const [ingUnit, setIngUnit] = useState("г");
  const [stepTitle, setStepTitle] = useState("");
  const [stepDesc, setStepDesc] = useState("");
  const [tipInput, setTipInput] = useState("");

  const confectioner = confectioners.find((c) => c.id === confectionerId);
  const myRecipes = recipes.filter((r) => r.confectionerId === confectionerId);

  const handleAdd = () => {
    setForm({
      title: "", description: "", coverImage: "", prepTime: 0, cookTime: 0,
      difficulty: "easy", servings: 1, ingredients: [], steps: [], tips: [],
      tags: [], category: "", access: "free", price: 0, type: "recipe",
    });
    setEditingId(null);
    setShowModal(true);
  };

  const handleEdit = (recipe: Recipe) => {
    setForm({
      title: recipe.title, description: recipe.description, coverImage: recipe.coverImage,
      prepTime: recipe.prepTime, cookTime: recipe.cookTime, difficulty: recipe.difficulty,
      servings: recipe.servings, ingredients: recipe.ingredients, steps: recipe.steps,
      tips: recipe.tips || [], tags: recipe.tags, category: recipe.category,
      access: recipe.access, price: recipe.price || 0, type: recipe.type,
    });
    setEditingId(recipe.id);
    setShowModal(true);
  };

  const handleSave = () => {
    if (!form.title.trim()) { toast.error("Введите название"); return; }
    if (form.ingredients.length === 0) { toast.error("Добавьте хотя бы один ингредиент"); return; }
    if (form.steps.length === 0) { toast.error("Добавьте хотя бы один шаг"); return; }

    const data = {
      ...form,
      totalTime: form.prepTime + form.cookTime,
      difficulty: form.difficulty as Recipe["difficulty"],
      access: form.access as Recipe["access"],
      type: form.type as Recipe["type"],
      published: true,
      publishedAt: new Date().toISOString(),
      confectionerId,
      confectionerName: confectioner?.businessName || "",
      confectionerAvatar: confectioner?.avatar,
    };

    if (editingId) {
      updateRecipe(editingId, data);
      toast.success("Рецепт обновлён");
    } else {
      addRecipe(data as Omit<Recipe, "id" | "createdAt" | "views" | "likes" | "comments">);
      toast.success("Рецепт создан");
    }
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    deleteRecipe(id);
    toast.success("Рецепт удалён");
  };

  const addIngredient = () => {
    if (ingName.trim()) {
      setForm({ ...form, ingredients: [...form.ingredients, { name: ingName.trim(), amount: ingAmount, unit: ingUnit }] });
      setIngName(""); setIngAmount("");
    }
  };

  const addStep = () => {
    if (stepTitle.trim()) {
      setForm({ ...form, steps: [...form.steps, { title: stepTitle.trim(), description: stepDesc }] });
      setStepTitle(""); setStepDesc("");
    }
  };

  const addTip = () => {
    if (tipInput.trim()) {
      setForm({ ...form, tips: [...form.tips, tipInput.trim()] });
      setTipInput("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Рецепты и уроки</h1>
          <p className="text-sm text-muted-foreground mt-1">{myRecipes.length} рецептов</p>
        </div>
        <Button onClick={handleAdd}><Plus className="h-4 w-4 mr-1" />Добавить рецепт</Button>
      </div>

      {myRecipes.length === 0 ? (
        <Card className="p-12 text-center">
          <ChefHat className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-4">Рецептов пока нет</p>
          <Button onClick={handleAdd}><Plus className="h-4 w-4 mr-1" />Добавить первый рецепт</Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {myRecipes.map((recipe) => {
            const isExpanded = expandedId === recipe.id;
            return (
              <Card key={recipe.id} className="overflow-hidden">
                <div className="flex items-start gap-3 p-3">
                  {recipe.coverImage && <img src={recipe.coverImage} alt="" className="w-20 h-20 rounded-lg object-cover flex-shrink-0" loading="lazy" decoding="async" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{recipe.title}</span>
                      {recipe.published ? <Badge className="text-[10px] bg-emerald-600">Опубликован</Badge> : <Badge variant="secondary" className="text-[10px]">Черновик</Badge>}
                      {recipe.access === "paid" && <Badge className="text-[10px] bg-amber-500">Платный {recipe.price}₽</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{recipe.description}</p>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{recipe.prepTime + recipe.cookTime} мин</span>
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" />{recipe.servings} порц.</span>
                      <span className="flex items-center gap-1"><Star className="h-3 w-3" />{recipe.difficulty === "easy" ? "Лёгкий" : recipe.difficulty === "medium" ? "Средний" : "Сложный"}</span>
                      <span className="flex items-center gap-1"><ListOrdered className="h-3 w-3" />{recipe.ingredients.length} ингр. · {recipe.steps.length} шагов</span>
                      <span>👁 {recipe.views}</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setExpandedId(isExpanded ? null : recipe.id)}>
                      {isExpanded ? "▲" : "▼"}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleEdit(recipe)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => handleDelete(recipe.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t px-3 py-3 bg-muted/30 space-y-3">
                    {/* Ingredients */}
                    {recipe.ingredients.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold mb-1">Ингредиенты</div>
                        <div className="space-y-1">
                          {recipe.ingredients.map((ing, i) => (
                            <div key={i} className="text-sm flex justify-between">
                              <span>{ing.name}</span>
                              <span className="text-muted-foreground">{ing.amount} {ing.unit}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Steps */}
                    {recipe.steps.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold mb-1">Пошаговые инструкции</div>
                        <div className="space-y-2">
                          {recipe.steps.map((step, i) => (
                            <div key={i} className="flex gap-2">
                              <div className="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center flex-shrink-0">{i + 1}</div>
                              <div className="flex-1">
                                <div className="text-sm font-medium">{step.title}</div>
                                {step.description && <div className="text-xs text-muted-foreground">{step.description}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Tips */}
                    {recipe.tips && recipe.tips.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold mb-1">Советы</div>
                        <ul className="text-sm space-y-1">
                          {recipe.tips.map((tip, i) => <li key={i} className="text-muted-foreground">💡 {tip}</li>)}
                        </ul>
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
        <Dialog open onOpenChange={() => setShowModal(false)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Редактировать рецепт" : "Новый рецепт"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div><Label>Название *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Торт «Красный бархат»" /></div>
              <div><Label>Описание</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} placeholder="Краткое описание рецепта..." /></div>
              <div><Label>URL обложки</Label><Input value={form.coverImage} onChange={(e) => setForm({ ...form, coverImage: e.target.value })} placeholder="https://..." /></div>
              <div className="grid grid-cols-4 gap-2">
                <div><Label className="text-xs">Подготовка, мин</Label><Input type="number" value={form.prepTime || ""} onChange={(e) => setForm({ ...form, prepTime: parseInt(e.target.value) || 0 })} /></div>
                <div><Label className="text-xs">Готовка, мин</Label><Input type="number" value={form.cookTime || ""} onChange={(e) => setForm({ ...form, cookTime: parseInt(e.target.value) || 0 })} /></div>
                <div><Label className="text-xs">Сложность</Label>
                  <Select value={form.difficulty} onValueChange={(v) => setForm({ ...form, difficulty: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RECIPE_DIFFICULTIES.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Порций</Label><Input type="number" value={form.servings || ""} onChange={(e) => setForm({ ...form, servings: parseInt(e.target.value) || 1 })} /></div>
              </div>

              {/* Ingredients */}
              <div className="border-t pt-3">
                <Label className="font-semibold">Ингредиенты *</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={ingName} onChange={(e) => setIngName(e.target.value)} placeholder="Мука пшеничная" className="flex-1" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addIngredient())} />
                  <Input value={ingAmount} onChange={(e) => setIngAmount(e.target.value)} placeholder="200" className="w-20" />
                  <Select value={ingUnit} onValueChange={setIngUnit}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="г">г</SelectItem><SelectItem value="кг">кг</SelectItem>
                      <SelectItem value="мл">мл</SelectItem><SelectItem value="л">л</SelectItem>
                      <SelectItem value="шт">шт</SelectItem><SelectItem value="ч.л.">ч.л.</SelectItem>
                      <SelectItem value="ст.л.">ст.л.</SelectItem><SelectItem value="стакан">стакан</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" variant="outline" onClick={addIngredient}><Plus className="h-4 w-4" /></Button>
                </div>
                {form.ingredients.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {form.ingredients.map((ing, i) => (
                      <div key={i} className="flex items-center justify-between text-sm p-1.5 bg-muted/50 rounded">
                        <span>{ing.name}</span>
                        <span className="text-muted-foreground">{ing.amount} {ing.unit}</span>
                        <button onClick={() => setForm({ ...form, ingredients: form.ingredients.filter((_, j) => j !== i) })}><X className="h-3 w-3 text-destructive" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Steps */}
              <div className="border-t pt-3">
                <Label className="font-semibold">Пошаговые инструкции *</Label>
                <div className="space-y-2 mt-1">
                  <Input value={stepTitle} onChange={(e) => setStepTitle(e.target.value)} placeholder="Шаг: Приготовление бисквита" />
                  <Textarea value={stepDesc} onChange={(e) => setStepDesc(e.target.value)} rows={2} placeholder="Подробное описание шага..." />
                  <Button type="button" size="sm" variant="outline" onClick={addStep}><Plus className="h-4 w-4 mr-1" />Добавить шаг</Button>
                </div>
                {form.steps.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {form.steps.map((step, i) => (
                      <div key={i} className="flex gap-2 p-2 bg-muted/50 rounded">
                        <div className="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center flex-shrink-0">{i + 1}</div>
                        <div className="flex-1">
                          <div className="text-sm font-medium">{step.title}</div>
                          {step.description && <div className="text-xs text-muted-foreground">{step.description}</div>}
                        </div>
                        <button onClick={() => setForm({ ...form, steps: form.steps.filter((_, j) => j !== i) })}><X className="h-3 w-3 text-destructive" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tips */}
              <div className="border-t pt-3">
                <Label className="font-semibold">Советы</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={tipInput} onChange={(e) => setTipInput(e.target.value)} placeholder="Бисквит лучше печь накануне..." onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTip())} />
                  <Button type="button" size="sm" variant="outline" onClick={addTip}><Plus className="h-4 w-4" /></Button>
                </div>
                {form.tips.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {form.tips.map((tip, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm p-1.5 bg-muted/50 rounded">
                        <span>💡 {tip}</span>
                        <button className="ml-auto" onClick={() => setForm({ ...form, tips: form.tips.filter((_, j) => j !== i) })}><X className="h-3 w-3 text-destructive" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Access */}
              <div className="grid grid-cols-2 gap-2 border-t pt-3">
                <div><Label className="text-xs">Доступ</Label>
                  <Select value={form.access} onValueChange={(v) => setForm({ ...form, access: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Бесплатный</SelectItem>
                      <SelectItem value="paid">Платный</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.access === "paid" && (
                  <div><Label className="text-xs">Цена, ₽</Label><Input type="number" value={form.price || ""} onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) || 0 })} /></div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowModal(false)}>Отмена</Button>
              <Button onClick={handleSave}>{editingId ? "Сохранить" : "Опубликовать"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
