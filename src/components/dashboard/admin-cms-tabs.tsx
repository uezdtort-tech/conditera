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
import { csrfFetch } from "@/lib/api-client";

// ==================== CMS: РЕДАКТОР ГЛАВНОЙ СТРАНИЦЫ ====================
type CmsHomeBlock = {
  id: string;
  section: string;
  title: string;
  subtitle: string;
  content: string;
  image: string;
  link: string;
  linkText: string;
  sortOrder: number;
  isActive: boolean;
  metadata: Record<string, unknown>;
};

const CMS_HOME_SECTIONS = [
  { key: "hero", label: "Hero (главный баннер)", icon: "🎯" },
  { key: "stats", label: "Статистика", icon: "📊" },
  { key: "cta_confectioner", label: "CTA для кондитеров", icon: "📢" },
  { key: "advantages", label: "Преимущества", icon: "⭐" },
  { key: "steps", label: "Шаги заказа", icon: "📋" },
  { key: "testimonials", label: "Отзывы", icon: "💬" },
] as const;

function mapCmsHomeBlock(row: Record<string, unknown>): CmsHomeBlock {
  return {
    id: String(row.id),
    section: String(row.section),
    title: String(row.title || ""),
    subtitle: String(row.subtitle || ""),
    content: String(row.content || ""),
    image: String(row.image_url || ""),
    link: String(row.link_url || ""),
    linkText: String(row.link_text || ""),
    sortOrder: Number(row.sort_order || 0),
    isActive: row.is_active !== false,
    metadata: (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>,
  };
}

export function AdminCmsHomeTab() {
  const [cmsBlocks, setCmsBlocks] = useState<CmsHomeBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<CmsHomeBlock>>({});

  const loadBlocks = async (signal?: AbortSignal) => {
    const response = await fetch("/api/cms/blocks", { credentials: "include", signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Не удалось загрузить блоки");
    setCmsBlocks(Array.isArray(payload.blocks) ? payload.blocks.map(mapCmsHomeBlock) : []);
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadBlocks(controller.signal)
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") toast.error("Ошибка CMS", { description: error.message });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const saveEdit = async () => {
    if (!editingId || saving) return;
    setSaving(true);
    try {
      const response = await csrfFetch(`/api/cms/blocks/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: editValues.title,
          subtitle: editValues.subtitle,
          image: editValues.image,
          link: editValues.link,
          linkText: editValues.linkText,
          isActive: editValues.isActive,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить блок");
      const saved = mapCmsHomeBlock(payload.block);
      setCmsBlocks((current) => current.map((block) => block.id === saved.id ? saved : block));
      setEditingId(null);
      setEditValues({});
      toast.success("Блок сохранён в базе данных");
    } catch (error) {
      toast.error("Ошибка сохранения", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally {
      setSaving(false);
    }
  };

  const addBlock = async (section: string, sortOrder: number) => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await csrfFetch("/api/cms/blocks", {
        method: "POST",
        body: JSON.stringify({
          section, title: "Новый блок", subtitle: "", content: "",
          image: "", link: "", linkText: "", sortOrder, isActive: true,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось создать блок");
      setCmsBlocks((current) => [...current, mapCmsHomeBlock(payload.block)]);
      toast.success("Блок создан и сохранён");
    } catch (error) {
      toast.error("Ошибка создания", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally {
      setSaving(false);
    }
  };

  const updateBlock = async (block: CmsHomeBlock, updates: Partial<CmsHomeBlock>) => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await csrfFetch(`/api/cms/blocks/${block.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: updates.isActive }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось обновить блок");
      const saved = mapCmsHomeBlock(payload.block);
      setCmsBlocks((current) => current.map((item) => item.id === saved.id ? saved : item));
      toast.success(saved.isActive ? "Блок опубликован" : "Блок скрыт");
    } catch (error) {
      toast.error("Ошибка обновления", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally {
      setSaving(false);
    }
  };

  const removeBlock = async (block: CmsHomeBlock) => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await csrfFetch(`/api/cms/blocks/${block.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось удалить блок");
      setCmsBlocks((current) => current.filter((item) => item.id !== block.id));
      toast.success("Блок удалён");
    } catch (error) {
      toast.error("Ошибка удаления", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <LayoutDashboard className="h-6 w-6 text-primary" />
          Главная страница — CMS
        </h1>
        <p className="text-sm text-muted-foreground">
          Управление содержимым главной страницы. Изменения сохраняются в PostgreSQL и не теряются после перезагрузки.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка блоков CMS…
        </div>
      ) : CMS_HOME_SECTIONS.map((section) => {
        const blocks = cmsBlocks.filter((block) => block.section === section.key);
        return (
          <Card key={section.key} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <span>{section.icon}</span>
                {section.label}
                <Badge variant="secondary" className="text-[10px]">{blocks.length}</Badge>
              </h3>
              <Button size="sm" variant="outline" disabled={saving} onClick={() => addBlock(section.key, blocks.length)}>
                <Plus className="h-3 w-3 mr-1" /> Добавить
              </Button>
            </div>
            <div className="space-y-2">
              {blocks.map((block) => (
                <div key={block.id} className="border border-border rounded-lg p-3">
                  {editingId === block.id ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Заголовок</Label>
                          <Input value={editValues.title || ""} onChange={(e) => setEditValues({ ...editValues, title: e.target.value })} className="h-8 text-sm" maxLength={180} />
                        </div>
                        <div>
                          <Label className="text-xs">Ссылка</Label>
                          <Input value={editValues.link || ""} onChange={(e) => setEditValues({ ...editValues, link: e.target.value })} className="h-8 text-sm" placeholder="/catalog" />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">Подзаголовок</Label>
                        <Textarea value={editValues.subtitle || ""} onChange={(e) => setEditValues({ ...editValues, subtitle: e.target.value })} rows={2} className="text-sm" maxLength={500} />
                      </div>
                      <div>
                        <Label className="text-xs">Изображение (URL)</Label>
                        <Input value={editValues.image || ""} onChange={(e) => setEditValues({ ...editValues, image: e.target.value })} className="h-8 text-sm" />
                      </div>
                      <div>
                        <Label className="text-xs">Текст кнопки</Label>
                        <Input value={editValues.linkText || ""} onChange={(e) => setEditValues({ ...editValues, linkText: e.target.value })} className="h-8 text-sm" maxLength={100} />
                      </div>
                      <div className="flex gap-2 items-center">
                        <Button size="sm" disabled={saving} onClick={saveEdit}><Save className="h-3 w-3 mr-1" /> Сохранить</Button>
                        <Button size="sm" variant="outline" disabled={saving} onClick={() => { setEditingId(null); setEditValues({}); }}>Отмена</Button>
                        <label className="flex items-center gap-1 text-xs cursor-pointer ml-auto">
                          <Checkbox checked={!!editValues.isActive} onCheckedChange={(value) => setEditValues({ ...editValues, isActive: !!value })} />
                          Активен
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      {block.image && <img src={block.image} alt="" className="h-12 w-12 rounded object-cover shrink-0" loading="lazy" decoding="async" />}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm flex items-center gap-2">
                          {block.title || "(без заголовка)"}
                          {!block.isActive && <Badge variant="outline" className="text-[9px]">Скрыт</Badge>}
                        </div>
                        {block.subtitle && <div className="text-xs text-muted-foreground line-clamp-1">{block.subtitle}</div>}
                        {block.linkText && <Badge variant="secondary" className="text-[9px] mt-1">{block.linkText} → {block.link}</Badge>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={saving} onClick={() => { setEditingId(block.id); setEditValues({ ...block }); }}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={saving} onClick={() => updateBlock(block, { isActive: !block.isActive })}>
                          {block.isActive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={saving} onClick={() => removeBlock(block)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {blocks.length === 0 && <div className="text-xs text-muted-foreground text-center py-2">Нет блоков в этой секции</div>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ==================== CMS: БАННЕРЫ ====================
type CmsBannerRecord = {
  id: string;
  title: string;
  image_url: string | null;
  link_url: string | null;
  position: string;
  text: string | null;
  cta_text: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  sort_order: number;
};

const BANNER_POSITIONS = [
  { value: "home_hero", label: "Главная — Hero" },
  { value: "catalog_top", label: "Верх каталога" },
  { value: "sidebar", label: "Сайдбар" },
  { value: "footer", label: "Подвал" },
  { value: "mobile", label: "Мобильная версия" },
];

export function AdminBannersTab() {
  const [banners, setBanners] = useState<CmsBannerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newBanner, setNewBanner] = useState({
    title: "", text: "", imageUrl: "", linkUrl: "", ctaText: "",
    position: "home_hero", isActive: true, sortOrder: 0,
  });

  const loadBanners = async (signal?: AbortSignal) => {
    const response = await csrfFetch("/api/cms/banners?include_inactive=true", { signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Не удалось загрузить баннеры");
    setBanners(Array.isArray(payload.banners) ? payload.banners : []);
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadBanners(controller.signal)
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") toast.error("Ошибка загрузки баннеров", { description: error.message });
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const createBanner = async () => {
    if (saving || !newBanner.title.trim()) return;
    setSaving(true);
    try {
      const response = await csrfFetch("/api/cms/banners", {
        method: "POST",
        body: JSON.stringify(newBanner),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось создать баннер");
      setBanners((current) => [...current, payload.banner as CmsBannerRecord]);
      setShowAdd(false);
      setNewBanner({ title: "", text: "", imageUrl: "", linkUrl: "", ctaText: "", position: "home_hero", isActive: true, sortOrder: banners.length });
      toast.success("Баннер сохранён в базе данных");
    } catch (error) {
      toast.error("Ошибка создания", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally { setSaving(false); }
  };

  const toggleBanner = async (banner: CmsBannerRecord) => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await csrfFetch(`/api/cms/banners/${banner.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !banner.is_active }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось изменить баннер");
      setBanners((current) => current.map((item) => item.id === banner.id ? payload.banner : item));
      toast.success(!banner.is_active ? "Баннер активирован" : "Баннер скрыт");
    } catch (error) {
      toast.error("Ошибка обновления", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally { setSaving(false); }
  };

  const removeBanner = async (banner: CmsBannerRecord) => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await csrfFetch(`/api/cms/banners/${banner.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось удалить баннер");
      setBanners((current) => current.filter((item) => item.id !== banner.id));
      toast.success("Баннер удалён");
    } catch (error) {
      toast.error("Ошибка удаления", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><ImageIcon className="h-6 w-6 text-primary" />Баннеры</h1>
          <p className="text-sm text-muted-foreground">Баннеры хранятся в PostgreSQL и публикуются с учётом расписания.</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-1" /> Добавить</Button>
      </div>

      {loading ? <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка баннеров…</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {banners.map((banner) => (
            <Card key={banner.id} className={`overflow-hidden p-0 ${!banner.is_active ? "opacity-60" : ""}`}>
              <div className="relative aspect-video bg-muted">
                {banner.image_url && <img src={banner.image_url} alt={banner.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-2 left-3 right-3 font-semibold text-white text-sm line-clamp-2">{banner.title}</div>
                <Badge className={`absolute top-2 right-2 ${banner.is_active ? "bg-emerald-600" : "bg-slate-600"} text-white text-[9px]`}>{banner.is_active ? "Активен" : "Скрыт"}</Badge>
              </div>
              <div className="p-3 space-y-2">
                <div className="text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">{BANNER_POSITIONS.find((item) => item.value === banner.position)?.label || banner.position}</Badge>
                  {banner.starts_at && <span className="ml-2">с {formatDate(banner.starts_at)}</span>}
                  {banner.ends_at && <span className="ml-2">до {formatDate(banner.ends_at)}</span>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="flex-1 text-xs" disabled={saving} onClick={() => toggleBanner(banner)}>
                    {banner.is_active ? <><EyeOff className="h-3 w-3 mr-1" /> Скрыть</> : <><Eye className="h-3 w-3 mr-1" /> Показать</>}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive text-xs" disabled={saving} onClick={() => removeBanner(banner)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            </Card>
          ))}
          {banners.length === 0 && <Card className="p-8 text-center text-sm text-muted-foreground md:col-span-2 lg:col-span-3">Баннеры ещё не созданы.</Card>}
        </div>
      )}

      {showAdd && (
        <Dialog open onOpenChange={setShowAdd}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Новый баннер</DialogTitle><DialogDescription>Баннер будет сохранён в PostgreSQL.</DialogDescription></DialogHeader>
            <div className="space-y-2">
              <div><Label>Заголовок *</Label><Input value={newBanner.title} maxLength={180} onChange={(e) => setNewBanner({ ...newBanner, title: e.target.value })} /></div>
              <div><Label>Текст</Label><Textarea value={newBanner.text} maxLength={1000} onChange={(e) => setNewBanner({ ...newBanner, text: e.target.value })} rows={2} /></div>
              <div><Label>URL изображения</Label><Input value={newBanner.imageUrl} maxLength={2048} onChange={(e) => setNewBanner({ ...newBanner, imageUrl: e.target.value })} placeholder="https://…" /></div>
              <div><Label>Ссылка</Label><Input value={newBanner.linkUrl} maxLength={2048} onChange={(e) => setNewBanner({ ...newBanner, linkUrl: e.target.value })} placeholder="/catalog" /></div>
              <div><Label>Текст кнопки</Label><Input value={newBanner.ctaText} maxLength={100} onChange={(e) => setNewBanner({ ...newBanner, ctaText: e.target.value })} /></div>
              <div>
                <Label>Позиция</Label>
                <Select value={newBanner.position} onValueChange={(value) => setNewBanner({ ...newBanner, position: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{BANNER_POSITIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={saving} onClick={() => setShowAdd(false)}>Отмена</Button>
              <Button disabled={saving || !newBanner.title.trim()} onClick={createBanner}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Создать баннер"}</Button>
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
    csrfFetch("/api/admin/promo-popup")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setPromoEnabled(data.enabled); })
      .catch(() => {});
  }, []);

  const handleTogglePromo = async () => {
    setPromoLoading(true);
    try {
      const res = await csrfFetch("/api/admin/promo-popup", {
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
