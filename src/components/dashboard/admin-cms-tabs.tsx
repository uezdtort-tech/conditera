"use client";

import { useAppStore } from "@/lib/store";
import { useState, useEffect, useCallback } from "react";
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
  RefreshCw,
  RotateCcw,
  Palette,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { SETTING_CATEGORIES } from "@/lib/mock-data-cms";
import { formatDate } from "@/lib/finance";
import { toast } from "sonner";
import { csrfFetch } from "@/lib/api-client";

// ==================== CMS: РЕДАКТОР ГЛАВНОЙ СТРАНИЦЫ ====================
interface CmsSectionMeta {
  slug: string;
  title: string;
  visible: boolean;
  sortOrder: number;
}

export function AdminCmsHomeTab() {
  const [sectionsData, setSectionsData] = useState<Record<string, CmsBlockApiRow[]>>({});
  const [sectionMeta, setSectionMeta] = useState<CmsSectionMeta[]>([]);
  const [savingSections, setSavingSections] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<CmsBlockApiRow>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState<string | null>(null);

  /** Секции, блоки которых реально рендерятся на публичной главной. */
  const renderedSections: Record<string, string> = {
    advantages: "Преимущества",
    steps: "Шаги заказа",
    cta_confectioner: "CTA для кондитеров",
  };
  /** Системные секции: рендерятся из настроек/БД — блоки для них пока не выводятся. */
  const systemSections: Record<string, string> = {
    hero: "Hero (управляется настройками: hero_title и др.)",
    stats: "Статистика (стеклянная лента в hero)",
    testimonials: "Отзывы (реальные данные из БД)",
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await csrfFetch("/api/cms/blocks?include_inactive=true");
      const data = (await res.json()) as {
        sections?: { slug?: string; title?: string; visible?: boolean; sortOrder?: number; blocks?: CmsBlockApiRow[] }[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const map: Record<string, CmsBlockApiRow[]> = {};
      const meta: CmsSectionMeta[] = [];
      for (const s of data.sections || []) {
        if (s.slug) {
          map[s.slug] = s.blocks || [];
          if (["advantages", "steps", "cta_confectioner"].includes(s.slug)) {
            meta.push({
              slug: s.slug,
              title: s.title || s.slug,
              visible: s.visible !== false,
              sortOrder: Number.isFinite(s.sortOrder) ? Number(s.sortOrder) : 0,
            });
          }
        }
      }
      setSectionsData(map);
      setSectionMeta(meta.sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить блоки");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const moveSection = (slug: string, direction: -1 | 1) => {
    setSectionMeta((current) => {
      const next = [...current].sort((a, b) => a.sortOrder - b.sortOrder);
      const index = next.findIndex((item) => item.slug === slug);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= next.length) return current;
      const currentOrder = next[index].sortOrder;
      next[index] = { ...next[index], sortOrder: next[target].sortOrder };
      next[target] = { ...next[target], sortOrder: currentOrder };
      return next.sort((a, b) => a.sortOrder - b.sortOrder);
    });
  };

  const toggleSectionVisibility = (slug: string) => {
    setSectionMeta((current) => current.map((item) =>
      item.slug === slug ? { ...item, visible: !item.visible } : item
    ));
  };

  const saveSectionOrder = async () => {
    setSavingSections(true);
    setError(null);
    try {
      const res = await csrfFetch("/api/cms/sections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: sectionMeta }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success("Порядок и видимость секций сохранены");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить секции");
    } finally {
      setSavingSections(false);
    }
  };

  const addBlock = async (section: string) => {
    setAddingSection(section);
    setError(null);
    try {
      const res = await csrfFetch("/api/cms/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section,
          title: "Новый блок",
          subtitle: "",
          content: "",
          isActive: true,
          order: (sectionsData[section] || []).length,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success("Блок добавлен и сразу виден на главной");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось добавить блок");
    } finally {
      setAddingSection(null);
    }
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSavingId(editingId);
    setError(null);
    try {
      const res = await csrfFetch("/api/cms/blocks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          title: editValues.title ?? "",
          subtitle: editValues.subtitle ?? "",
          content: editValues.content ?? "",
          image: editValues.image ?? "",
          link: editValues.link ?? "",
          linkText: editValues.linkText ?? "",
          isActive: editValues.isActive !== false,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success("Блок обновлён");
      setEditingId(null);
      setEditValues({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить блок");
    } finally {
      setSavingId(null);
    }
  };

  const toggleBlock = async (block: CmsBlockApiRow) => {
    setError(null);
    try {
      const res = await csrfFetch("/api/cms/blocks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: block.id, isActive: block.isActive === false }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(block.isActive === false ? "Показан" : "Скрыт");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить блок");
    }
  };

  const deleteBlock = async (id: string) => {
    setError(null);
    try {
      const res = await csrfFetch(`/api/cms/blocks?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success("Удалён");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить блок");
    }
  };

  const renderBlockRow = (block: CmsBlockApiRow) => (
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
          <div className="grid grid-cols-2 gap-2">
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
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={saveEdit} disabled={savingId === block.id}>
              {savingId === block.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />} Сохранить
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Отмена</Button>
            <label className="flex items-center gap-1 text-xs cursor-pointer ml-auto">
              <Checkbox
                checked={editValues.isActive !== false}
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
              {block.isActive === false && <Badge variant="outline" className="text-[9px]">Скрыт</Badge>}
            </div>
            {block.subtitle && (
              <div className="text-xs text-muted-foreground line-clamp-1">{block.subtitle}</div>
            )}
            {block.linkText && (
              <Badge variant="secondary" className="text-[9px] mt-1">{block.linkText} → {block.link}</Badge>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingId(block.id); setEditValues({ ...block }); }} aria-label="Редактировать блок">
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleBlock(block)} aria-label={block.isActive === false ? "Показать блок" : "Скрыть блок"}>
              {block.isActive === false ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteBlock(block.id)} aria-label="Удалить блок">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            Главная страница — CMS
          </h1>
          <p className="text-sm text-muted-foreground">
            Блоки сохраняются в БД и видны на публичной главной сразу. Пустая секция — системный хардкод-фолбэк.
          </p>
        </div>
        <Button onClick={load} variant="outline" size="sm" aria-label="Обновить блоки">
          <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {error && (
        <Card className="p-3 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {error}
        </Card>
      )}

      {sectionMeta.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="font-semibold text-sm">Порядок и видимость секций</h3>
              <p className="text-xs text-muted-foreground">Настройки применяются к динамическим секциям главной страницы.</p>
            </div>
            <Button size="sm" onClick={saveSectionOrder} disabled={savingSections}>
              {savingSections ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Сохранить
            </Button>
          </div>
          <div className="space-y-2">
            {[...sectionMeta].sort((a, b) => a.sortOrder - b.sortOrder).map((section, index, rows) => (
              <div key={section.slug} className="flex items-center gap-2 rounded-md border border-border p-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{section.title}</div>
                  <div className="text-[11px] text-muted-foreground">{section.visible ? "Показывается на главной" : "Скрыта на главной"}</div>
                </div>
                <Button size="icon" variant="ghost" aria-label="Переместить секцию выше" disabled={index === 0} onClick={() => moveSection(section.slug, -1)}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" aria-label="Переместить секцию ниже" disabled={index === rows.length - 1} onClick={() => moveSection(section.slug, 1)}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" aria-label={section.visible ? "Скрыть секцию" : "Показать секцию"} onClick={() => toggleSectionVisibility(section.slug)}>
                  {section.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка блоков…
        </Card>
      ) : (
        <>
          {/* Редактируемые секции (рендерятся публично) */}
          {(sectionMeta.length
            ? [...sectionMeta].sort((a, b) => a.sortOrder - b.sortOrder).map((section) => [section.slug, renderedSections[section.slug]] as const)
            : Object.entries(renderedSections)
          ).filter((entry) => Boolean(entry[1])).map(([key, label]) => {
            const blocks = sectionsData[key] || [];
            const sectionVisible = sectionMeta.find((section) => section.slug === key)?.visible !== false;
            return (
              <Card key={key} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    {label}
                    <Badge variant="secondary" className="text-[10px]">{blocks.length}</Badge>
                    <Badge variant="outline" className="text-[9px]">{sectionVisible ? "видна на главной" : "скрыта"}</Badge>
                  </h3>
                  <Button size="sm" variant="outline" disabled={addingSection === key} onClick={() => addBlock(key)}>
                    {addingSection === key ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />} Добавить
                  </Button>
                </div>
                <div className="space-y-2">
                  {blocks.map(renderBlockRow)}
                  {blocks.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-2">
                      Нет блоков — на главной показывается системная секция
                    </div>
                  )}
                </div>
              </Card>
            );
          })}

          {/* Системные секции — только справка */}
          <Card className="p-4 border-dashed">
            <h3 className="font-semibold text-sm mb-2 text-muted-foreground">Системные секции (управляются иначе)</h3>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {Object.entries(systemSections).map(([key, label]) => (
                <li key={key}>• {label}</li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

/** Строка блока GET /api/cms/blocks (metadata развёрнут в поля). */
interface CmsBlockApiRow {
  id: string;
  sectionSlug?: string;
  type?: string;
  content?: string | null;
  order?: number;
  isActive?: boolean;
  title?: string | null;
  subtitle?: string | null;
  image?: string | null;
  link?: string | null;
  linkText?: string | null;
}

// ==================== CMS: БАННЕРЫ ====================
/** Строка cms_banners, как её отдаёт GET /api/cms/banners (snake_case). */
interface CmsBannerApiRow {
  id: string;
  title?: string | null;
  text?: string | null;
  image_url?: string | null;
  link_url?: string | null;
  cta_text?: string | null;
  position?: string | null;
  is_active?: boolean | null;
  sort_order?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

/** Модель баннера для UI (camelCase — прежние имена полей UI сохранены). */
interface AdminBannerRow {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  link: string;
  buttonText: string;
  position: string;
  isActive: boolean;
  sortOrder: number;
  startDate?: string | null;
  endDate?: string | null;
}

function mapBannerRow(row: CmsBannerApiRow): AdminBannerRow {
  return {
    id: row.id,
    title: row.title || "",
    subtitle: row.text || "",
    image: row.image_url || "",
    link: row.link_url || "",
    buttonText: row.cta_text || "",
    position: row.position || "hero",
    isActive: row.is_active !== false,
    sortOrder: row.sort_order || 0,
    startDate: row.starts_at,
    endDate: row.ends_at,
  };
}

export function AdminBannersTab() {
  const [banners, setBanners] = useState<AdminBannerRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
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

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // include_inactive: админ видит и скрытые баннеры (роль проверяет API)
      const res = await csrfFetch("/api/cms/banners?include_inactive=true");
      const data = (await res.json()) as { banners?: CmsBannerApiRow[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setBanners((data.banners || []).map(mapBannerRow));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить баннеры");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async (banner: AdminBannerRow) => {
    setActionError(null);
    try {
      const res = await csrfFetch("/api/cms/banners", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: banner.id, isActive: !banner.isActive }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(banner.isActive ? "Скрыт" : "Показан");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не удалось изменить баннер");
    }
  };

  const handleDelete = async (id: string) => {
    setActionError(null);
    try {
      const res = await csrfFetch(`/api/cms/banners?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success("Удалён");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не удалось удалить баннер");
    }
  };

  const handleAdd = async () => {
    if (!newBanner.title || !newBanner.image) return;
    setActionError(null);
    setIsSaving(true);
    try {
      const res = await csrfFetch("/api/cms/banners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newBanner.title,
          subtitle: newBanner.subtitle,
          imageUrl: newBanner.image,
          linkUrl: newBanner.link,
          buttonText: newBanner.buttonText,
          position: newBanner.position,
          sortOrder: Number(newBanner.sortOrder) || 0,
          isActive: newBanner.isActive,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success("Баннер добавлен!");
      setShowAdd(false);
      setNewBanner({ title: "", subtitle: "", image: "", link: "", buttonText: "", position: "hero", isActive: true, sortOrder: 0 });
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не удалось создать баннер");
    } finally {
      setIsSaving(false);
    }
  };

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
        <div className="flex gap-2">
          <Button onClick={load} variant="outline" size="sm" aria-label="Обновить баннеры">
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
          <Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-1" /> Добавить</Button>
        </div>
      </div>

      {error && (
        <Card className="p-3 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {error}
        </Card>
      )}
      {actionError && (
        <Card className="p-3 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {actionError}
        </Card>
      )}

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка баннеров…
        </Card>
      ) : banners.length === 0 ? (
        <Card className="p-12 text-center">
          <ImageIcon className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold">Нет баннеров</h3>
          <p className="text-sm text-muted-foreground">Создайте первый — он появится на главной или в каталоге</p>
        </Card>
      ) : (
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
                    onClick={() => handleToggle(banner)}
                  >
                    {banner.isActive ? <><EyeOff className="h-3 w-3 mr-1" /> Скрыть</> : <><Eye className="h-3 w-3 mr-1" /> Показать</>}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive text-xs"
                    onClick={() => handleDelete(banner.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

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
                disabled={!newBanner.title || !newBanner.image || isSaving}
                onClick={handleAdd}
              >
                {isSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Добавить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ==================== CMS: СТРАНИЦЫ (FAQ, О нас, Условия) ====================
/** Строка cms_pages, как её отдаёт GET /api/cms/pages (snake_case). */
interface CmsPageApiRow {
  id: string;
  slug?: string | null;
  title?: string | null;
  content?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  status?: string | null;
  updated_at?: string | null;
}

interface AdminCmsPageRow {
  id: string;
  slug: string;
  title: string;
  seoTitle: string;
  seoDescription: string;
  content: string;
  isPublished: boolean;
  updatedAt: string;
}

function mapPageRow(row: CmsPageApiRow): AdminCmsPageRow {
  return {
    id: row.id,
    slug: row.slug || "",
    title: row.title || "",
    seoTitle: row.seo_title || "",
    seoDescription: row.seo_description || "",
    content: row.content || "",
    isPublished: row.status === "published",
    updatedAt: row.updated_at || "",
  };
}

export function AdminCmsPagesTab() {
  const [cmsPages, setCmsPages] = useState<AdminCmsPageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<any>({});

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // include_drafts: GET отдаёт черновики только админ-ролям (проверка на сервере)
      const res = await csrfFetch("/api/cms/pages?include_drafts=true");
      const data = (await res.json()) as { pages?: CmsPageApiRow[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCmsPages((data.pages || []).map(mapPageRow));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить страницы");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const savePage = async () => {
    if (!editingId) return;
    const page = cmsPages.find((p) => p.id === editingId);
    if (!page?.slug) return;
    setActionError(null);
    setIsSaving(true);
    try {
      const res = await csrfFetch(`/api/cms/pages/${encodeURIComponent(page.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editValues.title || "",
          seoTitle: editValues.seoTitle || "",
          seoDescription: editValues.seoDescription || "",
          content: editValues.content || "",
          status: editValues.isPublished ? "published" : "draft",
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success("Страница сохранена!");
      setEditingId(null);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не удалось сохранить страницу");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Edit className="h-6 w-6 text-primary" />
            Страницы сайта
          </h1>
          <p className="text-sm text-muted-foreground">Редактируйте тексты страниц: О нас, FAQ, Условия, Конфиденциальность</p>
        </div>
        <Button onClick={load} variant="outline" size="sm" aria-label="Обновить страницы">
          <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {error && (
        <Card className="p-3 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {error}
        </Card>
      )}
      {actionError && (
        <Card className="p-3 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {actionError}
        </Card>
      )}

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка страниц…
        </Card>
      ) : cmsPages.length === 0 ? (
        <Card className="p-12 text-center">
          <Edit className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold">Страницы не найдены</h3>
          <p className="text-sm text-muted-foreground">Создайте первую: POST /api/cms/pages (slug, title, content)</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {cmsPages.map((page) => (
            <Card key={page.id} className="p-4">
              {editingId === page.id ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">/{page.slug}</Badge>
                    <div className="flex gap-1">
                      <Button size="sm" onClick={savePage} disabled={isSaving}>
                        {isSaving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                        Сохранить
                      </Button>
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
                      {page.updatedAt && <>Обновлено: {formatDate(page.updatedAt)}</>}
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
      )}
    </div>
  );
}

// ==================== CMS: НАСТРОЙКИ САЙТА ====================
/** Строка site_settings, как её отдаёт GET /api/cms/settings. */
interface SiteSettingApiRow {
  id: string;
  key?: string | null;
  value?: string | null;
  category?: string | null;
  description?: string | null;
}

interface AdminSettingRow {
  id: string;
  key: string;
  value: string;
  category: string;
  description: string;
}

/** Строка GET /api/cms/settings/versions (Z-v32 E-1). */
interface CmsVersionMetaRow {
  version: number;
  status: string;
  comment: string | null;
  created_by: string | null;
  created_at: string;
}

function cmsStatusLabel(status: string): string {
  if (status === "draft") return "Черновик";
  if (status === "published") return "Опубликована";
  if (status === "superseded") return "Заменена";
  return status;
}

function cmsStatusBadgeClass(status: string): string {
  if (status === "published") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (status === "draft") return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-muted bg-muted text-muted-foreground";
}

export function AdminSettingsTab() {
  const [settings, setSettings] = useState<AdminSettingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("general");
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [promoEnabled, setPromoEnabled] = useState(false);
  const [promoLoading, setPromoLoading] = useState(false);
  // Z-v32 E-1: версии и публикация
  const [versions, setVersions] = useState<CmsVersionMetaRow[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [actingVersion, setActingVersion] = useState<number | null>(null);
  // Z-brand: оформление (акцентный цвет + логотип) — ключи site_settings
  const [brandAccent, setBrandAccent] = useState("#7c3f2c");
  const [brandLogo, setBrandLogo] = useState("");
  const [brandSaving, setBrandSaving] = useState(false);
  // Новый ключ: добавить произвольную настройку (PUT создаёт ключ в черновике)
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newKeySaving, setNewKeySaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await csrfFetch("/api/cms/settings");
      const data = (await res.json()) as { settings?: SiteSettingApiRow[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const rows = (data.settings || []).map((s) => ({
        id: String(s.id),
        key: String(s.key || ""),
        value: String(s.value ?? ""),
        category: String(s.category || "general"),
        description: String(s.description || ""),
      }));
      setSettings(rows);
      // Z-brand: подтягиваем текущие значения оформления
      const accentRow = rows.find((r) => r.key === "brand_accent_color");
      const logoRow = rows.find((r) => r.key === "brand_logo_url");
      if (accentRow && /^#[0-9a-fA-F]{6}$/.test(accentRow.value)) setBrandAccent(accentRow.value);
      if (logoRow) setBrandLogo(logoRow.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить настройки");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const loadVersions = useCallback(async () => {
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const res = await csrfFetch("/api/cms/settings/versions");
      const data = (await res.json()) as { versions?: CmsVersionMetaRow[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setVersions(
        (data.versions || []).map((v) => ({
          version: Number(v.version),
          status: String(v.status),
          comment: v.comment ?? null,
          created_by: v.created_by ?? null,
          created_at: String(v.created_at || ""),
        }))
      );
    } catch (e) {
      setVersionsError(e instanceof Error ? e.message : "Не удалось загрузить версии");
    } finally {
      setVersionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

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

  /** Публикация черновика (Z-v32 E-1). */
  const handlePublish = async (version: number) => {
    setActingVersion(version);
    try {
      const res = await csrfFetch("/api/cms/settings/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      const data = (await res.json()) as { error?: string; currentStatus?: string };
      if (res.ok) {
        toast.success(`Версия ${version} опубликована`);
        void loadVersions();
        void loadSettings();
      } else if (data.error === "CMS_NOT_DRAFT") {
        toast.error(`Версия ${version} — не черновик (${cmsStatusLabel(data.currentStatus || "")})`);
        void loadVersions();
      } else if (data.error === "CMS_VERSION_NOT_FOUND") {
        toast.error("Версия не найдена — обновите список");
        void loadVersions();
      } else {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось опубликовать версию");
    } finally {
      setActingVersion(null);
    }
  };

  /** Откат: новая версия с данными старой, публикуется сразу. */
  const handleRollback = async (toVersion: number) => {
    setActingVersion(toVersion);
    try {
      const res = await csrfFetch("/api/cms/settings/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toVersion }),
      });
      const data = (await res.json()) as { version?: number; error?: string };
      if (res.ok) {
        toast.success(
          `Создана версия ${data.version ?? "?"} с данными v${toVersion} и сразу опубликована`
        );
        void loadVersions();
        void loadSettings();
      } else if (data.error === "CMS_VERSION_NOT_FOUND") {
        toast.error("Версия не найдена — обновите список");
        void loadVersions();
      } else {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось выполнить откат");
    } finally {
      setActingVersion(null);
    }
  };

  /** Z-brand: сохранить оформление черновиком (публикация — в блоке «Версии»). */
  const handleSaveBrand = async () => {
    setBrandSaving(true);
    try {
      const pairs: { key: string; value: string }[] = [
        { key: "brand_accent_color", value: /^#[0-9a-fA-F]{6}$/.test(brandAccent) ? brandAccent : "" },
        { key: "brand_logo_url", value: brandLogo.trim() },
      ];
      let draftVersion: number | undefined;
      for (const pair of pairs) {
        const res = await csrfFetch("/api/cms/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...pair, comment: `Правка оформления: ${pair.key}` }),
        });
        const data = (await res.json()) as { draft?: { version?: number }; error?: string; currentVersion?: number | null };
        if (res.status === 409 && data.error === "CMS_CONFLICT") {
          toast.error(`Конфликт версий (v${data.currentVersion ?? "?"}) — обновите и повторите`);
          return;
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (data.draft?.version) draftVersion = data.draft.version;
      }
      toast.success(draftVersion ? `Черновик v${draftVersion} сохранён — опубликуйте в «Версиях»` : "Оформление сохранено в черновик");
      void loadVersions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить оформление");
    } finally {
      setBrandSaving(false);
    }
  };

  const filtered = settings.filter((s) => s.category === activeCategory);

  /** Добавить произвольный ключ: PUT создаёт его в черновике документа. */
  const handleAddKey = async () => {
    const key = newKey.trim();
    if (!key) {
      toast.error("Укажите ключ (например contact_phone)");
      return;
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(key)) {
      toast.error("Ключ: только латиница, цифры и _ . - (без пробелов)");
      return;
    }
    setNewKeySaving(true);
    try {
      const res = await csrfFetch("/api/cms/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: newValue, comment: `Новый ключ ${key}` }),
      });
      const data = (await res.json()) as { draft?: { version?: number }; error?: string; currentVersion?: number | null };
      if (res.status === 409 && data.error === "CMS_CONFLICT") {
        toast.error(`Конфликт версий (v${data.currentVersion ?? "?"}) — обновите и повторите`);
        return;
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(
        data.draft?.version
          ? `Ключ «${key}» добавлен в черновик v${data.draft.version} — опубликуйте в «Версиях», чтобы он появился в списке`
          : `Ключ «${key}» добавлен в черновик`
      );
      setNewKey("");
      setNewValue("");
      void loadVersions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось добавить ключ");
    } finally {
      setNewKeySaving(false);
    }
  };

  const handleSave = async (key: string) => {
    if (editValues[key] === undefined) return;
    setSavingKey(key);
    try {
      const res = await csrfFetch("/api/cms/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: editValues[key], comment: `Правка ключа ${key}` }),
      });
      const data = (await res.json()) as {
        draft?: { version?: number };
        error?: string;
        currentVersion?: number | null;
      };
      if (res.status === 409 && data.error === "CMS_CONFLICT") {
        toast.error(
          `Конфликт версий: опубликованная версия изменилась (v${data.currentVersion ?? "?"}). Обновите данные и повторите правку.`,
          {
            action: {
              label: "Обновить",
              onClick: () => {
                void loadSettings();
                void loadVersions();
              },
            },
          }
        );
        return;
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // Значение показываем локально сразу (в публичке появится после публикации)
      setSettings((prev) => prev.map((s) => (s.key === key ? { ...s, value: editValues[key] } : s)));
      const draftVersion = data.draft?.version;
      toast.success(
        draftVersion
          ? `Черновик сохранён как версия ${draftVersion} — опубликуйте`
          : "Настройка сохранена в черновик"
      );
      const newValues = { ...editValues };
      delete newValues[key];
      setEditValues(newValues);
      void loadVersions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Не удалось сохранить «${key}»`);
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Settings className="h-6 w-6 text-primary" />
            Настройки сайта
          </h1>
          <p className="text-sm text-muted-foreground">Комиссии, тарифы, доставка, SEO, контакты — всё в одном месте</p>
        </div>
        <Button onClick={loadSettings} variant="outline" size="sm" aria-label="Обновить настройки">
          <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {error && (
        <Card className="p-3 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {error}
        </Card>
      )}

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

      {/* Z-brand: Оформление (акцент + логотип) */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Palette className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="font-semibold text-sm">Оформление (бренд)</div>
              <div className="text-xs text-muted-foreground">
                Акцентный цвет применяется ко всему сайту (кнопки, ссылки, активные состояния); логотип — в шапке и футере
              </div>
            </div>
          </div>
          <Button onClick={handleSaveBrand} disabled={brandSaving} size="sm">
            {brandSaving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Сохранить черновик
          </Button>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Акцентный цвет</Label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(brandAccent) ? brandAccent : "#7c3f2c"}
                onChange={(e) => setBrandAccent(e.target.value)}
                className="h-8 w-12 rounded border border-border cursor-pointer bg-transparent"
                aria-label="Выбор акцентного цвета"
              />
              <Input
                value={brandAccent}
                onChange={(e) => setBrandAccent(e.target.value)}
                className="h-8 w-28 font-mono text-sm"
                placeholder="#7c3f2c"
                aria-label="HEX акцентного цвета"
              />
              <span className="text-[10px] text-muted-foreground">HEX, например #7c3f2c</span>
            </div>
          </div>
          <div>
            <Label className="text-xs">URL логотипа</Label>
            <Input
              value={brandLogo}
              onChange={(e) => setBrandLogo(e.target.value)}
              className="h-8 text-sm mt-1"
              placeholder="/logo.png или https://..."
              aria-label="URL логотипа"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Пусто — системный логотип /logo.png</p>
          </div>
        </div>
      </Card>

      {/* Z-v32 E-1: Версии и публикация */}
      <Card className="p-4 border-muted">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="font-semibold text-sm">Версии и публикация</div>
            <div className="text-xs text-muted-foreground">
              Правки сохраняются черновиком; публикация делает черновик видимым на сайте. Откат создаёт новую версию с данными старой.
            </div>
          </div>
          <Button onClick={loadVersions} variant="outline" size="sm" aria-label="Обновить версии">
            <RefreshCw className={`h-4 w-4 ${versionsLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        {versionsError ? (
          <div className="text-xs text-destructive">{versionsError}</div>
        ) : versions.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2 text-center">
            Версий пока нет — сохраните первую правку черновиком
          </div>
        ) : (
          <div className="space-y-1.5">
            {versions.map((v) => (
              <div key={v.version} className="flex flex-wrap items-center gap-2 p-2 border border-border rounded">
                <span className="text-sm font-mono font-semibold w-12">v{v.version}</span>
                <Badge variant="outline" className={cmsStatusBadgeClass(v.status)}>
                  {cmsStatusLabel(v.status)}
                </Badge>
                <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
                  {v.comment || "—"} · {formatDate(v.created_at)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1"
                  onClick={() => window.open(`/?cmsPreview=${v.version}`, "_blank", "noopener,noreferrer")}
                >
                  <Eye className="h-3 w-3" />
                  Предпросмотр
                </Button>
                {v.status === "draft" && (
                  <Button
                    size="sm"
                    className="h-7 gap-1"
                    disabled={actingVersion !== null}
                    onClick={() => handlePublish(v.version)}
                  >
                    {actingVersion === v.version ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                    Опубликовать
                  </Button>
                )}
                {(v.status === "published" || v.status === "superseded") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1"
                    disabled={actingVersion !== null}
                    onClick={() => handleRollback(v.version)}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Откатить
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Добавить произвольный ключ настройки */}
      <Card className="p-4 border-dashed">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Plus className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="font-semibold text-sm">Добавить свой ключ</div>
            <div className="text-xs text-muted-foreground">
              Ключ появится в списке после публикации версии. Публичные страницы читают ключи вида hero_* и brand_*
            </div>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="Ключ (например support_phone)"
            className="h-9 flex-1 font-mono text-sm"
            aria-label="Ключ настройки"
          />
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Значение"
            className="h-9 flex-1 text-sm"
            aria-label="Значение настройки"
          />
          <Button onClick={handleAddKey} disabled={newKeySaving} size="sm" className="h-9 shrink-0">
            {newKeySaving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
            Добавить
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
      {error ? null : isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка настроек…
        </Card>
      ) : settings.length === 0 ? (
        <Card className="p-8 text-center">
          <Settings className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Настройки не найдены</h3>
          <p className="text-sm text-muted-foreground">В таблице site_settings пока нет записей — добавьте их через БД или API</p>
        </Card>
      ) : (
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
                  disabled={editValues[setting.key] === undefined || savingKey === setting.key}
                >
                  {savingKey === setting.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                </Button>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-2">Нет настроек в этой категории</div>
            )}
          </div>
        </Card>
      )}
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
/** Строка cms_nav_menu, как её отдаёт GET /api/cms/nav-menu (snake_case). */
interface NavMenuApiRow {
  id: string;
  location?: string | null;
  label?: string | null;
  url?: string | null;
  icon?: string | null;
  sort_order?: number | null;
  is_active?: boolean | null;
}

const NAV_LOCATIONS = [
  { id: "header", label: "Шапка" },
  { id: "footer", label: "Футер" },
  { id: "mobile", label: "Мобильное" },
] as const;

export function AdminNavMenuTab() {
  const [location, setLocation] = useState<string>("header");
  const [items, setItems] = useState<NavMenuApiRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, { label?: string; url?: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async (loc: string) => {
    setIsLoading(true);
    setError(null);
    setDirty({});
    try {
      const res = await csrfFetch(`/api/cms/nav-menu?location=${encodeURIComponent(loc)}&include_inactive=true`);
      const data = (await res.json()) as { items?: NavMenuApiRow[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setItems(data.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить меню");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(location);
  }, [load, location]);

  const addItem = async () => {
    setError(null);
    try {
      const res = await csrfFetch("/api/cms/nav-menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location, label: "Новый пункт", url: "catalog", sortOrder: items.length }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success("Пункт добавлен");
      await load(location);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось добавить пункт");
    }
  };

  const patchItem = async (id: string, fields: Record<string, unknown>, okMsg: string) => {
    setError(null);
    try {
      const res = await csrfFetch("/api/cms/nav-menu", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...fields }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(okMsg);
      await load(location);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить пункт");
    }
  };

  const deleteItem = async (id: string) => {
    setError(null);
    try {
      const res = await csrfFetch(`/api/cms/nav-menu?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success("Удалён");
      await load(location);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить пункт");
    }
  };

  const saveRow = async (item: NavMenuApiRow) => {
    const d = dirty[item.id];
    if (!d || (!d.label && !d.url)) return;
    setSavingId(item.id);
    await patchItem(item.id, { label: d.label ?? item.label, url: d.url ?? item.url }, "Пункт сохранён");
    setSavingId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            Навигация
          </h1>
          <p className="text-sm text-muted-foreground">
            Пункты сохраняются в БД и появляются на сайте сразу (группа после системного меню)
          </p>
        </div>
        <Button onClick={() => load(location)} variant="outline" size="sm" aria-label="Обновить меню">
          <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {error && (
        <Card className="p-3 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {error}
        </Card>
      )}

      {/* Локации */}
      <div className="flex flex-wrap gap-2">
        {NAV_LOCATIONS.map((loc) => (
          <button
            key={loc.id}
            onClick={() => setLocation(loc.id)}
            className={`px-3 py-1.5 text-xs rounded-full border flex items-center gap-1 ${
              location === loc.id
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border hover:border-primary/40"
            }`}
          >
            {loc.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка меню…
        </Card>
      ) : (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-muted-foreground">
              url — имя раздела (catalog, promotions...) или внешний http(s)/mailto/tel-адрес
            </span>
            <Button size="sm" variant="outline" onClick={addItem}>
              <Plus className="h-3 w-3 mr-1" /> Добавить пункт
            </Button>
          </div>
          <div className="space-y-2">
            {items.map((item, i) => {
              const d = dirty[item.id] || {};
              const isDirty = Boolean(d.label !== undefined || d.url !== undefined);
              return (
                <div key={item.id} className="flex items-center gap-2 p-2 border border-border rounded flex-wrap">
                  <span className="text-[10px] text-muted-foreground w-4">{i + 1}</span>
                  <Input
                    value={d.label ?? item.label ?? ""}
                    onChange={(e) => setDirty({ ...dirty, [item.id]: { ...d, label: e.target.value } })}
                    className="w-44 h-8 text-sm"
                    aria-label="Название пункта"
                  />
                  <Input
                    value={d.url ?? item.url ?? ""}
                    onChange={(e) => setDirty({ ...dirty, [item.id]: { ...d, url: e.target.value } })}
                    className="w-44 h-8 text-sm font-mono"
                    aria-label="URL пункта"
                  />
                  {isDirty ? (
                    <>
                      <Button size="sm" className="h-8" onClick={() => saveRow(item)} disabled={savingId === item.id}>
                        {savingId === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        <span className="ml-1 text-xs">Сохранить</span>
                      </Button>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => setDirty({ ...dirty, [item.id]: {} })}>
                        Отмена
                      </Button>
                    </>
                  ) : null}
                  <label className="flex items-center gap-1 text-xs cursor-pointer ml-auto">
                    <Checkbox
                      checked={item.is_active !== false}
                      onCheckedChange={(v) => patchItem(item.id, { isActive: !!v }, v ? "Показан" : "Скрыт")}
                    />
                    {item.is_active !== false ? "Показан" : "Скрыт"}
                  </label>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={() => deleteItem(item.id)}
                    aria-label="Удалить пункт"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
            {items.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-3">
                Нет пунктов для этой локации — на сайте показывается системное меню
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
