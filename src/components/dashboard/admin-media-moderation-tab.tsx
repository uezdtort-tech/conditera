"use client";

/**
 * AdminMediaModerationTab — глобальная очередь модерации товарных медиа (Task 4-a).
 *
 * Данные: GET /api/admin/product-media?status=...&limit=100
 * (MODERATOR | ADMIN | SUPER_ADMIN — серверный гейт).
 *
 * Один запрос status=all&limit=100 → StatCard-счётчики по статусам считаются
 * на клиенте (без трёх параллельных запросов), фильтр — клиентский по Tabs.
 * Действия approve/reject — PATCH /api/products/{productId}/media/{mediaId}.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, Images, Clock, CheckCircle2, XCircle, Layers, Film, ImageIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { csrfFetch } from "@/lib/api-client";
import { EmptyState, StatCard } from "@/components/dashboard/_shared";

// ==================== Типы (snake_case — как отдаёт API) ====================

interface AdminMediaItem {
  id: string;
  product_id: string;
  media_type: "photo" | "video";
  storage_path: string;
  original_filename: string | null;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  sort_order: number;
  status: "pending" | "approved" | "rejected";
  is_cover: boolean;
  uploaded_at: string;
  moderation_comment: string | null;
  url: string;
  product: { id: string; title: string; slug: string; status: string } | null;
}

interface AdminMediaResponse {
  items: AdminMediaItem[];
  total: number;
  limit: number;
  offset: number;
}

type StatusFilter = "pending" | "approved" | "rejected" | "all";

const STATUS_META: Record<
  AdminMediaItem["status"],
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  pending: { label: "Ожидает", className: "bg-amber-100 text-amber-800 border-amber-300", icon: Clock },
  approved: { label: "Одобрено", className: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: CheckCircle2 },
  rejected: { label: "Отклонено", className: "bg-red-100 text-red-800 border-red-300", icon: XCircle },
};

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const LIMIT = 100;

export function AdminMediaModerationTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [rejectTarget, setRejectTarget] = useState<AdminMediaItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Один запрос status=all: StatCard-счётчики + фильтрация на клиенте
  const mediaQuery = useQuery<AdminMediaResponse>({
    queryKey: ["admin-product-media", LIMIT, 0],
    queryFn: async () => {
      const res = await csrfFetch(`/api/admin/product-media?status=all&limit=${LIMIT}&offset=0`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `Не удалось загрузить очередь (${res.status})`);
      }
      return (await res.json()) as AdminMediaResponse;
    },
    staleTime: 20 * 1000,
  });

  const allItems = useMemo(() => mediaQuery.data?.items ?? [], [mediaQuery.data]);

  const counts = useMemo(
    () => ({
      pending: allItems.filter((i) => i.status === "pending").length,
      approved: allItems.filter((i) => i.status === "approved").length,
      rejected: allItems.filter((i) => i.status === "rejected").length,
      all: allItems.length,
    }),
    [allItems],
  );

  const items = useMemo(
    () => (filter === "all" ? allItems : allItems.filter((i) => i.status === filter)),
    [allItems, filter],
  );

  const refetch = () => void queryClient.invalidateQueries({ queryKey: ["admin-product-media"] });

  const moderate = async (
    item: AdminMediaItem,
    action: "approve" | "reject",
    comment?: string,
  ) => {
    setBusyId(item.id);
    try {
      const res = await csrfFetch(`/api/products/${item.product_id}/media/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      toast.success(action === "approve" ? "Медиа одобрено" : "Медиа отклонено", {
        description: item.product?.title || item.original_filename || undefined,
      });
      // Убираем карточку из списка локально + перекрываем счётчики refetch'ем
      queryClient.setQueryData<AdminMediaResponse>(
        ["admin-product-media", LIMIT, 0],
        (prev) => (prev ? { ...prev, items: prev.items.filter((i) => i.id !== item.id) } : prev),
      );
      refetch();
    } catch (e) {
      toast.error("Действие не выполнено", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Images className="h-5 w-5 text-primary" />
          Медиа-модерация
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Фото и видео карточек товаров: одобрение, отклонение, история решений
        </p>
      </div>

      {/* Статистика по статусам */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Clock} label="Ожидают модерации" value={counts.pending} color="text-amber-600" />
        <StatCard icon={CheckCircle2} label="Одобрено" value={counts.approved} color="text-emerald-600" />
        <StatCard icon={XCircle} label="Отклонено" value={counts.rejected} color="text-red-600" />
        <StatCard icon={Layers} label="Всего в выборке" value={counts.all} color="text-primary" />
      </div>

      {/* Фильтр по статусу */}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Ожидают
            {counts.pending > 0 && (
              <Badge variant="outline" className="ml-1 bg-amber-100 text-amber-800 border-amber-300 text-[10px] px-1">
                {counts.pending}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="approved" className="gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />Одобренные
          </TabsTrigger>
          <TabsTrigger value="rejected" className="gap-1.5">
            <XCircle className="h-3.5 w-3.5" />Отклонённые
          </TabsTrigger>
          <TabsTrigger value="all" className="gap-1.5">Все</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Очередь */}
      {mediaQuery.isLoading ? (
        <Card className="p-8 text-sm text-muted-foreground text-center">Загружаем очередь...</Card>
      ) : mediaQuery.isError ? (
        <Card className="p-8 text-center border-destructive/30 bg-destructive/5">
          <p className="text-sm text-destructive mb-3">
            {mediaQuery.error instanceof Error ? mediaQuery.error.message : "Ошибка загрузки"}
          </p>
          <Button variant="outline" size="sm" onClick={refetch}>Повторить</Button>
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Images}
          title="Очередь пуста"
          text={
            filter === "pending"
              ? "Все медиа обработаны — новых загрузок нет"
              : "В этом статусе медиа нет"
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {items.map((item) => (
            <MediaQueueCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              onApprove={() => void moderate(item, "approve")}
              onReject={() => setRejectTarget(item)}
            />
          ))}
        </div>
      )}

      {/* Диалог отклонения */}
      <RejectMediaDialog
        item={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={async (comment) => {
          if (!rejectTarget) return;
          await moderate(rejectTarget, "reject", comment);
        }}
      />
    </div>
  );
}

// ==================== Карточка очереди ====================

function MediaQueueCard({
  item,
  busy,
  onApprove,
  onReject,
}: {
  item: AdminMediaItem;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const statusMeta = STATUS_META[item.status];
  const StatusIcon = statusMeta.icon;

  return (
    <Card className="p-3 flex flex-col gap-2.5">
      {/* Превью + статус */}
      <div className="relative rounded-lg overflow-hidden bg-muted/40 border border-border">
        {item.media_type === "photo" ? (
          <img
            src={item.url}
            alt={item.original_filename || "Фото товара"}
            loading="lazy"
            decoding="async"
            className="aspect-video w-full object-cover"
          />
        ) : (
          <div className="relative">
            <video src={item.url} controls preload="metadata" className="aspect-video w-full bg-black/80" />
            {formatDuration(item.duration_seconds) && (
              <span className="absolute top-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                {formatDuration(item.duration_seconds)}
              </span>
            )}
          </div>
        )}
        <div className="absolute top-1.5 left-1.5 flex gap-1">
          <Badge variant="outline" className={`text-[10px] gap-1 ${statusMeta.className}`}>
            <StatusIcon className="h-2.5 w-2.5" />
            {statusMeta.label}
          </Badge>
          <Badge variant="outline" className="text-[10px] gap-1 bg-background/80">
            {item.media_type === "video" ? <Film className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}
            {item.media_type === "video" ? "Видео" : "Фото"}
          </Badge>
        </div>
      </div>

      {/* Метаданные */}
      <div className="space-y-1 text-xs min-w-0">
        <div className="font-medium text-sm truncate" title={item.product?.title}>
          {item.product?.title || "Товар удалён"}
        </div>
        {item.product && (
          <div className="text-muted-foreground truncate">
            /{item.product.slug} • статус товара: {item.product.status}
          </div>
        )}
        <div className="text-muted-foreground flex flex-wrap gap-x-2">
          <span>{new Date(item.uploaded_at).toLocaleString("ru-RU")}</span>
          <span>•</span>
          <span>{formatFileSize(item.file_size)}</span>
          {item.width && item.height && (
            <>
              <span>•</span>
              <span>{item.width}×{item.height}</span>
            </>
          )}
        </div>
        {item.original_filename && (
          <div className="text-muted-foreground truncate" title={item.original_filename}>
            {item.original_filename}
          </div>
        )}
        {item.moderation_comment && (
          <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-1">
            Причина: {item.moderation_comment}
          </div>
        )}
      </div>

      {/* Действия — только для ожидающих модерацию */}
      {item.status === "pending" && (
        <div className="flex gap-2 mt-auto pt-2 border-t">
          <Button
            size="sm"
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={busy}
            onClick={onApprove}
          >
            <Check className="h-3.5 w-3.5 mr-1" />Одобрить
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="flex-1"
            disabled={busy}
            onClick={onReject}
          >
            <X className="h-3.5 w-3.5 mr-1" />Отклонить
          </Button>
        </div>
      )}
    </Card>
  );
}

// ==================== Диалог отклонения ====================

function RejectMediaDialog({
  item,
  onClose,
  onConfirm,
}: {
  item: AdminMediaItem | null;
  onClose: () => void;
  onConfirm: (comment: string) => Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = comment.trim().length >= 3;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onConfirm(comment.trim());
      setComment("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Отклонить медиа</DialogTitle>
          <DialogDescription>
            Причина обязательна (от 3 символов) — её увидит кондитер.
            {item?.product?.title ? ` Товар: «${item.product.title}».` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="queue-reject-reason">Причина отклонения</Label>
          <Textarea
            id="queue-reject-reason"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Например: фото не соответствует товару, плохое качество..."
          />
          {comment.trim().length > 0 && !valid && (
            <p className="text-xs text-amber-600">Минимум 3 символа</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button variant="destructive" disabled={!valid || busy} onClick={() => void submit()}>
            <X className="h-4 w-4 mr-1" />Отклонить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
