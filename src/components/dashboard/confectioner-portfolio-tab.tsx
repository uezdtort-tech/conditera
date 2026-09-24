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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Plus, Edit, Trash2, Star, Eye, Heart, X, Image as ImageIcon,
  Upload, Sparkles, TrendingUp, Package,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/finance";
import { CATEGORIES } from "@/lib/mock-data";
import { toast } from "sonner";
import type { ConfectionerWork } from "@/lib/types";

const EVENT_TYPES = [
  { id: "birthday", label: "🎂 День рождения" },
  { id: "wedding", label: "💍 Свадьба" },
  { id: "kids", label: "🧸 Детский праздник" },
  { id: "corporate", label: "🏢 Корпоратив" },
  { id: "romantic", label: "💕 Романтический" },
  { id: "anniversary", label: "🎉 Юбилей" },
  { id: "new_year", label: "🎄 Новый год" },
  { id: "just", label: "🍰 Без повода" },
];

export function ConfectionerPortfolioTab({ confectionerId, confectionerName, city }: {
  confectionerId: string;
  confectionerName: string;
  city: string;
}) {
  // ВАЖНО: читаем сырой массив + useMemo, иначе filter() создаёт новый массив → infinite re-render
  const allWorks = useAppStore((s) => s.confectionerWorks);
  const works = useMemo(
    () => allWorks.filter((w) => w.confectionerId === confectionerId),
    [allWorks, confectionerId]
  );
  const addWork = useAppStore((s) => s.addConfectionerWork);
  const updateWork = useAppStore((s) => s.updateConfectionerWork);
  const deleteWork = useAppStore((s) => s.deleteConfectionerWork);
  const toggleFeatured = useAppStore((s) => s.toggleWorkFeatured);
  const likeWork = useAppStore((s) => s.likeConfectionerWork);

  const [showForm, setShowForm] = useState(false);
  const [editingWork, setEditingWork] = useState<ConfectionerWork | null>(null);
  const [filter, setFilter] = useState<"all" | "published" | "draft" | "featured">("all");

  // Форма
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "cakes",
    images: [""] as string[],
    eventType: "birthday",
    weight: "",
    servings: 0,
    prepTime: "",
    price: 0,
    tags: "",
    fillings: "",
    featured: false,
    status: "published" as "draft" | "published",
  });

  const filtered = works.filter((w) => {
    if (filter === "all") return true;
    if (filter === "featured") return w.featured;
    return w.status === filter;
  });

  const resetForm = () => {
    setForm({
      title: "", description: "", category: "cakes", images: [""],
      eventType: "birthday", weight: "", servings: 0, prepTime: "", price: 0,
      tags: "", fillings: "", featured: false, status: "published",
    });
    setEditingWork(null);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (work: ConfectionerWork) => {
    setForm({
      title: work.title,
      description: work.description || "",
      category: work.category,
      images: (work.images || [""]).length > 0 ? (work.images || [""]) : [""],
      eventType: work.eventType || "birthday",
      weight: work.weight || "",
      servings: work.servings || 0,
      prepTime: work.prepTime || "",
      price: work.price || 0,
      tags: work.tags.join(", "),
      fillings: (work.fillings || []).join(", "),
      featured: work.featured,
      status: work.status === "archived" ? "draft" : work.status,
    });
    setEditingWork(work);
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error("Введите название работы");
      return;
    }
    const images = form.images.filter((i) => i.trim());
    if (images.length === 0) {
      toast.error("Добавьте хотя бы одно изображение");
      return;
    }

    const workData = {
      confectionerId,
      confectionerName,
      title: form.title.trim(),
      description: form.description.trim(),
      category: form.category,
      categoryLabel: CATEGORIES.find((c) => c.slug === form.category)?.name || form.category,
      images,
      mainImage: images[0],
      eventType: form.eventType,
      weight: form.weight || undefined,
      servings: form.servings || undefined,
      prepTime: form.prepTime || undefined,
      price: form.price || undefined,
      city,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      fillings: form.fillings.split(",").map((t) => t.trim()).filter(Boolean),
      featured: form.featured,
      status: form.status,
    };

    if (editingWork) {
      updateWork(editingWork.id, workData);
      toast.success("Работа обновлена");
    } else {
      addWork(workData);
      toast.success("Работа добавлена в портфолио");
    }
    setShowForm(false);
    resetForm();
  };

  const handleDelete = (id: string, title: string) => {
    if (confirm(`Удалить работу «${title}»?`)) {
      deleteWork(id);
      toast.success("Работа удалена");
    }
  };

  const handleToggleFeatured = (id: string, current: boolean) => {
    toggleFeatured(id);
    toast.success(current ? "Убрано из карусели" : "Добавлено в карусель на главной");
  };

  // Статистика
  const totalLikes = works.reduce((s, w) => s + w.likes, 0);
  const totalViews = works.reduce((s, w) => s + w.views, 0);
  const featuredCount = works.filter((w) => w.featured).length;

  return (
    <div className="space-y-4">
      {/* Заголовок + кнопка */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" />
            Портфолио работ
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Загружайте фото ваших работ — они появятся в портфолио и в карусели на главной
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Добавить работу
        </Button>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <Package className="h-5 w-5 text-primary mb-1" />
          <div className="text-2xl font-bold">{works.length}</div>
          <div className="text-xs text-muted-foreground">Всего работ</div>
        </Card>
        <Card className="p-3">
          <Sparkles className="h-5 w-5 text-amber-500 mb-1" />
          <div className="text-2xl font-bold text-amber-600">{featuredCount}</div>
          <div className="text-xs text-muted-foreground">В карусели</div>
        </Card>
        <Card className="p-3">
          <Heart className="h-5 w-5 text-rose-500 mb-1" />
          <div className="text-2xl font-bold text-rose-600">{totalLikes}</div>
          <div className="text-xs text-muted-foreground">Лайков</div>
        </Card>
        <Card className="p-3">
          <Eye className="h-5 w-5 text-blue-500 mb-1" />
          <div className="text-2xl font-bold text-blue-600">{totalViews}</div>
          <div className="text-xs text-muted-foreground">Просмотров</div>
        </Card>
      </div>

      {/* Фильтры */}
      <div className="flex gap-1">
        {[
          { id: "all", l: `Все (${works.length})` },
          { id: "published", l: `Опубл. (${works.filter((w) => w.status === "published").length})` },
          { id: "draft", l: `Черновики (${works.filter((w) => w.status === "draft").length})` },
          { id: "featured", l: `В карусели (${featuredCount})` },
        ].map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "default" : "outline"}
            onClick={() => setFilter(f.id as typeof filter)}
          >
            {f.l}
          </Button>
        ))}
      </div>

      {/* Сетка работ */}
      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">Пока нет работ</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Загрузите фото своих лучших работ, чтобы привлечь покупателей
          </p>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Добавить первую работу
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((work) => (
            <Card key={work.id} className="overflow-hidden group">
              <div className="relative aspect-square bg-muted">
                <img
                  src={work.mainImage}
                  alt={work.title}
                  className="w-full h-full object-cover" loading="lazy" decoding="async" />
                {/* Оверлей с действиями */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1">
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8"
                    onClick={() => openEdit(work)}
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    className={`h-8 w-8 ${work.featured ? "bg-amber-500 text-white" : ""}`}
                    onClick={() => handleToggleFeatured(work.id, work.featured)}
                    title={work.featured ? "Убрать из карусели" : "Добавить в карусель"}
                  >
                    <Star className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8 text-destructive"
                    onClick={() => handleDelete(work.id, work.title)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {/* Бейджи */}
                <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
                  {work.featured && (
                    <Badge className="bg-amber-500 text-white text-[9px]">
                      <Sparkles className="h-2.5 w-2.5 mr-0.5" />Карусель
                    </Badge>
                  )}
                  {work.status === "draft" && (
                    <Badge variant="secondary" className="text-[9px]">Черновик</Badge>
                  )}
                </div>
                {/* Метрики */}
                <div className="absolute top-1.5 right-1.5 flex flex-col gap-1">
                  <Badge variant="secondary" className="bg-black/60 text-white text-[9px]">
                    <Heart className="h-2.5 w-2.5 mr-0.5" />{work.likes}
                  </Badge>
                  <Badge variant="secondary" className="bg-black/60 text-white text-[9px]">
                    <Eye className="h-2.5 w-2.5 mr-0.5" />{work.views}
                  </Badge>
                </div>
              </div>
              <div className="p-2.5">
                <h3 className="font-medium text-xs line-clamp-1">{work.title}</h3>
                <div className="flex items-center justify-between mt-1">
                  <Badge variant="outline" className="text-[9px]">{work.categoryLabel}</Badge>
                  {work.price ? (
                    <span className="text-xs font-bold text-primary">{formatCurrency(work.price)}</span>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Модальное окно формы */}
      <Dialog open={showForm} onOpenChange={(open) => { setShowForm(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingWork ? "Редактировать работу" : "Новая работа"}</DialogTitle>
            <DialogDescription>
              {editingWork ? "Измените данные работы" : "Загрузите фото работы, чтобы она появилась в портфолио"}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Название */}
            <div>
              <Label htmlFor="title">Название *</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Свадебный торт «Романтика»"
                required
              />
            </div>

            {/* Категория + тип события */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Категория</Label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full h-10 rounded-md border border-border bg-card px-3 text-sm"
                >
                  {CATEGORIES.filter((c) => c.group === "Кондитерские изделия").map((c) => (
                    <option key={c.slug} value={c.slug}>{c.icon} {c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Тип события</Label>
                <select
                  value={form.eventType}
                  onChange={(e) => setForm({ ...form, eventType: e.target.value })}
                  className="w-full h-10 rounded-md border border-border bg-card px-3 text-sm"
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Описание */}
            <div>
              <Label>Описание</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                placeholder="Кратко опишите работу: использованные ингредиенты, технику, особенности декора..."
              />
            </div>

            {/* Изображения */}
            <div>
              <Label>Изображения (URL) *</Label>
              <div className="space-y-1.5">
                {form.images.map((img, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={img}
                      onChange={(e) => {
                        const images = [...form.images];
                        images[i] = e.target.value;
                        setForm({ ...form, images });
                      }}
                      placeholder="https://..."
                      className="flex-1"
                    />
                    {form.images.length > 1 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => setForm({ ...form, images: form.images.filter((_, idx) => idx !== i) })}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setForm({ ...form, images: [...form.images, ""] })}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />Добавить изображение
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Первое изображение будет главным. Максимум 8 фото.
              </p>
            </div>

            {/* Характеристики */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div>
                <Label>Вес</Label>
                <Input
                  value={form.weight}
                  onChange={(e) => setForm({ ...form, weight: e.target.value })}
                  placeholder="1.5 кг"
                />
              </div>
              <div>
                <Label>Порций</Label>
                <Input
                  type="number"
                  value={form.servings || ""}
                  onChange={(e) => setForm({ ...form, servings: +e.target.value })}
                  placeholder="12"
                />
              </div>
              <div>
                <Label>Срок</Label>
                <Input
                  value={form.prepTime}
                  onChange={(e) => setForm({ ...form, prepTime: e.target.value })}
                  placeholder="2 дня"
                />
              </div>
              <div>
                <Label>Цена, ₽</Label>
                <Input
                  type="number"
                  value={form.price || ""}
                  onChange={(e) => setForm({ ...form, price: +e.target.value })}
                  placeholder="2800"
                />
              </div>
            </div>

            {/* Теги + начинки */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Теги (через запятую)</Label>
                <Input
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="свадебный, 3 яруса, живые цветы"
                />
              </div>
              <div>
                <Label>Начинки (через запятую)</Label>
                <Input
                  value={form.fillings}
                  onChange={(e) => setForm({ ...form, fillings: e.target.value })}
                  placeholder="Ваниль, Шоколад, Маскарпоне"
                />
              </div>
            </div>

            {/* Опции */}
            <div className="flex flex-wrap gap-4 p-3 rounded-lg border border-border">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.featured}
                  onChange={(e) => setForm({ ...form, featured: e.target.checked })}
                  className="w-4 h-4 accent-primary"
                />
                <Sparkles className="h-4 w-4 text-amber-500" />
                Показать в карусели на главной
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.status === "published"}
                  onChange={(e) => setForm({ ...form, status: e.target.checked ? "published" : "draft" })}
                  className="w-4 h-4 accent-primary"
                />
                Опубликовать
              </label>
            </div>

            {/* Кнопки */}
            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1">
                {editingWork ? "Сохранить" : "Добавить в портфолио"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Отмена
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
