"use client";

import { useAppStore } from "@/lib/store";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Check,
  Star,
  Image as ImageIcon,
  Settings,
  LayoutDashboard,
  MessageSquare,
  Flag,
  Eye,
  EyeOff,
  GripVertical,
  AlertTriangle,
  Gift,
  Loader2,
} from "lucide-react";
import { SETTING_CATEGORIES } from "@/lib/mock-data-cms";
import { formatDate } from "@/lib/finance";
import { toast } from "sonner";

// ==================== CMS: РЕДАКТОР ГЛАВНОЙ СТРАНИЦЫ ====================
export function AdminCmsHomeTab() {
  const cmsBlocks = useAppStore((s) => s.cmsBlocks);
  const updateCmsBlock = useAppStore((s) => s.updateCmsBlock);
  const addCmsBlock = useAppStore((s) => s.addCmsBlock);
  const deleteCmsBlock = useAppStore((s) => s.deleteCmsBlock);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<any>({});

  const sections = [
    { key: "hero", label: "Hero (главный баннер)", icon: "🎯" },
    { key: "stats", label: "Статистика", icon: "📊" },
    { key: "cta_confectioner", label: "CTA для кондитеров", icon: "📢" },
    { key: "advantages", label: "Преимущества", icon: "⭐" },
    { key: "steps", label: "Шаги заказа", icon: "📋" },
    { key: "testimonials", label: "Отзывы", icon: "💬" },
  ];

  const startEdit = (block: any) => {
    setEditingId(block.id);
    setEditValues({ ...block });
  };

  const saveEdit = () => {
    updateCmsBlock(editingId!, editValues);
    toast.success("Блок обновлён!");
    setEditingId(null);
    setEditValues({});
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <LayoutDashboard className="h-6 w-6 text-primary" />
          Главная страница — CMS
        </h1>
        <p className="text-sm text-muted-foreground">
          Редактируйте секции главной страницы без кода. Изменения применяются мгновенно.
        </p>
      </div>

      {/* Блоки по секциям */}
      {sections.map((section) => {
        const blocks = cmsBlocks.filter((b) => b.section === section.key);
        return (
          <Card key={section.key} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <span>{section.icon}</span>
                {section.label}
                <Badge variant="secondary" className="text-[10px]">{blocks.length}</Badge>
              </h3>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  addCmsBlock({
                    pageId: null,
                    section: section.key,
                    title: "Новый блок",
                    subtitle: "",
                    content: "",
                    image: "",
                    link: "",
                    linkText: "",
                    sortOrder: blocks.length,
                    isActive: true,
                    metadata: "{}",
                    updatedBy: "admin@demo.ru",
                  });
                  toast.success("Блок добавлен!");
                }}
              >
                <Plus className="h-3 w-3 mr-1" /> Добавить
              </Button>
            </div>

            <div className="space-y-2">
              {blocks.map((block) => (
                <div key={block.id} className="border border-border rounded-lg p-3">
                  {editingId === block.id ? (
                    /* Режим редактирования */
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Заголовок</Label>
                          <Input
                            value={editValues.title || ""}
                            onChange={(e) => setEditValues({ ...editValues, title: e.target.value })}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Ссылка (view)</Label>
                          <Input
                            value={editValues.link || ""}
                            onChange={(e) => setEditValues({ ...editValues, link: e.target.value })}
                            className="h-8 text-sm"
                            placeholder="catalog, promotions..."
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">Подзаголовок</Label>
                        <Textarea
                          value={editValues.subtitle || ""}
                          onChange={(e) => setEditValues({ ...editValues, subtitle: e.target.value })}
                          rows={2}
                          className="text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Изображение (URL)</Label>
                        <Input
                          value={editValues.image || ""}
                          onChange={(e) => setEditValues({ ...editValues, image: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Текст кнопки</Label>
                        <Input
                          value={editValues.linkText || ""}
                          onChange={(e) => setEditValues({ ...editValues, linkText: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveEdit}><Save className="h-3 w-3 mr-1" /> Сохранить</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Отмена</Button>
                        <label className="flex items-center gap-1 text-xs cursor-pointer ml-auto">
                          <Checkbox
                            checked={editValues.isActive}
                            onCheckedChange={(v) => setEditValues({ ...editValues, isActive: !!v })}
                          />
                          Активен
                        </label>
                      </div>
                    </div>
                  ) : (
                    /* Режим просмотра */
                    <div className="flex items-start gap-3">
                      {block.image && (
                        <img src={block.image} alt="" className="h-12 w-12 rounded object-cover shrink-0" loading="lazy" decoding="async" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm flex items-center gap-2">
                          {block.title || "(без заголовка)"}
                          {!block.isActive && <Badge variant="outline" className="text-[9px]">Скрыт</Badge>}
                        </div>
                        {block.subtitle && (
                          <div className="text-xs text-muted-foreground line-clamp-1">{block.subtitle}</div>
                        )}
                        {block.linkText && (
                          <Badge variant="secondary" className="text-[9px] mt-1">{block.linkText} → {block.link}</Badge>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(block)}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => {
                            updateCmsBlock(block.id, { isActive: !block.isActive });
                            toast.success(block.isActive ? "Скрыт" : "Показан");
                          }}
                        >
                          {block.isActive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          onClick={() => {
                            deleteCmsBlock(block.id);
                            toast.success("Удалён");
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {blocks.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-2">Нет блоков в этой секции</div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ==================== CMS: БАННЕРЫ ====================
export function AdminBannersTab() {
  const banners = useAppStore((s) => s.banners);
  const updateBanner = useAppStore((s) => s.updateBanner);
  const addBanner = useAppStore((s) => s.addBanner);
  const deleteBanner = useAppStore((s) => s.deleteBanner);
  const [showAdd, setShowAdd] = useState(false);
  const [newBanner, setNewBanner] = useState({
    title: "",
    subtitle: "",
    image: "",
    link: "",
    buttonText: "",
    position: "hero",
    isActive: true,
    sortOrder: 0,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <ImageIcon className="h-6 w-6 text-primary" />
            Баннеры
          </h1>
          <p className="text-sm text-muted-foreground">Управление баннерами на главной и в каталоге</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-1" /> Добавить</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {banners.map((banner) => (
          <Card key={banner.id} className={`overflow-hidden p-0 ${!banner.isActive ? "opacity-50" : ""}`}>
            <div className="relative aspect-video bg-muted">
              {banner.image && <img src={banner.image} alt={banner.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-2 left-3 right-3">
                <div className="font-semibold text-white text-sm line-clamp-1">{banner.title}</div>
                <div className="text-xs text-white/80 line-clamp-1">{banner.subtitle}</div>
              </div>
              <Badge className={`absolute top-2 right-2 ${banner.isActive ? "bg-emerald-500" : "bg-slate-500"} text-white text-[9px]`}>
                {banner.isActive ? "Активен" : "Скрыт"}
              </Badge>
            </div>
            <div className="p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <Badge variant="outline" className="text-[10px]">{banner.position}</Badge>
                {banner.startDate && <span>с {formatDate(banner.startDate)}</span>}
                {banner.endDate && <span>до {formatDate(banner.endDate)}</span>}
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs"
                  onClick={() => {
                    updateBanner(banner.id, { isActive: !banner.isActive });
                    toast.success(banner.isActive ? "Скрыт" : "Показан");
                  }}
                >
                  {banner.isActive ? <><EyeOff className="h-3 w-3 mr-1" /> Скрыть</> : <><Eye className="h-3 w-3 mr-1" /> Показать</>}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive text-xs"
                  onClick={() => { deleteBanner(banner.id); toast.success("Удалён"); }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {showAdd && (
        <Dialog open onOpenChange={setShowAdd}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Новый баннер</DialogTitle>
              <DialogDescription>Баннер появится на главной или в каталоге</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <div><Label>Заголовок *</Label><Input value={newBanner.title} onChange={(e) => setNewBanner({ ...newBanner, title: e.target.value })} /></div>
              <div><Label>Подзаголовок</Label><Input value={newBanner.subtitle} onChange={(e) => setNewBanner({ ...newBanner, subtitle: e.target.value })} /></div>
              <div><Label>URL изображения *</Label><Input value={newBanner.image} onChange={(e) => setNewBanner({ ...newBanner, image: e.target.value })} placeholder="https://..." /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Ссылка (view)</Label><Input value={newBanner.link} onChange={(e) => setNewBanner({ ...newBanner, link: e.target.value })} placeholder="catalog" /></div>
                <div><Label>Текст кнопки</Label><Input value={newBanner.buttonText} onChange={(e) => setNewBanner({ ...newBanner, buttonText: e.target.value })} /></div>
              </div>
              <div>
                <Label>Позиция</Label>
                <Select value={newBanner.position} onValueChange={(v) => setNewBanner({ ...newBanner, position: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hero">Hero (главная)</SelectItem>
                    <SelectItem value="top">Верхний баннер</SelectItem>
                    <SelectItem value="category">В каталоге</SelectItem>
                    <SelectItem value="sidebar">Сайдбар</SelectItem>
                    <SelectItem value="footer">Подвал</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAdd(false)}>Отмена</Button>
              <Button
                disabled={!newBanner.title || !newBanner.image}
                onClick={() => {
                  addBanner(newBanner);
                  toast.success("Баннер добавлен!");
                  setShowAdd(false);
                  setNewBanner({ title: "", subtitle: "", image: "", link: "", buttonText: "", position: "hero", isActive: true, sortOrder: 0 });
                }}
              >Добавить</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ==================== CMS: СТРАНИЦЫ (FAQ, О нас, Условия) ====================
export function AdminCmsPagesTab() {
  const cmsPages = useAppStore((s) => s.cmsPages);
  const updateCmsPage = useAppStore((s) => s.updateCmsPage);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<any>({});

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Edit className="h-6 w-6 text-primary" />
          Страницы сайта
        </h1>
        <p className="text-sm text-muted-foreground">Редактируйте тексты страниц: О нас, FAQ, Условия, Конфиденциальность</p>
      </div>

      <div className="space-y-3">
        {cmsPages.map((page) => (
          <Card key={page.id} className="p-4">
            {editingId === page.id ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline">/{page.slug}</Badge>
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => {
                      updateCmsPage(editingId!, editValues);
                      toast.success("Страница сохранена!");
                      setEditingId(null);
                    }}><Save className="h-3 w-3 mr-1" /> Сохранить</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Отмена</Button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Заголовок</Label>
                  <Input value={editValues.title || ""} onChange={(e) => setEditValues({ ...editValues, title: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">SEO Title</Label>
                  <Input value={editValues.seoTitle || ""} onChange={(e) => setEditValues({ ...editValues, seoTitle: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">SEO Description</Label>
                  <Input value={editValues.seoDescription || ""} onChange={(e) => setEditValues({ ...editValues, seoDescription: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Контент (Markdown с WYSIWYG-редактором)</Label>
                  <MarkdownEditor
                    value={editValues.content || ""}
                    onChange={(markdown) => setEditValues({ ...editValues, content: markdown })}
                    minHeight={400}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={editValues.isPublished}
                    onCheckedChange={(v) => setEditValues({ ...editValues, isPublished: !!v })}
                  />
                  Опубликовано
                </label>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm flex items-center gap-2">
                    {page.title}
                    <Badge variant="outline" className="text-[10px]">/{page.slug}</Badge>
                    {page.isPublished ? (
                      <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">Опубликована</Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-800 text-[10px]">Черновик</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {page.content?.slice(0, 150)}...
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Обновлено: {formatDate(page.updatedAt)} • {page.updatedBy}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingId(page.id);
                    setEditValues({ ...page });
                  }}
                >
                  <Edit className="h-3 w-3 mr-1" /> Редактировать
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ==================== CMS: НАСТРОЙКИ САЙТА ====================
export function AdminSettingsTab() {
  const siteSettings = useAppStore((s) => s.siteSettings);
  const updateSiteSetting = useAppStore((s) => s.updateSiteSetting);
  const [activeCategory, setActiveCategory] = useState("general");
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [promoEnabled, setPromoEnabled] = useState(false);
  const [promoLoading, setPromoLoading] = useState(false);

  // Загружаем статус промо-попапа
  useEffect(() => {
    fetch("/api/admin/promo-popup")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setPromoEnabled(data.enabled); })
      .catch(() => {});
  }, []);

  const handleTogglePromo = async () => {
    setPromoLoading(true);
    try {
      const res = await fetch("/api/admin/promo-popup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !promoEnabled }),
      });
      if (res.ok) {
        setPromoEnabled(!promoEnabled);
        toast.success(`Промо-попап ${!promoEnabled ? "включён" : "выключен"}`);
      }
    } catch {
      toast.error("Ошибка");
    } finally {
      setPromoLoading(false);
    }
  };

  const filtered = siteSettings.filter((s) => s.category === activeCategory);

  const handleSave = (key: string) => {
    if (editValues[key] !== undefined) {
      updateSiteSetting(key, editValues[key]);
      toast.success(`Настройка «${key}» обновлена!`);
      const newValues = { ...editValues };
      delete newValues[key];
      setEditValues(newValues);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Settings className="h-6 w-6 text-primary" />
          Настройки сайта
        </h1>
        <p className="text-sm text-muted-foreground">Комиссии, тарифы, доставка, SEO, контакты — всё в одном месте</p>
      </div>

      {/* Управление промо-попапом */}
      <Card className={`p-4 ${promoEnabled ? "border-emerald-300 bg-emerald-50/30" : "border-muted"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${promoEnabled ? "bg-emerald-100" : "bg-muted"}`}>
              <Gift className={`h-5 w-5 ${promoEnabled ? "text-emerald-600" : "text-muted-foreground"}`} />
            </div>
            <div>
              <div className="font-semibold text-sm">Промо-попап на главной</div>
              <div className="text-xs text-muted-foreground">
                {promoEnabled
                  ? "Включён — показывается пользователям через 5 сек после загрузки"
                  : "Выключен — попап не показывается"}
              </div>
            </div>
          </div>
          <Button
            onClick={handleTogglePromo}
            disabled={promoLoading}
            variant={promoEnabled ? "destructive" : "default"}
            size="sm"
            className="gap-2"
          >
            {promoLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : promoEnabled ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {promoEnabled ? "Выключить" : "Включить"}
          </Button>
        </div>
      </Card>

      {/* Категории */}
      <div className="flex flex-wrap gap-2">
        {SETTING_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-3 py-1.5 text-xs rounded-full border flex items-center gap-1 ${
              activeCategory === cat.id
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border hover:border-primary/40"
            }`}
          >
            <span>{cat.icon}</span>
            {cat.label}
          </button>
        ))}
      </div>

      {/* Настройки */}
      <Card className="p-4">
        <div className="space-y-2">
          {filtered.map((setting) => (
            <div key={setting.id} className="flex items-center gap-3 p-2 border border-border rounded">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{setting.description}</div>
                <div className="text-[10px] text-muted-foreground font-mono">{setting.key}</div>
              </div>
              <Input
                value={editValues[setting.key] !== undefined ? editValues[setting.key] : setting.value}
                onChange={(e) => setEditValues({ ...editValues, [setting.key]: e.target.value })}
                className="w-40 h-8 text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => handleSave(setting.key)}
                disabled={editValues[setting.key] === undefined}
              >
                <Save className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ==================== CMS: МОДЕРАЦИЯ ОТЗЫВОВ ====================
export function AdminReviewsModerationTab() {
  const reviews = useAppStore((s) => s.reviewsModeration);
  const approveReview = useAppStore((s) => s.approveReview);
  const rejectReview = useAppStore((s) => s.rejectReview);
  const [filter, setFilter] = useState<string>("all");

  const filtered = reviews.filter((r) => filter === "all" || r.status === filter);
  const pendingCount = reviews.filter((r) => r.status === "pending").length;
  const flaggedCount = reviews.filter((r) => r.status === "flagged").length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-primary" />
          Модерация отзывов
        </h1>
        <p className="text-sm text-muted-foreground">Одобряйте или отклоняйте отзывы покупателей</p>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Ожидают</div>
          <div className="font-display text-xl font-bold text-amber-600">{pendingCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Жалобы</div>
          <div className="font-display text-xl font-bold text-red-600">{flaggedCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Всего</div>
          <div className="font-display text-xl font-bold">{reviews.length}</div>
        </Card>
      </div>

      {/* Фильтры */}
      <div className="flex gap-2">
        {[
          { id: "all", label: "Все" },
          { id: "pending", label: `Ожидают (${pendingCount})` },
          { id: "flagged", label: `Жалобы (${flaggedCount})` },
          { id: "approved", label: "Одобрены" },
          { id: "rejected", label: "Отклонены" },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1 text-xs rounded-full border ${
              filter === f.id ? "bg-primary text-primary-foreground border-primary" : "border-border"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Отзывы */}
      <div className="space-y-3">
        {filtered.map((review) => (
          <Card key={review.id} className={`p-4 ${review.status === "flagged" ? "border-red-300 bg-red-50/30" : ""}`}>
            <div className="flex items-start gap-3">
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={review.userAvatar} alt={review.userName} />
                <AvatarFallback>{review.userName?.[0] || "?"}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{review.userName}</span>
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className={`h-3 w-3 ${i < review.rating ? "fill-amber-400 text-amber-400" : "text-border"}`} />
                    ))}
                  </div>
                  <Badge variant="outline" className="text-[10px]">{review.productName}</Badge>
                  {review.status === "pending" && <Badge className="bg-amber-100 text-amber-800 text-[10px]">Ожидает</Badge>}
                  {review.status === "flagged" && <Badge className="bg-red-100 text-red-800 text-[10px]"><Flag className="h-2.5 w-2.5 mr-0.5" />Жалоба</Badge>}
                  {review.status === "approved" && <Badge className="bg-emerald-100 text-emerald-800 text-[10px]"><Check className="h-2.5 w-2.5 mr-0.5" />Одобрен</Badge>}
                  {review.status === "rejected" && <Badge className="bg-slate-100 text-slate-800 text-[10px]">Отклонён</Badge>}
                </div>
                <p className="text-sm text-muted-foreground mb-2">«{review.text}»</p>
                {review.flagReason && (
                  <div className="text-xs text-red-600 flex items-center gap-1 mb-2">
                    <AlertTriangle className="h-3 w-3" /> Причина жалобы: {review.flagReason}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground mb-2">{formatDate(review.createdAt)}</div>
                {(review.status === "pending" || review.status === "flagged") && (
                  <div className="flex gap-2">
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { approveReview(review.id); toast.success("Отзыв одобрен и опубликован"); }}>
                      <Check className="h-3 w-3 mr-1" /> Одобрить
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => { rejectReview(review.id, "Нарушение правил"); toast.success("Отзыв отклонён"); }}>
                      <X className="h-3 w-3 mr-1" /> Отклонить
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <Card className="p-12 text-center">
          <Check className="h-10 w-10 mx-auto mb-3 text-emerald-500" />
          <h3 className="font-semibold">Всё чисто!</h3>
          <p className="text-sm text-muted-foreground">Нет отзывов на модерацию в этой категории</p>
        </Card>
      )}
    </div>
  );
}

// ==================== CMS: НАВИГАЦИЯ ====================
export function AdminNavMenuTab() {
  const navMenu = useAppStore((s) => s.navMenu);
  const updateNavMenu = useAppStore((s) => s.updateNavMenu);
  const [items, setItems] = useState(navMenu);

  const toggleActive = (id: string) => {
    const updated = items.map((i) => i.id === id ? { ...i, isActive: !i.isActive } : i);
    setItems(updated);
    updateNavMenu(updated);
    toast.success("Обновлено");
  };

  const updateLabel = (id: string, label: string) => {
    const updated = items.map((i) => i.id === id ? { ...i, label } : i);
    setItems(updated);
  };

  const saveAll = () => {
    updateNavMenu(items);
    toast.success("Меню навигации сохранено!");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            Навигация
          </h1>
          <p className="text-sm text-muted-foreground">Управление пунктами меню в шапке сайта</p>
        </div>
        <Button onClick={saveAll}><Save className="h-4 w-4 mr-1" /> Сохранить</Button>
      </div>

      <Card className="p-4">
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={item.id} className="flex items-center gap-3 p-2 border border-border rounded">
              <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-[10px] text-muted-foreground w-4">{i + 1}</span>
              <Input
                value={item.label}
                onChange={(e) => updateLabel(item.id, e.target.value)}
                className="w-40 h-8 text-sm"
              />
              <Badge variant="outline" className="text-[10px]">{item.link}</Badge>
              <label className="flex items-center gap-1 text-xs cursor-pointer ml-auto">
                <Checkbox
                  checked={item.isActive}
                  onCheckedChange={() => toggleActive(item.id)}
                />
                {item.isActive ? "Показан" : "Скрыт"}
              </label>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Перетаскивание для изменения порядка — в разработке. Используйте sortOrder для ручной сортировки.
        </p>
      </Card>
    </div>
  );
}
