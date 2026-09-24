"use client";

/**
 * ServicesManager — CRUD объявлений услуг (аниматоры, шоу, квесты,
 * мастер-классы, фото) через /api/services (таблица service_products).
 *
 * Операции: список своих (GET ?mine=1), создание (POST), редактирование
 * (PATCH), пауза/возврат публикации (PATCH is_active), удаление (DELETE).
 * Все мутации несут x-csrf-token (double-submit cookie).
 * Роли: ANIMATOR_AGENCY, RECREATION_CENTER, KIDS_CLUB, VENUE_OWNER,
 * EVENT_ORGANIZER, FOOD_SERVICE, ADMIN. Ownership проверяется на сервере.
 *
 * Цены вводятся в рублях, хранятся в копейках.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Plus, Trash2, Loader2, Sparkles, Eye, EyeOff, ImagePlus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/finance";
import { SERVICE_CATEGORIES } from "@/lib/mock-data-services";
import { getSessionAuthHeaders } from "@/lib/api-client";

interface ServiceRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  price_type: string;
  price: number; // копейки
  old_price: number | null;
  duration_minutes: number | null;
  age_min: number | null;
  age_max: number | null;
  city: string | null;
  service_format: string;
  images: string[] | null;
  tags: string[] | null;
  includes: string[] | null;
  safety_note: string | null;
  customizable: boolean | null;
  is_active: boolean;
  rating: number | null;
  bookings_count: number | null;
}

interface FormState {
  title: string;
  description: string;
  category: string;
  priceType: string;
  price: string; // рубли
  oldPrice: string; // рубли
  durationMinutes: string;
  ageMin: string;
  ageMax: string;
  city: string;
  serviceFormat: string;
  includes: string;
  tags: string;
  safetyNote: string;
  customizable: boolean;
  images: string[];
}

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  category: "animator_clown",
  priceType: "fixed",
  price: "0",
  oldPrice: "",
  durationMinutes: "",
  ageMin: "",
  ageMax: "",
  city: "",
  serviceFormat: "travel",
  includes: "",
  tags: "",
  safetyNote: "",
  customizable: false,
  images: [],
};

const PRICE_TYPE_LABELS: Record<string, string> = {
  fixed: "за услугу",
  per_hour: "за час",
  per_event: "за мероприятие",
  per_guest: "за человека",
};

const FORMAT_LABELS: Record<string, string> = {
  venue: "у себя на площадке",
  travel: "выезд к клиенту",
  both: "у себя и с выездом",
};

async function getCsrfToken(): Promise<string> {
  const res = await fetch("/api/csrf-token");
  if (!res.ok) throw new Error("Не удалось получить CSRF-токен");
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("CSRF-токен не получен");
  return data.token;
}

function mutationHeaders(csrf: string): HeadersInit {
  return { "Content-Type": "application/json", "x-csrf-token": csrf };
}

function rubToKop(v: string): number {
  return Math.round((Number(v) || 0) * 100);
}

function kopToRubStr(kop: number | null | undefined): string {
  if (kop == null) return "";
  return String(kop / 100);
}

export function ServicesManager() {
  const [items, setItems] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/services?mine=1&limit=100");
      const data = (await res.json()) as { services?: ServiceRow[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      setItems(data.services || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить объявления");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (s: ServiceRow) => {
    setEditingId(s.id);
    setForm({
      title: s.title,
      description: s.description || "",
      category: s.category,
      priceType: s.price_type || "fixed",
      price: kopToRubStr(s.price),
      oldPrice: kopToRubStr(s.old_price),
      durationMinutes: s.duration_minutes ? String(s.duration_minutes) : "",
      ageMin: s.age_min != null ? String(s.age_min) : "",
      ageMax: s.age_max != null ? String(s.age_max) : "",
      city: s.city || "",
      serviceFormat: s.service_format || "travel",
      includes: (s.includes || []).join(", "),
      tags: (s.tags || []).join(", "),
      safetyNote: s.safety_note || "",
      customizable: Boolean(s.customizable),
      images: s.images || [],
    });
    setDialogOpen(true);
  };

  const buildPayload = (withRole = false) => ({
    ...(withRole ? { provider_role: "ANIMATOR_AGENCY" } : {}),
    title: form.title.trim(),
    description: form.description.trim() || null,
    category: form.category,
    price_type: form.priceType,
    price: rubToKop(form.price),
    old_price: form.oldPrice ? rubToKop(form.oldPrice) : null,
    duration_minutes: form.durationMinutes ? Number(form.durationMinutes) : null,
    age_min: form.ageMin ? Number(form.ageMin) : null,
    age_max: form.ageMax ? Number(form.ageMax) : null,
    city: form.city.trim() || null,
    service_format: form.serviceFormat,
    includes: form.includes.split(",").map((s) => s.trim()).filter(Boolean),
    tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
    safety_note: form.safetyNote.trim() || null,
    customizable: form.customizable,
    images: form.images,
  });

  /** Загрузка фото в Storage (product_images) через /api/services/upload. */
  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const csrf = await getCsrfToken();
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("files", f));
      const res = await fetch("/api/services/upload", {
        method: "POST",
        headers: await getSessionAuthHeaders(csrf, { json: false }),
        body: fd,
      });
      const data = (await res.json()) as { urls?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки фото");
      setForm((prev) => ({
        ...prev,
        images: [...prev.images, ...(data.urls || [])].slice(0, 8),
      }));
      toast.success(`Фото загружены (${(data.urls || []).length})`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка загрузки фото");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const addImageUrl = () => {
    const url = window.prompt("URL фото (https://…)");
    if (!url) return;
    if (!/^https?:\/\//.test(url)) {
      toast.error("URL должен начинаться с http(s)://");
      return;
    }
    setForm((prev) => ({ ...prev, images: [...prev.images, url].slice(0, 8) }));
  };

  const removeImage = (idx: number) => {
    setForm((prev) => ({ ...prev, images: prev.images.filter((_, i) => i !== idx) }));
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error("Укажите название услуги");
      return;
    }
    if (Number(form.price) < 0) {
      toast.error("Цена не может быть отрицательной");
      return;
    }
    setSaving(true);
    try {
      const csrf = await getCsrfToken();
      const url = editingId ? `/api/services/${editingId}` : "/api/services";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: mutationHeaders(csrf),
        body: JSON.stringify(buildPayload(!editingId)),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Ошибка сохранения");
      toast.success(editingId ? "Объявление обновлено" : "Объявление опубликовано");
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (s: ServiceRow) => {
    try {
      const csrf = await getCsrfToken();
      const res = await fetch(`/api/services/${s.id}`, {
        method: "PATCH",
        headers: mutationHeaders(csrf),
        body: JSON.stringify({ is_active: !s.is_active }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Ошибка");
      toast.success(s.is_active ? "Объявление снято с публикации" : "Объявление снова активно");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Удалить объявление «${title}»?`)) return;
    try {
      const csrf = await getCsrfToken();
      const res = await fetch(`/api/services/${id}`, {
        method: "DELETE",
        headers: mutationHeaders(csrf),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Ошибка удаления");
      toast.success("Объявление удалено");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const categoryLabel = (v: string) =>
    SERVICE_CATEGORIES.find((c) => c.slug === v)?.name || v;

  if (loading) {
    return (
      <Card className="p-12 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground mt-2">Загружаем ваши объявления…</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Объявления услуг</h2>
          <p className="text-sm text-muted-foreground">
            Публикуются в разделе «Услуги» — их видят все покупатели платформы
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />Добавить услугу
        </Button>
      </div>

      {items.length === 0 ? (
        <Card className="p-8 text-center">
          <Sparkles className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-4">
            Пока нет объявлений. Создайте первое — покупатели увидят его в разделе «Услуги».
          </p>
          <Button onClick={openCreate}>Создать объявление</Button>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {items.map((s) => (
            <Card key={s.id} className={`p-4 ${!s.is_active ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-start gap-2 min-w-0">
                  {s.images && s.images.length > 0 && (
                    <img
                      src={s.images[0]}
                      alt={s.title}
                      className="h-11 w-11 rounded-md object-cover border border-border shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{s.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {categoryLabel(s.category)} • {PRICE_TYPE_LABELS[s.price_type] || s.price_type}
                      {s.city ? ` • ${s.city}` : ""}
                    </div>
                  </div>
                </div>
                <Badge variant={s.is_active ? "default" : "secondary"} className="shrink-0 text-[10px]">
                  {s.is_active ? "Активно" : "На паузе"}
                </Badge>
              </div>

              {s.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{s.description}</p>
              )}

              <div className="flex items-center justify-between">
                <div className="font-display font-bold">
                  {formatCurrency(s.price / 100)}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-7 w-7"
                    title={s.is_active ? "Снять с публикации" : "Опубликовать"}
                    onClick={() => handleToggleActive(s)}
                  >
                    {s.is_active ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-7 w-7"
                    onClick={() => openEdit(s)}
                    title="Редактировать"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-7 w-7 text-destructive"
                    onClick={() => handleDelete(s.id, s.title)}
                    title="Удалить"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Редактировать услугу" : "Новое объявление услуги"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="svc-title">Название *</Label>
              <Input
                id="svc-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Аниматор-клоун «Бублик»"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Категория</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm({ ...form, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_CATEGORIES.map((c) => (
                      <SelectItem key={c.slug} value={c.slug}>
                        {c.icon} {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Формат</Label>
                <Select
                  value={form.serviceFormat}
                  onValueChange={(v) => setForm({ ...form, serviceFormat: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Тип цены</Label>
                <Select
                  value={form.priceType}
                  onValueChange={(v) => setForm({ ...form, priceType: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRICE_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="svc-price">Цена, ₽ *</Label>
                <Input
                  id="svc-price"
                  type="number"
                  min="0"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="svc-old-price">Старая цена, ₽</Label>
                <Input
                  id="svc-old-price"
                  type="number"
                  min="0"
                  value={form.oldPrice}
                  onChange={(e) => setForm({ ...form, oldPrice: e.target.value })}
                  placeholder="необяз."
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="svc-duration">Длительность, мин</Label>
                <Input
                  id="svc-duration"
                  type="number"
                  min="0"
                  value={form.durationMinutes}
                  onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                  placeholder="90"
                />
              </div>
              <div>
                <Label htmlFor="svc-age-min">Возраст от</Label>
                <Input
                  id="svc-age-min"
                  type="number"
                  min="0"
                  value={form.ageMin}
                  onChange={(e) => setForm({ ...form, ageMin: e.target.value })}
                  placeholder="3"
                />
              </div>
              <div>
                <Label htmlFor="svc-age-max">Возраст до</Label>
                <Input
                  id="svc-age-max"
                  type="number"
                  min="0"
                  value={form.ageMax}
                  onChange={(e) => setForm({ ...form, ageMax: e.target.value })}
                  placeholder="10"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="svc-city">Город</Label>
              <Input
                id="svc-city"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                placeholder="Москва"
              />
            </div>

            <div>
              <Label htmlFor="svc-description">Описание</Label>
              <Textarea
                id="svc-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Что входит в услугу, формат программы, реквизит…"
                rows={3}
              />
            </div>

            {/* Фото объявления — Storage (product_images), до 8 штук */}
            <div>
              <Label>Фотографии ({form.images.length}/8)</Label>
              {form.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {form.images.map((url, idx) => (
                    <div key={`${url}-${idx}`} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`Фото ${idx + 1}`}
                        className="h-16 w-16 rounded-md object-cover border border-border"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(idx)}
                        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Убрать фото"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => handleUploadFiles(e.target.files)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading || form.images.length >= 8}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <ImagePlus className="h-4 w-4 mr-1" />
                  )}
                  {uploading ? "Загружаем…" : "Загрузить фото"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={uploading || form.images.length >= 8}
                  onClick={addImageUrl}
                >
                  <Plus className="h-4 w-4 mr-1" />По ссылке
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                JPG/PNG/WebP до 10 МБ. Хранятся в Supabase Storage.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="svc-includes">Что включено (через запятую)</Label>
                <Input
                  id="svc-includes"
                  value={form.includes}
                  onChange={(e) => setForm({ ...form, includes: e.target.value })}
                  placeholder="конкурсы, реквизит, дискотека"
                />
              </div>
              <div>
                <Label htmlFor="svc-tags">Теги (через запятую)</Label>
                <Input
                  id="svc-tags"
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="аниматор, клоун"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="svc-safety">Предупреждение по безопасности</Label>
              <Input
                id="svc-safety"
                value={form.safetyNote}
                onChange={(e) => setForm({ ...form, safetyNote: e.target.value })}
                placeholder="для пиротехники: только на открытом воздухе"
              />
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.customizable}
                onChange={(e) => setForm({ ...form, customizable: e.target.checked })}
                className="h-4 w-4"
              />
              Программа адаптируется под возраст и тематику праздника
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editingId ? "Сохранить" : "Опубликовать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
