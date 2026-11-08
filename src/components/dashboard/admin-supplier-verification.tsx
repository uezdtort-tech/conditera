"use client";

/**
 * AdminSupplierVerification — очередь модерации поставщиков (Z-v17).
 *
 * Реальные операции через /api/admin/suppliers (серверная фильтрация по статусу)
 * и /api/admin/suppliers/[id]/action:
 *  - начать проверку; одобрить; отклонить (причина обязательна);
 *  - запросить исправления (замечания обязательны);
 *  - приостановить одобренного; возобновить.
 * Каждое действие проверяется сервером (роль + допустимость перехода + CAS),
 * автор и причина фиксируются в журнале, поставщик получает уведомление.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { csrfFetch } from "@/lib/api-client";
import {
  Building2, PlayCircle, CheckCircle2, XCircle, FileWarning,
  PauseCircle, Play, MapPin, Phone, Mail, RefreshCw,
} from "lucide-react";

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  draft: { label: "Черновик", color: "bg-stone-100 text-stone-700" },
  submitted: { label: "Ожидает проверки", color: "bg-amber-100 text-amber-800" },
  under_review: { label: "На проверке", color: "bg-blue-100 text-blue-800" },
  changes_requested: { label: "Правки запрошены", color: "bg-orange-100 text-orange-800" },
  approved: { label: "Одобрен", color: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Отклонён", color: "bg-red-100 text-red-800" },
  suspended: { label: "Приостановлен", color: "bg-red-100 text-red-800" },
};

const FILTERS = [
  { value: "submitted", label: "Новые" },
  { value: "under_review", label: "На проверке" },
  { value: "changes_requested", label: "Правки" },
  { value: "approved", label: "Одобренные" },
  { value: "rejected", label: "Отклонённые" },
  { value: "suspended", label: "Приостановленные" },
  { value: "draft", label: "Черновики" },
  { value: "all", label: "Все" },
];

interface SupplierItem {
  id: string;
  userId: string;
  companyName: string;
  inn: string | null;
  legalForm: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  region: string | null;
  description: string | null;
  specialization: string[] | null;
  productCategories: string[] | null;
  wholesaleTerms: string | null;
  minOrderAmount: number;
  deliveryTerms: string | null;
  deliveryGeography: string | null;
  verificationStatus: string;
  reviewComment: string | null;
  submittedAt: string | null;
  owner: { name: string; email: string; phone: string | null } | null;
}

type Action = "start_review" | "approve" | "reject" | "request_changes" | "suspend" | "resume";

export function AdminSupplierVerification() {
  const [items, setItems] = useState<SupplierItem[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("submitted");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionDialog, setActionDialog] = useState<{ item: SupplierItem; action: Action } | null>(null);
  const [reason, setReason] = useState("");
  const [requestRevision, setRequestRevision] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await csrfFetch(`/api/admin/suppliers?status=${encodeURIComponent(filter)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка загрузки");
      setItems(json.items ?? []);
      setSummary(json.summary ?? {});
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async () => {
    if (!actionDialog) return;
    setBusy(true);
    try {
      const isReject = actionDialog.action === "reject";
      const body: Record<string, unknown> = { action: actionDialog.action };
      if (isReject) {
        body.reason = reason;
        body.requestRevision = requestRevision;
        if (requestRevision) body.action = "request_changes";
      } else if (["request_changes", "suspend"].includes(actionDialog.action)) {
        body.comment = reason;
        body.reason = reason;
      }
      const res = await csrfFetch(`/api/admin/suppliers/${actionDialog.item.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка действия");
      toast.success(`Статус: ${json.status}`);
      setActionDialog(null);
      setReason("");
      setRequestRevision(false);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const directAction = async (item: SupplierItem, action: Action) => {
    setBusy(true);
    try {
      const res = await csrfFetch(`/api/admin/suppliers/${item.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка действия");
      toast.success(`Статус: ${json.status}`);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openAction = (item: SupplierItem, action: Action) => {
    setReason("");
    setRequestRevision(false);
    setActionDialog({ item, action });
  };

  if (loading) {
    return <Card className="p-6 text-sm text-muted-foreground">Загружаем очередь модерации…</Card>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-2xl font-bold">Модерация поставщиков</h2>
        <div className="flex flex-wrap gap-2 mt-2">
          {Object.entries(summary).map(([s, count]) => (
            <Badge key={s} className={STATUS_BADGES[s]?.color ?? "bg-stone-100 text-stone-700"}>
              {STATUS_BADGES[s]?.label ?? s}: {count}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.value}
            onClick={() => setFilter(f.value)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              filter === f.value ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:bg-muted"
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Building2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Заявок в этом фильтре нет.
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((s) => {
            const badge = STATUS_BADGES[s.verificationStatus] ?? STATUS_BADGES.draft;
            const st = s.verificationStatus;
            return (
              <Card key={s.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-semibold">{s.companyName}</span>
                      <Badge className={badge.color}>{badge.label}</Badge>
                      {s.inn && <Badge variant="outline" className="text-[10px]">ИНН {s.inn}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1.5 space-y-0.5">
                      {s.owner && <div>Владелец: {s.owner.name} ({s.owner.email})</div>}
                      {s.contactPerson && <div className="flex items-center gap-1"><Phone className="h-3 w-3" /> {s.contactPerson}{s.phone ? `, ${s.phone}` : ""}</div>}
                      {s.email && <div className="flex items-center gap-1"><Mail className="h-3 w-3" /> {s.email}</div>}
                      {s.region && <div className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {s.region}{s.deliveryGeography ? ` • ${s.deliveryGeography}` : ""}</div>}
                      {Array.isArray(s.productCategories) && s.productCategories.length > 0 && (
                        <div>Категории: {s.productCategories.join(", ")}</div>
                      )}
                      {s.description && <div className="mt-1 p-2 rounded bg-muted text-foreground">{s.description}</div>}
                      {s.reviewComment && <div className="mt-1 p-2 rounded bg-orange-50 text-orange-900 border border-orange-200">Комментарий: {s.reviewComment}</div>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {st === "submitted" && (
                      <>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => directAction(s, "start_review")}>
                          <PlayCircle className="h-4 w-4 mr-1" /> Начать проверку
                        </Button>
                        <Button size="sm" disabled={busy} onClick={() => directAction(s, "approve")}>
                          <CheckCircle2 className="h-4 w-4 mr-1" /> Одобрить
                        </Button>
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => openAction(s, "request_changes")}>
                          <FileWarning className="h-4 w-4 mr-1" /> Запросить правки
                        </Button>
                        <Button size="sm" variant="destructive" disabled={busy} onClick={() => openAction(s, "reject")}>
                          <XCircle className="h-4 w-4 mr-1" /> Отклонить
                        </Button>
                      </>
                    )}
                    {st === "under_review" && (
                      <>
                        <Button size="sm" disabled={busy} onClick={() => directAction(s, "approve")}>
                          <CheckCircle2 className="h-4 w-4 mr-1" /> Одобрить
                        </Button>
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => openAction(s, "request_changes")}>
                          <FileWarning className="h-4 w-4 mr-1" /> Запросить правки
                        </Button>
                        <Button size="sm" variant="destructive" disabled={busy} onClick={() => openAction(s, "reject")}>
                          <XCircle className="h-4 w-4 mr-1" /> Отклонить
                        </Button>
                      </>
                    )}
                    {st === "approved" && (
                      <Button size="sm" variant="destructive" disabled={busy} onClick={() => openAction(s, "suspend")}>
                        <PauseCircle className="h-4 w-4 mr-1" /> Приостановить
                      </Button>
                    )}
                    {st === "suspended" && (
                      <Button size="sm" disabled={busy} onClick={() => directAction(s, "resume")}>
                        <Play className="h-4 w-4 mr-1" /> Возобновить
                      </Button>
                    )}
                    {st === "changes_requested" && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => load()}>
                        <RefreshCw className="h-4 w-4 mr-1" /> Обновить
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Диалог с причиной */}
      <Dialog open={!!actionDialog} onOpenChange={(v) => !v && setActionDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actionDialog?.action === "reject"
                ? `Отклонение заявки «${actionDialog?.item.companyName}»`
                : actionDialog?.action === "request_changes"
                  ? `Запрос исправлений — «${actionDialog?.item.companyName}»`
                  : `Приостановление «${actionDialog?.item.companyName}»`}
            </DialogTitle>
            <DialogDescription>
              {actionDialog?.action === "request_changes"
                ? "Опишите замечания — поставщик увидит их и сможет отправить профиль повторно."
                : actionDialog?.action === "suspend"
                  ? "Укажите причину приостановления — каталог поставщика будет скрыт из продажи."
                  : "Причина обязательна, её увидит поставщик."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="adminReason">
                {actionDialog?.action === "request_changes" ? "Замечания" : "Причина"} (минимум 10 символов)
              </Label>
              <Textarea id="adminReason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setActionDialog(null)}>Отмена</Button>
              <Button
                variant={actionDialog?.action === "reject" || actionDialog?.action === "suspend" ? "destructive" : "default"}
                disabled={reason.trim().length < 10 || busy}
                onClick={runAction}
              >
                Подтвердить
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
