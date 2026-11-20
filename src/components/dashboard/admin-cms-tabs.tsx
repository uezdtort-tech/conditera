"use client";

import { useAppStore } from "@/lib/store";
import { useState, useEffect, type ChangeEvent } from "react";
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
  Palette,
  AlertTriangle,
  Gift,
  Loader2,
  ExternalLink,
  Upload,
  Copy,
  FileText,
  Video,
  Music2,
  ChevronUp,
  ChevronDown,
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

type CmsHomeSection = {
  key: string;
  label: string;
  icon: string;
  sortOrder: number;
  isEnabled: boolean;
};

const DEFAULT_CMS_HOME_SECTIONS: CmsHomeSection[] = CMS_HOME_SECTIONS.map((section, index) => ({
  key: section.key,
  label: section.label,
  icon: section.icon,
  sortOrder: (index + 1) * 10,
  isEnabled: true,
}));

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
  const [cmsSections, setCmsSections] = useState<CmsHomeSection[]>(DEFAULT_CMS_HOME_SECTIONS);
  const [editingSectionKey, setEditingSectionKey] = useState<string | null>(null);
  const [sectionTitleDraft, setSectionTitleDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<CmsHomeBlock>>({});

  const loadBlocks = async (signal?: AbortSignal) => {
    const [blocksResponse, sectionsResponse] = await Promise.all([
      fetch("/api/cms/blocks", { credentials: "include", signal }),
      fetch("/api/cms/sections", { credentials: "include", signal }),
    ]);
    const [blocksPayload, sectionsPayload] = await Promise.all([
      blocksResponse.json().catch(() => ({})),
      sectionsResponse.json().catch(() => ({})),
    ]);
    if (!blocksResponse.ok) throw new Error(blocksPayload.error || "Не удалось загрузить блоки");
    setCmsBlocks(Array.isArray(blocksPayload.blocks) ? blocksPayload.blocks.map(mapCmsHomeBlock) : []);
    if (sectionsResponse.ok && Array.isArray(sectionsPayload.sections) && sectionsPayload.sections.length === CMS_HOME_SECTIONS.length) {
      const mapped: CmsHomeSection[] = sectionsPayload.sections.flatMap((item: { section: string; title: string; sort_order: number; is_enabled: boolean }) => {
        const definition = CMS_HOME_SECTIONS.find((section) => section.key === item.section);
        return definition ? [{
          key: definition.key,
          label: item.title,
          icon: definition.icon,
          sortOrder: item.sort_order,
          isEnabled: item.is_enabled,
        }] : [];
      });
      if (mapped.length === CMS_HOME_SECTIONS.length) setCmsSections(mapped);
    }
  };

  const persistHomeSections = async (nextSections: CmsHomeSection[]): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    try {
      const ordered = nextSections.map((section, index) => ({ ...section, sortOrder: (index + 1) * 10 }));
      const response = await csrfFetch("/api/cms/sections", {
        method: "PUT",
        body: JSON.stringify({
          sections: ordered.map((section) => ({
            section: section.key,
            title: section.label,
            sort_order: section.sortOrder,
            is_enabled: section.isEnabled,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить композицию");
      setCmsSections(ordered);
      toast.success("Композиция главной сохранена");
      return true;
    } catch (error) {
      toast.error("Ошибка сохранения композиции", {
        description: error instanceof Error ? error.message : "Неизвестная ошибка",
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const moveHomeSection = (sectionKey: string, direction: -1 | 1) => {
    const ordered = [...cmsSections].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((section) => section.key === sectionKey);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const [moving] = ordered.splice(index, 1);
    ordered.splice(target, 0, moving);
    void persistHomeSections(ordered);
  };

  const toggleHomeSection = (sectionKey: string) => {
    const ordered = [...cmsSections].sort((a, b) => a.sortOrder - b.sortOrder);
    const next = ordered.map((section) => section.key === sectionKey
      ? { ...section, isEnabled: !section.isEnabled }
      : section);
    void persistHomeSections(next);
  };

  const saveHomeSectionTitle = async (sectionKey: string) => {
    const title = sectionTitleDraft.trim();
    if (!title || title.length > 100) {
      toast.error("Название должно содержать от 1 до 100 символов");
      return;
    }
    const next = [...cmsSections]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((section) => section.key === sectionKey ? { ...section, label: title } : section);
    const saved = await persistHomeSections(next);
    if (saved) {
      setEditingSectionKey(null);
      setSectionTitleDraft("");
    }
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
          content: editValues.content,
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

  const moveBlock = async (block: CmsHomeBlock, direction: -1 | 1) => {
    if (saving) return;
    const siblings = cmsBlocks
      .filter((item) => item.section === block.section)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    const currentIndex = siblings.findIndex((item) => item.id === block.id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;

    const reordered = [...siblings];
    const [moving] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moving);
    setSaving(true);
    try {
      const response = await csrfFetch("/api/cms/blocks/reorder", {
        method: "POST",
        body: JSON.stringify({
          section: block.section,
          blockIds: reordered.map((item) => item.id),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось изменить порядок блоков");

      const orderById = new Map(reordered.map((item, index) => [item.id, (index + 1) * 10]));
      setCmsBlocks((current) => current.map((item) => {
        const sortOrder = orderById.get(item.id);
        return sortOrder === undefined ? item : { ...item, sortOrder };
      }));
      toast.success("Порядок блоков сохранён");
    } catch (error) {
      if (error instanceof Error && error.message.includes("Состав секции изменился")) {
        await loadBlocks().catch(() => undefined);
      }
      toast.error("Не удалось изменить порядок", {
        description: error instanceof Error ? error.message : "Неизвестная ошибка",
      });
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
      ) : [...cmsSections].sort((a, b) => a.sortOrder - b.sortOrder).map((section, sectionIndex, orderedSections) => {
        const blocks = cmsBlocks.filter((block) => block.section === section.key).sort((a, b) => a.sortOrder - b.sortOrder);
        return (
          <Card key={section.key} className={section.isEnabled ? "p-4" : "p-4 opacity-70"}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span>{section.icon}</span>
                {editingSectionKey === section.key ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <Input
                      value={sectionTitleDraft}
                      onChange={(event) => setSectionTitleDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void saveHomeSectionTitle(section.key);
                        if (event.key === "Escape") { setEditingSectionKey(null); setSectionTitleDraft(""); }
                      }}
                      maxLength={100}
                      aria-label="Название секции главной страницы"
                      className="h-8 max-w-xs text-sm"
                      autoFocus
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Сохранить название секции" disabled={saving} onClick={() => void saveHomeSectionTitle(section.key)}>
                      <Save className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Отменить изменение названия" disabled={saving} onClick={() => { setEditingSectionKey(null); setSectionTitleDraft(""); }}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <h3 className="font-semibold text-sm">{section.label}</h3>
                    <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Изменить название секции" title="Изменить название секции" disabled={saving} onClick={() => { setEditingSectionKey(section.key); setSectionTitleDraft(section.label); }}>
                      <Edit className="h-3 w-3" />
                    </Button>
                  </>
                )}
                <Badge variant="secondary" className="text-[10px]">{blocks.length}</Badge>
                {!section.isEnabled && <Badge variant="outline" className="text-[10px]">Секция скрыта</Badge>}
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Переместить секцию выше" title="Переместить секцию выше" disabled={saving || sectionIndex === 0} onClick={() => moveHomeSection(section.key, -1)}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Переместить секцию ниже" title="Переместить секцию ниже" disabled={saving || sectionIndex === orderedSections.length - 1} onClick={() => moveHomeSection(section.key, 1)}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={section.isEnabled ? "Скрыть секцию" : "Показать секцию"} title={section.isEnabled ? "Скрыть секцию" : "Показать секцию"} disabled={saving} onClick={() => toggleHomeSection(section.key)}>
                  {section.isEnabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Button>
                <Button size="sm" variant="outline" disabled={saving} onClick={() => addBlock(section.key, (blocks.at(-1)?.sortOrder ?? 0) + 10)}>
                  <Plus className="h-3 w-3 mr-1" /> Добавить
                </Button>
              </div>
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
                        <Label className="text-xs">Содержание блока</Label>
                        <Textarea value={editValues.content || ""} onChange={(e) => setEditValues({ ...editValues, content: e.target.value })} rows={4} className="text-sm" maxLength={20000} />
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
                        <div className="flex flex-col">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-5 w-7"
                            aria-label="Переместить блок выше"
                            title="Переместить выше"
                            disabled={saving || blocks[0]?.id === block.id}
                            onClick={() => moveBlock(block, -1)}
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-5 w-7"
                            aria-label="Переместить блок ниже"
                            title="Переместить ниже"
                            disabled={saving || blocks[blocks.length - 1]?.id === block.id}
                            onClick={() => moveBlock(block, 1)}
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>
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
  const [editingBannerId, setEditingBannerId] = useState<string | null>(null);
  const [newBanner, setNewBanner] = useState({
    title: "", text: "", imageUrl: "", linkUrl: "", ctaText: "",
    position: "home_hero", isActive: true, sortOrder: 0, startsAt: "", endsAt: "",
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

  const openNewBanner = () => {
    setEditingBannerId(null);
    setNewBanner({
      title: "", text: "", imageUrl: "", linkUrl: "", ctaText: "",
      position: "home_hero", isActive: true, sortOrder: banners.length, startsAt: "", endsAt: "",
    });
    setShowAdd(true);
  };

  const openEditBanner = (banner: CmsBannerRecord) => {
    const toLocalInput = (value: string | null) => {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    };
    setEditingBannerId(banner.id);
    setNewBanner({
      title: banner.title,
      text: banner.text || "",
      imageUrl: banner.image_url || "",
      linkUrl: banner.link_url || "",
      ctaText: banner.cta_text || "",
      position: banner.position,
      isActive: banner.is_active,
      sortOrder: banner.sort_order,
      startsAt: toLocalInput(banner.starts_at),
      endsAt: toLocalInput(banner.ends_at),
    });
    setShowAdd(true);
  };

  const saveBanner = async () => {
    if (saving || !newBanner.title.trim()) return;
    setSaving(true);
    try {
      const body = {
        ...newBanner,
        startsAt: newBanner.startsAt ? new Date(newBanner.startsAt).toISOString() : null,
        endsAt: newBanner.endsAt ? new Date(newBanner.endsAt).toISOString() : null,
      };
      const response = await csrfFetch(
        editingBannerId ? `/api/cms/banners/${editingBannerId}` : "/api/cms/banners",
        { method: editingBannerId ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить баннер");
      if (editingBannerId) {
        setBanners((current) => current.map((item) => item.id === editingBannerId ? payload.banner as CmsBannerRecord : item));
      } else {
        setBanners((current) => [...current, payload.banner as CmsBannerRecord]);
      }
      setShowAdd(false);
      setEditingBannerId(null);
      toast.success(editingBannerId ? "Изменения баннера сохранены" : "Баннер создан");
    } catch (error) {
      toast.error("Ошибка сохранения", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
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
        <Button onClick={openNewBanner}><Plus className="h-4 w-4 mr-1" /> Добавить</Button>
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
                  <Button size="sm" variant="outline" className="flex-1 text-xs" disabled={saving} onClick={() => openEditBanner(banner)}>
                    <Edit className="h-3 w-3 mr-1" /> Изменить
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs" disabled={saving} onClick={() => toggleBanner(banner)}>
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
            <DialogHeader><DialogTitle>{editingBannerId ? "Редактировать баннер" : "Новый баннер"}</DialogTitle><DialogDescription>Изменения сохраняются в PostgreSQL и учитываются при публикации.</DialogDescription></DialogHeader>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><Label>Начало показа</Label><Input type="datetime-local" value={newBanner.startsAt} onChange={(e) => setNewBanner({ ...newBanner, startsAt: e.target.value })} /></div>
                <div><Label>Окончание показа</Label><Input type="datetime-local" value={newBanner.endsAt} min={newBanner.startsAt || undefined} onChange={(e) => setNewBanner({ ...newBanner, endsAt: e.target.value })} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={saving} onClick={() => setShowAdd(false)}>Отмена</Button>
              <Button disabled={saving || !newBanner.title.trim()} onClick={saveBanner}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingBannerId ? "Сохранить изменения" : "Создать баннер"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ==================== CMS: СТРАНИЦЫ (FAQ, О нас, Условия) ====================
type CmsPageRecord = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  content: string;
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords: string[] | null;
  status: string;
  is_in_menu: boolean;
  menu_order: number;
  updated_at: string;
};

type CmsPageEditor = {
  slug: string;
  title: string;
  description: string;
  content: string;
  seoTitle: string;
  seoDescription: string;
  isPublished: boolean;
  isInMenu: boolean;
  menuOrder: number;
};

const EMPTY_CMS_PAGE: CmsPageEditor = {
  slug: "", title: "", description: "", content: "", seoTitle: "",
  seoDescription: "", isPublished: false, isInMenu: false, menuOrder: 0,
};

function toCmsPageEditor(page: CmsPageRecord): CmsPageEditor {
  return {
    slug: page.slug,
    title: page.title,
    description: page.description || "",
    content: page.content || "",
    seoTitle: page.seo_title || "",
    seoDescription: page.seo_description || "",
    isPublished: page.status === "published",
    isInMenu: page.is_in_menu,
    menuOrder: page.menu_order || 0,
  };
}

export function AdminCmsPagesTab() {
  const [pages, setPages] = useState<CmsPageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editValues, setEditValues] = useState<CmsPageEditor>(EMPTY_CMS_PAGE);

  const loadPages = async (signal?: AbortSignal) => {
    const response = await csrfFetch("/api/cms/pages?include_drafts=true", { signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Не удалось загрузить страницы");
    setPages(Array.isArray(payload.pages) ? payload.pages : []);
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadPages(controller.signal)
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") toast.error("Ошибка загрузки страниц", { description: error.message });
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const savePage = async () => {
    if (saving) return;
    if (!editValues.slug.trim() || !editValues.title.trim() || !editValues.content.trim()) {
      toast.error("Заполните URL, заголовок и содержимое страницы");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: editValues.title.trim(),
        description: editValues.description,
        content: editValues.content,
        seoTitle: editValues.seoTitle,
        seoDescription: editValues.seoDescription,
        isInMenu: editValues.isInMenu,
        menuOrder: editValues.menuOrder,
        status: editValues.isPublished ? "published" : "draft",
      };
      const response = creating
        ? await csrfFetch("/api/cms/pages", { method: "POST", body: JSON.stringify({ ...payload, slug: editValues.slug.trim().toLowerCase() }) })
        : await csrfFetch(`/api/cms/pages/${encodeURIComponent(editingSlug || editValues.slug)}`, { method: "PATCH", body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Не удалось сохранить страницу");
      const saved = result.page as CmsPageRecord;
      setPages((current) => creating ? [saved, ...current] : current.map((page) => page.slug === editingSlug ? saved : page));
      setEditingSlug(null);
      setCreating(false);
      setEditValues(EMPTY_CMS_PAGE);
      toast.success("Страница сохранена в PostgreSQL");
    } catch (error) {
      toast.error("Ошибка сохранения", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally { setSaving(false); }
  };

  const removePage = async (page: CmsPageRecord) => {
    if (saving || !window.confirm(`Удалить страницу «${page.title}»? Она будет перемещена в архив.`)) return;
    setSaving(true);
    try {
      const response = await csrfFetch(`/api/cms/pages/${encodeURIComponent(page.slug)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось удалить страницу");
      setPages((current) => current.filter((item) => item.id !== page.id));
      toast.success("Страница перемещена в архив");
    } catch (error) {
      toast.error("Ошибка удаления", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally { setSaving(false); }
  };

  const beginCreate = () => {
    setCreating(true);
    setEditingSlug(null);
    setEditValues(EMPTY_CMS_PAGE);
  };

  const beginEdit = (page: CmsPageRecord) => {
    setCreating(false);
    setEditingSlug(page.slug);
    setEditValues(toCmsPageEditor(page));
  };

  const cancelEdit = () => {
    setCreating(false);
    setEditingSlug(null);
    setEditValues(EMPTY_CMS_PAGE);
  };

  const isEditing = creating || editingSlug !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Edit className="h-6 w-6 text-primary" />Страницы сайта</h1>
          <p className="text-sm text-muted-foreground">FAQ, О нас, Условия и другие страницы. Черновики и публикации хранятся в PostgreSQL.</p>
        </div>
        {!isEditing && <Button onClick={beginCreate}><Plus className="h-4 w-4 mr-1" /> Новая страница</Button>}
      </div>

      {isEditing ? (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">{creating ? "Новая страница" : `Редактирование / ${editingSlug}`}</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={saving} onClick={cancelEdit}>Отмена</Button>
              <Button size="sm" disabled={saving} onClick={savePage}>{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}Сохранить</Button>
            </div>
          </div>
          {creating && <div><Label className="text-xs">URL (slug)</Label><Input value={editValues.slug} onChange={(event) => setEditValues({ ...editValues, slug: event.target.value.replace(/[^a-zA-Z0-9а-яА-Я_-]/g, "-") })} placeholder="about-us" maxLength={120} /></div>}
          <div><Label className="text-xs">Заголовок</Label><Input value={editValues.title} onChange={(event) => setEditValues({ ...editValues, title: event.target.value })} maxLength={180} /></div>
          <div><Label className="text-xs">Краткое описание</Label><Textarea value={editValues.description} onChange={(event) => setEditValues({ ...editValues, description: event.target.value })} rows={2} maxLength={500} /></div>
          <div><Label className="text-xs">SEO Title</Label><Input value={editValues.seoTitle} onChange={(event) => setEditValues({ ...editValues, seoTitle: event.target.value })} maxLength={180} /></div>
          <div><Label className="text-xs">SEO Description</Label><Textarea value={editValues.seoDescription} onChange={(event) => setEditValues({ ...editValues, seoDescription: event.target.value })} rows={2} maxLength={500} /></div>
          <div><Label className="text-xs">Содержимое (Markdown)</Label><MarkdownEditor value={editValues.content} onChange={(content) => setEditValues({ ...editValues, content })} minHeight={360} /></div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={editValues.isPublished} onCheckedChange={(value) => setEditValues({ ...editValues, isPublished: !!value })} />Опубликована</label>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={editValues.isInMenu} onCheckedChange={(value) => setEditValues({ ...editValues, isInMenu: !!value })} />Показывать в меню</label>
          </div>
        </Card>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка страниц…</div>
      ) : (
        <div className="space-y-3">
          {pages.map((page) => (
            <Card key={page.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm flex flex-wrap items-center gap-2">
                    {page.title}<Badge variant="outline" className="text-[10px]">/{page.slug}</Badge>
                    <Badge className={page.status === "published" ? "bg-emerald-100 text-emerald-800 text-[10px]" : "bg-slate-100 text-slate-800 text-[10px]"}>{page.status === "published" ? "Опубликована" : "Черновик"}</Badge>
                  </div>
                  {page.description && <div className="text-xs text-muted-foreground mt-1">{page.description}</div>}
                  <div className="text-xs text-muted-foreground mt-2 line-clamp-2">{page.content?.slice(0, 180)}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">Обновлено: {formatDate(page.updated_at)}</div>
                  {page.status === "published" && <a href={`/pages/${encodeURIComponent(page.slug)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2">Открыть страницу <ExternalLink className="h-3 w-3" /></a>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="outline" disabled={saving} onClick={() => beginEdit(page)}><Edit className="h-3 w-3 mr-1" />Редактировать</Button>
                  <Button size="icon" variant="ghost" disabled={saving} className="text-destructive" onClick={() => removePage(page)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            </Card>
          ))}
          {pages.length === 0 && <Card className="p-10 text-center text-sm text-muted-foreground">Страниц пока нет. Создайте первую.</Card>}
        </div>
      )}
    </div>
  );
}

// ==================== CMS: НАСТРОЙКИ САЙТА ====================
type CmsSiteSetting = {
  key: string;
  value: string;
  value_type: string;
  description: string | null;
  category: string;
  is_public: boolean;
};

export function AdminSettingsTab() {
  const [siteSettings, setSiteSettings] = useState<CmsSiteSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("general");
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [promoEnabled, setPromoEnabled] = useState(false);
  const [promoLoading, setPromoLoading] = useState(false);

  const loadSettings = async (signal?: AbortSignal) => {
    const response = await csrfFetch("/api/cms/settings", { signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Не удалось загрузить настройки");
    setSiteSettings(Array.isArray(payload.settings) ? payload.settings : []);
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadSettings(controller.signal)
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") toast.error("Ошибка загрузки настроек", { description: error.message });
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    csrfFetch("/api/admin/promo-popup")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data) setPromoEnabled(Boolean(data.enabled)); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const handleTogglePromo = async () => {
    setPromoLoading(true);
    try {
      const response = await csrfFetch("/api/admin/promo-popup", {
        method: "POST",
        body: JSON.stringify({ enabled: !promoEnabled }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось изменить промо-попап");
      setPromoEnabled(!promoEnabled);
      toast.success(`Промо-попап ${!promoEnabled ? "включён" : "выключен"}`);
    } catch (error) {
      toast.error("Ошибка", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally { setPromoLoading(false); }
  };

  const handleSave = async (key: string) => {
    if (editValues[key] === undefined || savingKey) return;
    setSavingKey(key);
    try {
      const response = await csrfFetch("/api/cms/settings", {
        method: "PUT",
        body: JSON.stringify({ key, value: editValues[key] }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить настройку");
      setSiteSettings((current) => current.map((setting) => setting.key === key ? payload.setting : setting));
      setEditValues((current) => { const next = { ...current }; delete next[key]; return next; });
      toast.success(`Настройка «${key}» сохранена в PostgreSQL`);
    } catch (error) {
      toast.error("Ошибка сохранения", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally { setSavingKey(null); }
  };

  const filtered = siteSettings.filter((setting) => setting.category === activeCategory);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Settings className="h-6 w-6 text-primary" />Настройки сайта</h1>
        <p className="text-sm text-muted-foreground">Настройки загружаются из PostgreSQL; сохранение выполняется через защищённый API.</p>
      </div>

      <Card className={`p-4 ${promoEnabled ? "border-emerald-300 bg-emerald-50/30" : "border-muted"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${promoEnabled ? "bg-emerald-100" : "bg-muted"}`}><Gift className={`h-5 w-5 ${promoEnabled ? "text-emerald-600" : "text-muted-foreground"}`} /></div>
            <div><div className="font-semibold text-sm">Промо-попап на главной</div><div className="text-xs text-muted-foreground">{promoEnabled ? "Включён" : "Выключен"}</div></div>
          </div>
          <Button onClick={handleTogglePromo} disabled={promoLoading} variant={promoEnabled ? "destructive" : "default"} size="sm" className="gap-2">
            {promoLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : promoEnabled ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            {promoEnabled ? "Выключить" : "Включить"}
          </Button>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        {SETTING_CATEGORIES.map((category) => (
          <button key={category.id} onClick={() => setActiveCategory(category.id)} className={`px-3 py-1.5 text-xs rounded-full border flex items-center gap-1 ${activeCategory === category.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/40"}`}>
            <span>{category.icon}</span>{category.label}
          </button>
        ))}
      </div>

      <Card className="p-4">
        {loading ? <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка настроек…</div> : (
          <div className="space-y-2">
            {filtered.map((setting) => (
              <div key={setting.key} className="flex flex-col sm:flex-row sm:items-center gap-3 p-2 border border-border rounded">
                <div className="flex-1 min-w-0"><div className="text-sm font-medium">{setting.description || setting.key}</div><div className="text-[10px] text-muted-foreground font-mono">{setting.key}</div></div>
                <Input value={editValues[setting.key] !== undefined ? editValues[setting.key] : setting.value} onChange={(event) => setEditValues((current) => ({ ...current, [setting.key]: event.target.value }))} className="sm:w-64 h-8 text-sm" />
                <Button size="sm" variant="outline" className="h-8" disabled={editValues[setting.key] === undefined || savingKey !== null} onClick={() => handleSave(setting.key)}>
                  {savingKey === setting.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                </Button>
              </div>
            ))}
            {filtered.length === 0 && <div className="text-center text-sm text-muted-foreground py-8">В этой категории нет доступных настроек.</div>}
          </div>
        )}
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
type CmsNavItem = {
  id: string;
  location: string;
  label: string;
  url: string;
  sort_order: number;
  is_active: boolean;
};

export function AdminNavMenuTab() {
  const [items, setItems] = useState<CmsNavItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newItem, setNewItem] = useState({ label: "", url: "", location: "header" });

  const loadItems = async (signal?: AbortSignal) => {
    const response = await csrfFetch("/api/cms/nav-menu?include_inactive=true", { signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Не удалось загрузить меню");
    setItems(Array.isArray(payload.items) ? payload.items : []);
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadItems(controller.signal)
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") toast.error("Ошибка загрузки меню", { description: error.message });
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const patchItem = async (item: CmsNavItem, updates: Partial<CmsNavItem>) => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await csrfFetch(`/api/cms/nav-menu/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          label: updates.label ?? item.label,
          url: updates.url ?? item.url,
          location: updates.location ?? item.location,
          sortOrder: updates.sort_order ?? item.sort_order,
          isActive: updates.is_active ?? item.is_active,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить пункт меню");
      setItems((current) => current.map((entry) => entry.id === item.id ? payload.item : entry));
      toast.success("Пункт меню сохранён");
    } catch (error) {
      toast.error("Ошибка сохранения", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally { setSaving(false); }
  };

  const createItem = async () => {
    if (saving || !newItem.label.trim() || !newItem.url.trim()) return;
    setSaving(true);
    try {
      const response = await csrfFetch("/api/cms/nav-menu", {
        method: "POST",
        body: JSON.stringify({ ...newItem, sortOrder: items.filter((item) => item.location === newItem.location).length, isActive: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось создать пункт меню");
      setItems((current) => [...current, payload.item]);
      setNewItem({ label: "", url: "", location: "header" });
      toast.success("Пункт меню создан");
    } catch (error) {
      toast.error("Ошибка создания", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally { setSaving(false); }
  };

  const removeItem = async (item: CmsNavItem) => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await csrfFetch(`/api/cms/nav-menu/${item.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось удалить пункт меню");
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      toast.success("Пункт меню удалён");
    } catch (error) {
      toast.error("Ошибка удаления", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><LayoutDashboard className="h-6 w-6 text-primary" />Навигация</h1>
        <p className="text-sm text-muted-foreground">Управление пунктами меню шапки, подвала и мобильной версии. Изменения сохраняются в PostgreSQL.</p>
      </div>
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold text-sm">Добавить пункт меню</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input value={newItem.label} onChange={(event) => setNewItem({ ...newItem, label: event.target.value })} placeholder="Название" maxLength={100} />
          <Input value={newItem.url} onChange={(event) => setNewItem({ ...newItem, url: event.target.value })} placeholder="/catalog" maxLength={2048} />
          <Select value={newItem.location} onValueChange={(value) => setNewItem({ ...newItem, location: value })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="header">Шапка</SelectItem><SelectItem value="footer">Подвал</SelectItem><SelectItem value="mobile">Мобильное</SelectItem></SelectContent>
          </Select>
        </div>
        <Button size="sm" disabled={saving || !newItem.label.trim() || !newItem.url.trim()} onClick={createItem}><Plus className="h-3 w-3 mr-1" />Добавить</Button>
      </Card>

      <Card className="p-4">
        {loading ? <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка меню…</div> : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_140px_90px_auto] items-center gap-2 p-2 border border-border rounded">
                <Input defaultValue={item.label} key={`${item.id}-label-${item.label}`} maxLength={100} className="h-8 text-sm" onBlur={(event) => { if (event.target.value !== item.label) patchItem(item, { label: event.target.value }); }} />
                <Input defaultValue={item.url} key={`${item.id}-url-${item.url}`} maxLength={2048} className="h-8 text-sm" onBlur={(event) => { if (event.target.value !== item.url) patchItem(item, { url: event.target.value }); }} />
                <Select value={item.location} onValueChange={(value) => patchItem(item, { location: value })}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="header">Шапка</SelectItem><SelectItem value="footer">Подвал</SelectItem><SelectItem value="mobile">Мобильное</SelectItem></SelectContent>
                </Select>
                <Input type="number" min={0} max={10000} defaultValue={item.sort_order} key={`${item.id}-order-${item.sort_order}`} className="h-8 text-sm" onBlur={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value !== item.sort_order) patchItem(item, { sort_order: value }); }} />
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" disabled={saving} onClick={() => patchItem(item, { is_active: !item.is_active })}>{item.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</Button>
                  <Button size="icon" variant="ghost" disabled={saving} className="text-destructive" onClick={() => removeItem(item)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
            {items.length === 0 && <div className="text-center text-sm text-muted-foreground py-8">Пункты меню не созданы.</div>}
          </div>
        )}
      </Card>
    </div>
  );
}



type CmsMediaItem = {
  id: string;
  name: string;
  url: string;
  type: "image" | "video" | "audio" | "document";
  size_bytes: number;
  mime_type: string;
  created_at: string;
};

function formatMediaSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function AdminCmsMediaTab() {
  const [media, setMedia] = useState<CmsMediaItem[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const query = filter === "all" ? "" : `?type=${encodeURIComponent(filter)}`;
    fetch(`/api/cms/media${query}`, { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Не удалось загрузить медиатеку");
        if (!controller.signal.aborted) setMedia(Array.isArray(payload.media) ? payload.media : []);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") toast.error("Медиатека недоступна", { description: error.message });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filter]);

  const uploadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploading) return;
    if (file.size <= 0 || file.size > 50 * 1024 * 1024) {
      toast.error("Недопустимый размер файла", { description: "Максимальный размер — 50 МБ" });
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    setUploading(true);
    try {
      const response = await csrfFetch("/api/cms/media", { method: "POST", body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить файл");
      const uploaded = payload.media as CmsMediaItem;
      if (filter === "all" || uploaded.type === filter) {
        setMedia((current) => [uploaded, ...current.filter((item) => item.id !== uploaded.id)].slice(0, 100));
      }
      toast.success("Файл загружен в медиатеку");
    } catch (error) {
      toast.error("Ошибка загрузки", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally {
      setUploading(false);
    }
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Ссылка скопирована");
    } catch {
      toast.error("Не удалось скопировать ссылку");
    }
  };

  const typeIcon = (type: CmsMediaItem["type"]) => {
    if (type === "video") return <Video className="h-8 w-8" />;
    if (type === "audio") return <Music2 className="h-8 w-8" />;
    if (type === "document") return <FileText className="h-8 w-8" />;
    return <ImageIcon className="h-8 w-8" />;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold flex items-center gap-2"><ImageIcon className="h-6 w-6 text-primary" />Медиатека CMS</h2>
          <p className="text-sm text-muted-foreground">Изображения, видео, аудио и документы для страниц и баннеров. Максимальный размер файла — 50 МБ.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Все файлы" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все файлы</SelectItem>
              <SelectItem value="image">Изображения</SelectItem>
              <SelectItem value="video">Видео</SelectItem>
              <SelectItem value="audio">Аудио</SelectItem>
              <SelectItem value="document">Документы</SelectItem>
            </SelectContent>
          </Select>
          <label className="inline-flex cursor-pointer">
            <Input
              type="file"
              className="sr-only"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/wav,application/pdf"
              disabled={uploading}
              onChange={uploadFile}
            />
            <span className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {uploading ? "Загрузка…" : "Загрузить"}
            </span>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка медиатеки…</div>
      ) : media.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Файлов пока нет. Загрузите первый материал для баннера или страницы.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {media.map((item) => (
            <Card key={item.id} className="overflow-hidden">
              <div className="flex h-40 items-center justify-center bg-muted/40">
                {item.type === "image" ? (
                  <img src={item.url} alt={item.name} className="h-full w-full object-contain" loading="lazy" decoding="async" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">{typeIcon(item.type)}<Badge variant="secondary">{item.type}</Badge></div>
                )}
              </div>
              <div className="space-y-2 p-3">
                <div className="truncate text-sm font-medium" title={item.name}>{item.name}</div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{formatMediaSize(item.size_bytes)} · {item.mime_type}</span>
                  <span>{formatDate(item.created_at)}</span>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" className="flex-1" onClick={() => copyUrl(item.url)}><Copy className="mr-1 h-3.5 w-3.5" />Скопировать URL</Button>
                  <Button type="button" size="sm" variant="ghost" asChild aria-label="Открыть файл"><a href={item.url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminDesignTab() {
  type DesignSettings = {
    id: string;
    theme: string;
    primary_color: string;
    accent_color: string;
    background_color: string;
    text_color: string;
    font_heading: string;
    font_body: string;
    layout_style: string;
    max_width: number;
    animations_enabled: boolean;
  };
  const defaults: Omit<DesignSettings, "id"> = {
    theme: "default", primary_color: "#8B2942", accent_color: "#D97706",
    background_color: "#F7F2E8", text_color: "#1F2937",
    font_heading: "Brokgauz_amp_Efron-Italic", font_body: "Geist",
    layout_style: "classic", max_width: 1280, animations_enabled: true,
  };
  const [design, setDesign] = useState<DesignSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/cms/design", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Не удалось загрузить дизайн")))
      .then((payload: { design: DesignSettings | null }) => {
        if (!controller.signal.aborted) setDesign(payload.design || { id: "", ...defaults });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) toast.error("Ошибка загрузки дизайна", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const update = (patch: Partial<DesignSettings>) => setDesign((current) => current ? { ...current, ...patch } : current);
  const save = async () => {
    if (!design || saving) return;
    setSaving(true);
    try {
      const response = await csrfFetch("/api/cms/design", {
        method: "PUT",
        body: JSON.stringify({
          theme: design.theme,
          primaryColor: design.primary_color,
          accentColor: design.accent_color,
          backgroundColor: design.background_color,
          textColor: design.text_color,
          fontHeading: design.font_heading,
          fontBody: design.font_body,
          layoutStyle: design.layout_style,
          maxWidth: design.max_width,
          animationsEnabled: design.animations_enabled,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить дизайн");
      setDesign(payload.design);
      toast.success("Настройки дизайна сохранены");
    } catch (error) {
      toast.error("Ошибка сохранения", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка дизайн-системы…</div>;
  if (!design) return <Card className="p-6 text-sm text-muted-foreground">Не удалось загрузить дизайн-систему. Обновите страницу после проверки подключения.</Card>;

  const colorFields = [
    { key: "primary_color" as const, label: "Основной цвет" },
    { key: "accent_color" as const, label: "Акцентный цвет" },
    { key: "background_color" as const, label: "Фон" },
    { key: "text_color" as const, label: "Текст" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Palette className="h-6 w-6 text-primary" />Визуальный стиль сайта</h1>
          <p className="text-sm text-muted-foreground">Управление безопасными дизайн-токенами. Произвольный JavaScript и CSS через CMS не исполняются.</p>
        </div>
        <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Сохранить</Button>
      </div>

      <Card className="p-4 space-y-4">
        <h3 className="font-semibold text-sm">Цветовая палитра</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {colorFields.map((field) => (
            <div key={field.key} className="flex items-center gap-3 border border-border rounded-lg p-3">
              <Input type="color" value={design[field.key]} onChange={(event) => update({ [field.key]: event.target.value })} className="h-10 w-14 p-1" />
              <div className="flex-1 min-w-0"><div className="text-sm font-medium">{field.label}</div><div className="text-xs font-mono text-muted-foreground">{design[field.key]}</div></div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="font-semibold text-sm">Типографика и компоновка</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>Шрифт заголовков</Label><Input value={design.font_heading} maxLength={80} onChange={(event) => update({ font_heading: event.target.value })} /></div>
          <div><Label>Шрифт основного текста</Label><Input value={design.font_body} maxLength={80} onChange={(event) => update({ font_body: event.target.value })} /></div>
          <div><Label>Стиль макета</Label><Select value={design.layout_style} onValueChange={(value) => update({ layout_style: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="classic">Классический</SelectItem><SelectItem value="modern">Современный</SelectItem><SelectItem value="minimal">Минималистичный</SelectItem></SelectContent></Select></div>
          <div><Label>Максимальная ширина: {design.max_width} px</Label><Input type="number" min={960} max={1600} step={40} value={design.max_width} onChange={(event) => update({ max_width: Math.max(960, Math.min(1600, Number(event.target.value) || 1280)) })} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={design.animations_enabled} onCheckedChange={(value) => update({ animations_enabled: !!value })} />Разрешить анимации интерфейса</label>
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="font-semibold text-sm">Предварительный просмотр</h3>
        <div className="rounded-xl border p-5 space-y-3" style={{ backgroundColor: design.background_color, color: design.text_color, maxWidth: design.max_width, marginInline: "auto" }}>
          <div className="text-xs uppercase tracking-wider opacity-70">Conditera · preview</div>
          <div className="text-2xl font-semibold" style={{ fontFamily: design.font_heading }}>Вкус начинается с идеи</div>
          <p className="text-sm opacity-80" style={{ fontFamily: design.font_body }}>Так будут сочетаться заголовки, основной текст и акцентные элементы.</p>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-md px-4 py-2 text-sm text-white" style={{ backgroundColor: design.primary_color }}>Основное действие</span>
            <span className="rounded-md px-4 py-2 text-sm text-white" style={{ backgroundColor: design.accent_color }}>Акцент</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
