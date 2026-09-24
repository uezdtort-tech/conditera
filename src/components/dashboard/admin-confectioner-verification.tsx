"use client";

/**
 * AdminConfectionerVerification — админ-панель для модерации кондитеров.
 *
 * Показывает:
 *  - Сводку по статусам (pending/approved/rejected/needs_revision)
 *  - Список кондитеров с фильтром по статусу
 *  - Карточку кондитера: профиль, юр.инфо, портфолио
 *  - Кнопки: Подтвердить / Запросить правки / Отказать
 *
 * Используется в admin-дашборде (вкладка "Кондитеры").
 */

import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  UserCheck,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Building2,
  MapPin,
  Phone,
  Mail,
  Calendar,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

interface Confectioner {
  id: string;
  businessName: string;
  slug: string;
  description: string;
  avatar: string;
  city: string;
  verified: boolean;
  verificationStatus: string;
  rejectionReason: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
  legalInfo: any;
  taxMode: string;
  specialization: string[];
  portfolioImages: string[];
  userId: string;
  user: {
    name: string;
    email: string;
    phone: string | null;
    createdAt: string;
  };
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Ожидает", color: "bg-amber-100 text-amber-800" },
  approved: { label: "Подтверждён", color: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Отказ", color: "bg-red-100 text-red-800" },
  needs_revision: { label: "Правки", color: "bg-blue-100 text-blue-800" },
};

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function AdminConfectionerVerification() {
  const [confectioners, setConfectioners] = useState<Confectioner[]>([]);
  const [summary, setSummary] = useState({ pending: 0, approved: 0, rejected: 0, needs_revision: 0, total: 0 });
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Для диалога отказа
  const [rejectDialog, setRejectDialog] = useState<{ confectioner: Confectioner; requestRevision: boolean } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Для просмотра профиля
  const [viewDialog, setViewDialog] = useState<Confectioner | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/admin/confectioners/pending?status=${filter}`);
      if (res.ok) {
        const data = await res.json();
        setConfectioners(data.confectioners || []);
        setSummary(data.summary || { pending: 0, approved: 0, rejected: 0, needs_revision: 0, total: 0 });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleApprove(id: string) {
    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/confectioners/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confectionerId: id }),
      });
      if (res.ok) {
        toast.success("Кондитер подтверждён");
        load();
      } else {
        const err = await res.json();
        toast.error(err.error || "Не удалось подтвердить");
      }
    } catch (e) {
      toast.error("Ошибка сети");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject() {
    if (!rejectDialog) return;
    if (rejectReason.trim().length < 10) {
      toast.error("Укажите причину (минимум 10 символов)");
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/confectioners/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confectionerId: rejectDialog.confectioner.id,
          reason: rejectReason,
          requestRevision: rejectDialog.requestRevision,
        }),
      });
      if (res.ok) {
        toast.success(rejectDialog.requestRevision ? "Запрошены правки" : "Кондитер отклонён");
        setRejectDialog(null);
        setRejectReason("");
        load();
      } else {
        const err = await res.json();
        toast.error(err.error || "Не удалось");
      }
    } catch (e) {
      toast.error("Ошибка сети");
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-medium flex items-center gap-2">
            <UserCheck className="h-6 w-6 text-primary" />
            Модерация кондитеров
          </h2>
          <p className="text-sm text-muted-foreground">
            Подтверждение новых кондитеров. Авто-refresh каждые 30 секунд.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={refreshing} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { key: "pending", label: "Ожидают", value: summary.pending, color: "text-amber-600", icon: Clock },
          { key: "approved", label: "Подтверждены", value: summary.approved, color: "text-emerald-600", icon: CheckCircle2 },
          { key: "needs_revision", label: "Правки", value: summary.needs_revision, color: "text-blue-600", icon: AlertCircle },
          { key: "rejected", label: "Отказ", value: summary.rejected, color: "text-red-600", icon: XCircle },
          { key: "all", label: "Всего", value: summary.total, color: "text-primary", icon: Building2 },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <Card
              key={s.key}
              className="p-3 cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => setFilter(s.key)}
            >
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className={`h-3.5 w-3.5 ${s.color}`} />
                {s.label}
              </div>
              <div className={`text-2xl font-bold mt-1 ${filter === s.key ? s.color : ""}`}>
                {s.value}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {["pending", "needs_revision", "rejected", "approved", "all"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
              filter === s
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-accent border-border"
            }`}
          >
            {STATUS_LABELS[s]?.label || "Все"}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <Card className="p-6">
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-muted/50 rounded" />
            ))}
          </div>
        </Card>
      ) : confectioners.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-emerald-500" />
          <h3 className="font-display text-lg">Нет кондитеров в этом статусе</h3>
        </Card>
      ) : (
        <div className="space-y-2">
          {confectioners.map((conf) => {
            const status = STATUS_LABELS[conf.verificationStatus] || STATUS_LABELS.pending;
            const legal = conf.legalInfo || {};
            return (
              <Card key={conf.id} className="p-4">
                <div className="flex items-start gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={conf.avatar} alt={conf.businessName} />
                    <AvatarFallback>{conf.businessName.slice(0, 2)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{conf.businessName}</span>
                      <Badge className={`text-[10px] ${status.color}`}>{status.label}</Badge>
                      <Badge variant="outline" className="text-[10px]">{conf.taxMode}</Badge>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        <Calendar className="h-3 w-3 inline mr-1" />
                        {formatDate(conf.createdAt)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {conf.city}
                      </span>
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {conf.user.email}
                      </span>
                      {conf.user.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {conf.user.phone}
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-2 line-clamp-2">{conf.description}</p>
                    {conf.rejectionReason && (
                      <div className="text-xs text-red-600 mt-2 p-2 bg-red-50 rounded">
                        Причина: {conf.rejectionReason}
                      </div>
                    )}
                    {(conf.specialization?.length || 0) > 0 && (
                      <div className="flex gap-1 flex-wrap mt-2">
                        {conf.specialization.map((s, i) => (
                          <Badge key={i} variant="outline" className="text-[9px]">{s}</Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 mt-3 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setViewDialog(conf)}
                      >
                        <FileText className="h-3.5 w-3.5 mr-1" />
                        Профиль
                      </Button>
                      {conf.verificationStatus === "pending" && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => handleApprove(conf.id)}
                            disabled={actionLoading}
                            className="gap-1"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Подтвердить
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setRejectDialog({ confectioner: conf, requestRevision: true });
                              setRejectReason("");
                            }}
                            className="gap-1"
                          >
                            <AlertCircle className="h-3.5 w-3.5" />
                            Запросить правки
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setRejectDialog({ confectioner: conf, requestRevision: false });
                              setRejectReason("");
                            }}
                            className="gap-1"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Отказать
                          </Button>
                        </>
                      )}
                      {(conf.verificationStatus === "rejected" || conf.verificationStatus === "needs_revision") && (
                        <Button
                          size="sm"
                          onClick={() => handleApprove(conf.id)}
                          disabled={actionLoading}
                          className="gap-1"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Подтвердить
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* View dialog */}
      <Dialog open={!!viewDialog} onOpenChange={(o) => !o && setViewDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewDialog?.businessName}</DialogTitle>
            <DialogDescription>Профиль кондитера на модерации</DialogDescription>
          </DialogHeader>
          {viewDialog && (
            <div className="space-y-4">
              {/* Portfolio */}
              <div>
                <Label className="text-xs text-muted-foreground">Портфолио ({viewDialog.portfolioImages.length})</Label>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {viewDialog.portfolioImages.map((img, i) => (
                    <img
                      key={i}
                      src={img}
                      alt={`Портфолио ${i + 1}`}
                      className="aspect-square rounded object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ))}
                  {viewDialog.portfolioImages.length === 0 && (
                    <div className="col-span-3 text-center text-xs text-muted-foreground py-8">
                      <ImageIcon className="h-8 w-8 mx-auto mb-2" />
                      Нет фото в портфолио
                    </div>
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <Label className="text-xs text-muted-foreground">Описание</Label>
                <p className="text-sm mt-1">{viewDialog.description}</p>
              </div>

              {/* Legal info */}
              <div>
                <Label className="text-xs text-muted-foreground">Юридическая информация</Label>
                <pre className="text-xs mt-1 p-3 bg-muted rounded font-mono whitespace-pre-wrap">
{JSON.stringify(viewDialog.legalInfo, null, 2)}
                </pre>
              </div>

              {/* Specializations */}
              {viewDialog.specialization.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Специализации</Label>
                  <div className="flex gap-1 flex-wrap mt-2">
                    {viewDialog.specialization.map((s, i) => (
                      <Badge key={i} variant="outline">{s}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-2 border-t">
                <Button
                  onClick={() => {
                    handleApprove(viewDialog.id);
                    setViewDialog(null);
                  }}
                  disabled={actionLoading}
                  className="gap-1"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Подтвердить
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRejectDialog({ confectioner: viewDialog, requestRevision: true });
                    setViewDialog(null);
                  }}
                  className="gap-1"
                >
                  <AlertCircle className="h-4 w-4" />
                  Запросить правки
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setRejectDialog({ confectioner: viewDialog, requestRevision: false });
                    setViewDialog(null);
                  }}
                  className="gap-1"
                >
                  <XCircle className="h-4 w-4" />
                  Отказать
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectDialog} onOpenChange={(o) => !o && setRejectDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {rejectDialog?.requestRevision ? "Запросить правки" : "Отказать кондитеру"}
            </DialogTitle>
            <DialogDescription>
              {rejectDialog?.requestRevision
                ? "Укажите, какие правки нужно внести. Кондитер сможет исправить и отправить снова."
                : "Укажите причину отказа. Кондитер сможет исправить и отправить снова."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Причина</Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={
                  rejectDialog?.requestRevision
                    ? "Например: добавьте больше фото в портфолио, укажите ИНН..."
                    : "Например: профиль не соответствует требованиям платформы..."
                }
                rows={4}
                className="mt-1"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setRejectDialog(null)}>
                Отмена
              </Button>
              <Button
                variant={rejectDialog?.requestRevision ? "default" : "destructive"}
                onClick={handleReject}
                disabled={actionLoading || rejectReason.trim().length < 10}
              >
                {rejectDialog?.requestRevision ? "Запросить правки" : "Отказать"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
