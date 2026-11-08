"use client";

/**
 * SupplierProfileForm — профиль компании поставщика (Z-v17).
 *
 * Реальные операции (через /api/supplier/profile и /submit):
 *  - просмотр статуса проверки + истории модерации;
 *  - редактирование профиля (правила зависят от статуса — серверные);
 *  - отправка/повторная отправка на модерацию с валидацией обязательных полей.
 * Ошибки сервера показываются как есть — фиктивных «успехов» нет.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { csrfFetch } from "@/lib/api-client";
import {
  Building2, Send, RefreshCw, Clock, CheckCircle2, XCircle,
  AlertCircle, Save, History,
} from "lucide-react";

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  draft: { label: "Черновик", className: "bg-stone-100 text-stone-700" },
  submitted: { label: "Отправлено на проверку", className: "bg-amber-100 text-amber-800" },
  under_review: { label: "Проверяется", className: "bg-blue-100 text-blue-800" },
  changes_requested: { label: "Требуются исправления", className: "bg-orange-100 text-orange-800" },
  approved: { label: "Одобрено", className: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Отклонено", className: "bg-red-100 text-red-800" },
  suspended: { label: "Приостановлено", className: "bg-red-100 text-red-800" },
};

const CATEGORY_OPTIONS = [
  { value: "flour", label: "Мука и сухие смеси" },
  { value: "sugar", label: "Сахар и подсластители" },
  { value: "chocolate", label: "Шоколад и какао" },
  { value: "dairy", label: "Молочная продукция" },
  { value: "eggs", label: "Яйца и яичные продукты" },
  { value: "oils", label: "Масла и жиры" },
  { value: "nuts", label: "Орехи" },
  { value: "berries", label: "Ягоды и фрукты" },
  { value: "fillings", label: "Начинки и наполнители" },
  { value: "colors", label: "Пищевые красители" },
  { value: "flavors", label: "Ароматизаторы" },
  { value: "decor", label: "Декор" },
  { value: "packaging", label: "Упаковка" },
  { value: "equipment", label: "Инвентарь и оборудование" },
  { value: "other", label: "Другое" },
];

interface Profile {
  companyName?: string;
  legalForm?: string;
  inn?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  region?: string;
  description?: string;
  specialization?: string[];
  productCategories?: string[];
  wholesaleTerms?: string;
  minOrderAmount?: number;
  minOrderQty?: number;
  workSchedule?: string;
  deliveryGeography?: string;
  deliveryTerms?: string;
  pickupAvailable?: boolean;
  deliveryAvailable?: boolean;
  verificationStatus?: string;
  reviewComment?: string | null;
  createdAt?: string;
}

interface ReviewEvent {
  action: string;
  fromStatus: string | null;
  toStatus: string;
  actorRole: string | null;
  comment: string | null;
  createdAt: string;
}

const EDITABLE_STATUSES = ["draft", "changes_requested", "rejected", "approved"];

export function SupplierProfileForm() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [history, setHistory] = useState<ReviewEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<Profile>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await csrfFetch("/api/supplier/profile");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка загрузки");
      setProfile(json.profile);
      setHistory(json.history ?? []);
      setForm(json.profile ?? {});
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const status = profile?.verificationStatus ?? "draft";
  const editable = EDITABLE_STATUSES.includes(status);
  const set = (patch: Partial<Profile>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await csrfFetch("/api/supplier/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка сохранения");
      toast.success("Профиль сохранён");
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const submitForReview = async () => {
    setSubmitting(true);
    try {
      // Автосохранение перед отправкой (иначе submit увидит старые данные БД).
      const saveRes = await csrfFetch("/api/supplier/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const saveJson = await saveRes.json();
      if (!saveRes.ok) {
        throw new Error(saveJson.error || "Сначала сохраните профиль");
      }
      const res = await csrfFetch("/api/supplier/profile/submit", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        const details = Array.isArray(json.details) ? `\n${json.details.join("\n")}` : "";
        throw new Error((json.error || "Ошибка отправки") + details);
      }
      toast.success(json.message || "Заявка отправлена");
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <Card className="p-6 text-sm text-muted-foreground">Загружаем профиль…</Card>;
  }

  const isNew = !profile;
  const badge = STATUS_BADGES[isNew ? "draft" : status] ?? STATUS_BADGES.draft;

  return (
    <div className="space-y-4">
      {/* Статус проверки */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-semibold">Статус проверки профиля</h2>
              <p className="text-xs text-muted-foreground">
                Поставщики допускаются к продаже после одобрения администратором
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={badge.className}>{badge.label}</Badge>
            {(status === "draft" || status === "changes_requested" || status === "rejected") && (
              <Button onClick={submitForReview} disabled={submitting} size="sm">
                <Send className="h-4 w-4 mr-1" />
                {status === "draft" ? "Отправить на проверку" : "Отправить повторно"}
              </Button>
            )}
            {(status === "submitted" || status === "under_review") && (
              <Button size="sm" variant="outline" disabled>
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                Ожидайте решения
              </Button>
            )}
          </div>
        </div>
        {profile?.reviewComment && (
          <div className="mt-3 flex gap-2 p-3 rounded bg-orange-50 border border-orange-200 text-sm">
            <AlertCircle className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-orange-900">Комментарий модератора:</p>
              <p className="text-orange-800">{profile?.reviewComment}</p>
            </div>
          </div>
        )}
      </Card>

      {/* История модерации */}
      {history.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold mb-2 flex items-center gap-2 text-sm">
            <History className="h-4 w-4" /> История проверки
          </h3>
          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
            {history.map((h, i) => (
              <div key={i} className="flex items-start gap-2 text-xs border-b border-border/50 pb-1.5">
                <span className="text-muted-foreground shrink-0">
                  {new Date(h.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
                {h.toStatus === "approved" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                ) : h.toStatus === "rejected" || h.toStatus === "suspended" ? (
                  <XCircle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
                ) : (
                  <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                )}
                <span className="flex-1">
                  {STATUS_BADGES[h.toStatus]?.label ?? h.toStatus}
                  {h.comment ? ` — ${h.comment}` : ""}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Форма профиля */}
      <Card className="p-4 space-y-4">
        <h3 className="font-semibold">Информация о компании</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="companyName">Название компании *</Label>
            <Input id="companyName" value={form.companyName ?? ""} disabled={!editable}
              onChange={(e) => set({ companyName: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="legalForm">Организационно-правовая форма</Label>
            <Input id="legalForm" placeholder="ООО, ИП, самозанятый…" value={form.legalForm ?? ""} disabled={!editable}
              onChange={(e) => set({ legalForm: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inn">ИНН</Label>
            <Input id="inn" value={form.inn ?? ""} disabled={!editable}
              onChange={(e) => set({ inn: e.target.value.replace(/\D/g, "").slice(0, 12) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="contactPerson">Контактное лицо *</Label>
            <Input id="contactPerson" value={form.contactPerson ?? ""} disabled={!editable}
              onChange={(e) => set({ contactPerson: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="phone">Телефон *</Label>
            <Input id="phone" value={form.phone ?? ""} disabled={!editable}
              onChange={(e) => set({ phone: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="spEmail">Email *</Label>
            <Input id="spEmail" type="email" value={form.email ?? ""} disabled={!editable}
              onChange={(e) => set({ email: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="region">Регион деятельности *</Label>
            <Input id="region" value={form.region ?? ""} disabled={!editable}
              onChange={(e) => set({ region: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="address">Адрес</Label>
            <Input id="address" value={form.address ?? ""} disabled={!editable}
              onChange={(e) => set({ address: e.target.value })} />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="description">Описание компании *</Label>
          <Textarea id="description" rows={3} value={form.description ?? ""} disabled={!editable}
            onChange={(e) => set({ description: e.target.value })} />
        </div>

        <div className="space-y-1">
          <Label>Категории товаров *</Label>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_OPTIONS.map((cat) => {
              const cats = form.productCategories ?? [];
              const checked = cats.includes(cat.value);
              return (
                <label key={cat.value}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border cursor-pointer select-none transition-colors ${
                    checked ? "bg-primary/10 border-primary text-primary" : "bg-background border-border text-muted-foreground"
                  } ${!editable ? "opacity-50 pointer-events-none" : ""}`}>
                  <Checkbox checked={checked} disabled={!editable}
                    onCheckedChange={(v) =>
                      set({ productCategories: v ? [...cats, cat.value] : cats.filter((c) => c !== cat.value) })
                    } />
                  {cat.label}
                </label>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="wholesaleTerms">Условия оптовых продаж</Label>
            <Input id="wholesaleTerms" value={form.wholesaleTerms ?? ""} disabled={!editable}
              onChange={(e) => set({ wholesaleTerms: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="minOrderAmount">Минимальная сумма заказа, ₽</Label>
            <Input id="minOrderAmount" type="number" min={0} value={form.minOrderAmount ?? 0} disabled={!editable}
              onChange={(e) => set({ minOrderAmount: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="minOrderQty">Минимальная партия (шт/кг)</Label>
            <Input id="minOrderQty" type="number" min={1} value={form.minOrderQty ?? 1} disabled={!editable}
              onChange={(e) => set({ minOrderQty: Math.max(1, Number(e.target.value) || 1) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="workSchedule">График работы</Label>
            <Input id="workSchedule" placeholder="Пн–Пт 9:00–18:00" value={form.workSchedule ?? ""} disabled={!editable}
              onChange={(e) => set({ workSchedule: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="deliveryGeography">География поставок</Label>
            <Input id="deliveryGeography" placeholder="Москва и МО, ЦФО…" value={form.deliveryGeography ?? ""} disabled={!editable}
              onChange={(e) => set({ deliveryGeography: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="deliveryTerms">Условия доставки</Label>
            <Input id="deliveryTerms" value={form.deliveryTerms ?? ""} disabled={!editable}
              onChange={(e) => set({ deliveryTerms: e.target.value })} />
          </div>
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={form.deliveryAvailable ?? true} disabled={!editable}
              onCheckedChange={(v) => set({ deliveryAvailable: v === true })} />
            Доставка
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={form.pickupAvailable ?? false} disabled={!editable}
              onCheckedChange={(v) => set({ pickupAvailable: v === true })} />
            Самовывоз
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button onClick={save} disabled={!editable || saving}>
            <Save className="h-4 w-4 mr-1" />
            {saving ? "Сохраняем…" : "Сохранить"}
          </Button>
        </div>
        {!editable && status !== "approved" && (
          <p className="text-xs text-muted-foreground">
            Редактирование недоступно при текущем статусе проверки.
          </p>
        )}
      </Card>
    </div>
  );
}
