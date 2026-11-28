"use client";

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
  { key: "advantages", label: "Преимущества", icon: "⭐" },
  { key: "steps", label: "Шаги заказа", icon: "📋" },
  { key: "stats", label: "Статистика", icon: "📊" },
  { key: "testimonials", label: "Отзывы", icon: "💬" },
  { key: "cta_confectioner", label: "CTA для кондитеров", icon: "📢" },
] as const;

type CmsHomeSection = {
  key: string;
  label: string;
  icon: string;
  sortOrder: number;
  isEnabled: boolean;
};

function sortCmsHomeSections(sections: CmsHomeSection[]) {
  return [...sections].sort((a, b) => {
    if (a.key === "hero") return b.key === "hero" ? 0 : -1;
    if (b.key === "hero") return 1;
    return a.sortOrder - b.sortOrder || a.key.localeCompare(b.key);
  });
}

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

export function AdminCmsHomeBlocksTab() {
  const [cmsBlocks, setCmsBlocks] = useState<CmsHomeBlock[]>([]);
  const [cmsSections, setCmsSections] = useState<CmsHomeSection[]>(DEFAULT_CMS_HOME_SECTIONS);
  const [editingSectionKey, setEditingSectionKey] = useState<string | null>(null);
  const [sectionTitleDraft, setSectionTitleDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<CmsHomeBlock>>({});
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [mediaPickerLoading, setMediaPickerLoading] = useState(false);
  const [mediaItems, setMediaItems] = useState<Array<{ id: string; name: string; url: string }>>([]);


  const loadBlocks = async (signal?: AbortSignal) => {
    const [blocksResponse, sectionsResponse] = await Promise.all([
      fetch("/api/cms/home-blocks", { credentials: "include", signal }),
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
    const ordered = sortCmsHomeSections(cmsSections);
    const index = ordered.findIndex((section) => section.key === sectionKey);
    const target = index + direction;
    if (sectionKey === "hero" || index < 0 || target < 1 || target >= ordered.length) return;
    const [moving] = ordered.splice(index, 1);
    ordered.splice(target, 0, moving);
    void persistHomeSections(ordered);
  };

  const toggleHomeSection = (sectionKey: string) => {
    const ordered = sortCmsHomeSections(cmsSections);
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
    const next = sortCmsHomeSections(cmsSections)
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

  const openMediaPicker = async () => {
    setMediaPickerOpen(true);
    setMediaPickerLoading(true);
    try {
      const response = await fetch("/api/cms/media?type=image", { credentials: "include", cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить медиатеку");
      setMediaItems(Array.isArray(payload.media) ? payload.media : []);
    } catch (error) {
      toast.error("Медиатека недоступна", {
        description: error instanceof Error ? error.message : "Неизвестная ошибка",
      });
    } finally {
      setMediaPickerLoading(false);
    }
  };

  const saveEdit = async () => {
    if (!editingId || saving) return;
    setSaving(true);
    try {
      const response = await csrfFetch(`/api/cms/home-blocks/${editingId}`, {
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
      const response = await csrfFetch("/api/cms/home-blocks", {
        method: "POST",
        body: JSON.stringify({
          section, title: "Новый блок", subtitle: "", content: "",
          image: "", link: "", linkText: "", sortOrder, isActive: true,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось создать блок");
      const createdBlock = mapCmsHomeBlock(payload.block);
      setCmsBlocks((current) => [...current, createdBlock]);
      setEditingId(createdBlock.id);
      setEditValues(createdBlock);
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
      const response = await csrfFetch(`/api/cms/home-blocks/${block.id}`, {
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
      const response = await csrfFetch(`/api/cms/home-blocks/${block.id}`, { method: "DELETE" });
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
      ) : sortCmsHomeSections(cmsSections).map((section, sectionIndex, orderedSections) => {
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
                {section.key === "hero" && <Badge variant="outline" className="text-[10px]">Первый экран</Badge>}
                {!section.isEnabled && <Badge variant="outline" className="text-[10px]">Секция скрыта</Badge>}
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Переместить секцию выше" title="Переместить секцию выше" disabled={saving || section.key === "hero" || sectionIndex <= 1} onClick={() => moveHomeSection(section.key, -1)}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Переместить секцию ниже" title="Переместить секцию ниже" disabled={saving || section.key === "hero" || sectionIndex === orderedSections.length - 1} onClick={() => moveHomeSection(section.key, 1)}>
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
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Input value={editValues.image || ""} onChange={(e) => setEditValues({ ...editValues, image: e.target.value })} className="h-8 text-sm" placeholder="URL изображения или выберите из медиатеки" />
                          <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={saving} onClick={() => void openMediaPicker()}>
                            <ImageIcon className="h-3.5 w-3.5 mr-1" />Медиатека
                          </Button>
                        </div>
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
      <Dialog open={mediaPickerOpen} onOpenChange={setMediaPickerOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Выбор изображения из медиатеки</DialogTitle>
            <DialogDescription>Выберите ранее загруженное изображение для блока главной страницы.</DialogDescription>
          </DialogHeader>
          {mediaPickerLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />Загрузка изображений…
            </div>
          ) : mediaItems.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              В медиатеке пока нет изображений. Сначала загрузите файл во вкладке «Медиатека».
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {mediaItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="group overflow-hidden rounded-lg border border-border text-left hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => {
                    setEditValues((current) => ({ ...current, image: item.url }));
                    setMediaPickerOpen(false);
                  }}
                >
                  <img src={item.url} alt={item.name} className="aspect-[4/3] w-full object-cover" loading="lazy" decoding="async" />
                  <span className="block truncate px-2 py-2 text-xs">{item.name}</span>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
