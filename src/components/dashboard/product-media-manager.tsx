"use client";

/**
 * ProductMediaManager — управление медиа карточки товара (Task 4-a).
 *
 * Секции «Фотографии» (до 10) и «Видео» (до 3):
 *   • загрузка файлов (multipart POST /api/products/{id}/media);
 *   • drag-and-drop сортировка (@dnd-kit) → POST .../media/reorder;
 *   • статусы (pending/approved/rejected) с бейджами как в admin-fillings-tab;
 *   • обложка (set-cover), удаление, модерация approve/reject (canModerate).
 *
 * Все данные — реальные API: GET/POST /api/products/{productId}/media,
 * PATCH/DELETE /api/products/{productId}/media/{mediaId},
 * POST /api/products/{productId}/media/reorder.
 */

import { useRef, useState, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle2, Clock, XCircle, Star, Trash2, Plus, Check, X, ImagePlus, GripVertical, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { csrfFetch } from "@/lib/api-client";
import { EmptyState } from "@/components/dashboard/_shared";

// ==================== Типы (snake_case — как отдаёт API) ====================

export interface MediaRow {
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
}

interface MediaCounts {
  pending: number;
  approved: number;
  rejected: number;
}

interface MediaResponse {
  product_id: string;
  photos: MediaRow[];
  videos: MediaRow[];
  counts: { photos: MediaCounts; videos: MediaCounts };
}

const MAX_PHOTOS = 10;
const MAX_VIDEOS = 3;

// Бейджи статусов — палитра из admin-fillings-tab (amber/emerald/red, без синего)
const STATUS_META: Record<
  MediaRow["status"],
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  pending: { label: "Ожидает", className: "bg-amber-100 text-amber-800 border-amber-300", icon: Clock },
  approved: { label: "Одобрено", className: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: CheckCircle2 },
  rejected: { label: "Отклонено", className: "bg-red-100 text-red-800 border-red-300", icon: XCircle },
};

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ==================== Основной компонент ====================

export function ProductMediaManager({
  productId,
  canModerate,
  canSetCover,
  onChanged,
}: {
  productId: string;
  canModerate: boolean;
  /** Обложку назначает владелец или ADMIN/SUPER_ADMIN (MODERATOR — нет). */
  canSetCover?: boolean;
  onChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [rejectTarget, setRejectTarget] = useState<MediaRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MediaRow | null>(null);
  const [uploading, setUploading] = useState(false);

  const mediaQuery = useQuery<MediaResponse>({
    queryKey: ["product-media", productId],
    queryFn: async () => {
      const res = await csrfFetch(`/api/products/${productId}/media`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `Не удалось загрузить медиа (${res.status})`);
      }
      return (await res.json()) as MediaResponse;
    },
    staleTime: 15 * 1000,
  });

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["product-media", productId] });
    onChanged?.();
  }, [queryClient, productId, onChanged]);

  const photos = useMemo(() => mediaQuery.data?.photos ?? [], [mediaQuery.data]);
  const videos = useMemo(() => mediaQuery.data?.videos ?? [], [mediaQuery.data]);

  const counts = mediaQuery.data?.counts;
  const photoActive = (counts?.photos.approved ?? 0) + (counts?.photos.pending ?? 0);
  const videoActive = (counts?.videos.approved ?? 0) + (counts?.videos.pending ?? 0);
  const allowSetCover = canSetCover ?? canModerate;

  // ==================== Загрузка файлов (последовательно) ====================

  const uploadFiles = useCallback(
    async (files: FileList | null, mediaType: "photo" | "video") => {
      if (!files || files.length === 0) return;
      setUploading(true);
      try {
        for (const file of Array.from(files)) {
          const toastId = toast.loading(`Загрузка «${file.name}»...`);
          try {
            const fd = new FormData();
            fd.append("file", file);
            fd.append("mediaType", mediaType);
            // Content-Type НЕ ставим вручную — браузер сам поставит boundary
            const res = await csrfFetch(`/api/products/${productId}/media`, {
              method: "POST",
              body: fd,
            });
            if (res.ok) {
              toast.success(`«${file.name}» загружен`, { id: toastId, description: mediaType === "photo" ? "Фотография отправлена на модерацию" : "Видео отправлено на модерацию" });
            } else {
              let serverMessage = "";
              try {
                const body = (await res.json()) as { error?: string; message?: string };
                serverMessage = body.error || body.message || "";
              } catch { /* body не JSON */ }
              if (res.status === 409) {
                toast.error(
                  mediaType === "photo"
                    ? `Достигнут лимит фотографий (${MAX_PHOTOS})`
                    : `Достигнут лимит видео (${MAX_VIDEOS})`,
                  { id: toastId },
                );
              } else if (res.status === 415) {
                toast.error("Неподдерживаемый формат файла", { id: toastId, description: serverMessage || undefined });
              } else if (res.status === 413) {
                toast.error("Файл слишком большой", { id: toastId, description: serverMessage || undefined });
              } else if (res.status === 401) {
                toast.error("Требуется вход в систему", { id: toastId });
              } else if (res.status === 403) {
                toast.error("Недостаточно прав для загрузки медиа этого товара", { id: toastId });
              } else {
                toast.error(`Ошибка загрузки «${file.name}»`, { id: toastId, description: serverMessage || `HTTP ${res.status}` });
              }
            }
          } catch {
            toast.error(`Ошибка сети при загрузке «${file.name}»`, { id: toastId });
          }
        }
      } finally {
        setUploading(false);
        // сброс value, чтобы повторный выбор того же файла вызвал onChange
        if (photoInputRef.current) photoInputRef.current.value = "";
        if (videoInputRef.current) videoInputRef.current.value = "";
        refetch();
      }
    },
    [productId, refetch],
  );

  // ==================== Действия: delete / set-cover / approve / reject ====================

  const patchMedia = useCallback(
    async (media: MediaRow, action: "approve" | "reject" | "set-cover", comment?: string) => {
      const res = await csrfFetch(`/api/products/${productId}/media/${media.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as MediaRow;
    },
    [productId],
  );

  const handleDelete = useCallback(
    async (media: MediaRow) => {
      try {
        const res = await csrfFetch(`/api/products/${productId}/media/${media.id}`, { method: "DELETE" });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        toast.success("Медиа удалено");
      } catch (e) {
        toast.error("Не удалось удалить медиа", { description: e instanceof Error ? e.message : undefined });
      } finally {
        setDeleteTarget(null);
        refetch();
      }
    },
    [productId, refetch],
  );

  const handleApprove = useCallback(
    async (media: MediaRow) => {
      try {
        await patchMedia(media, "approve");
        toast.success("Медиа одобрено");
      } catch (e) {
        toast.error("Не удалось одобрить", { description: e instanceof Error ? e.message : undefined });
      } finally {
        refetch();
      }
    },
    [patchMedia, refetch],
  );

  const handleSetCover = useCallback(
    async (media: MediaRow) => {
      try {
        await patchMedia(media, "set-cover");
        toast.success("Обложка обновлена");
      } catch (e) {
        toast.error("Не удалось назначить обложку", { description: e instanceof Error ? e.message : undefined });
      } finally {
        refetch();
      }
    },
    [patchMedia, refetch],
  );

  // ==================== Drag-and-drop сортировка ====================

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent, list: MediaRow[], mediaType: "photo" | "video") => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = list.findIndex((m) => m.id === active.id);
      const newIndex = list.findIndex((m) => m.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      const reordered = arrayMove(list, oldIndex, newIndex);
      // Оптимистичное обновление кэша react-query
      queryClient.setQueryData<MediaResponse>(
        ["product-media", productId],
        (prev) =>
          prev
            ? {
                ...prev,
                photos: mediaType === "photo" ? reordered : prev.photos,
                videos: mediaType === "video" ? reordered : prev.videos,
              }
            : prev,
      );

      try {
        const payloadKey = mediaType === "photo" ? "photos" : "videos";
        const res = await csrfFetch(`/api/products/${productId}/media/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [payloadKey]: reordered.map((m) => m.id) }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        toast.success("Порядок сохранён");
        onChanged?.();
      } catch (e) {
        toast.error("Не удалось сохранить порядок", { description: e instanceof Error ? e.message : undefined });
        void queryClient.invalidateQueries({ queryKey: ["product-media", productId] });
      }
    },
    [queryClient, productId, onChanged],
  );

  // ==================== Рендер ====================

  if (mediaQuery.isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаем медиа товара...
        </div>
      </Card>
    );
  }

  if (mediaQuery.isError) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-destructive mb-3">
          {mediaQuery.error instanceof Error ? mediaQuery.error.message : "Не удалось загрузить медиа"}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Повторить</Button>
      </Card>
    );
  }

  const isEmpty = photos.length === 0 && videos.length === 0;

  return (
    <div className="space-y-5">
      <input
        ref={photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => void uploadFiles(e.target.files, "photo")}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm"
        multiple
        className="hidden"
        onChange={(e) => void uploadFiles(e.target.files, "video")}
      />

      {isEmpty && (
        <EmptyState
          icon={ImagePlus}
          title="Медиа пока нет"
          text="Пока нет медиа — загрузите до 10 фото и до 3 видео"
          action="+ Добавить фото"
          onAction={() => photoInputRef.current?.click()}
        />
      )}

      {/* ==================== Фотографии ==================== */}
      <section aria-label="Фотографии товара">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            Фото
            <Badge variant="outline" className={photoActive >= MAX_PHOTOS ? "bg-amber-50 text-amber-700 border-amber-300" : ""}>
              {photoActive}/{MAX_PHOTOS}
            </Badge>
            <span className="text-xs font-normal text-muted-foreground hidden sm:inline">
              первая — обложка карточки
            </span>
          </h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading || photoActive >= MAX_PHOTOS}
            onClick={() => photoInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
            Добавить фото
          </Button>
        </div>

        {photos.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleDragEnd(e, photos, "photo")}>
            <SortableContext items={photos.map((p) => p.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[560px] overflow-y-auto pr-1 scrollbar-thin">
                {photos.map((m) => (
                  <SortableMediaCard
                    key={m.id}
                    media={m}
                    canModerate={canModerate}
                    canSetCover={allowSetCover}
                    onApprove={() => void handleApprove(m)}
                    onReject={() => setRejectTarget(m)}
                    onSetCover={() => void handleSetCover(m)}
                    onDelete={() => setDeleteTarget(m)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>

      {/* ==================== Видео ==================== */}
      <section aria-label="Видео товара">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            Видео
            <Badge variant="outline" className={videoActive >= MAX_VIDEOS ? "bg-amber-50 text-amber-700 border-amber-300" : ""}>
              {videoActive}/{MAX_VIDEOS}
            </Badge>
          </h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading || videoActive >= MAX_VIDEOS}
            onClick={() => videoInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
            Добавить видео
          </Button>
        </div>

        {videos.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleDragEnd(e, videos, "video")}>
            <SortableContext items={videos.map((v) => v.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-[560px] overflow-y-auto pr-1 scrollbar-thin">
                {videos.map((m) => (
                  <SortableMediaCard
                    key={m.id}
                    media={m}
                    canModerate={canModerate}
                    canSetCover={allowSetCover}
                    onApprove={() => void handleApprove(m)}
                    onReject={() => setRejectTarget(m)}
                    onSetCover={() => void handleSetCover(m)}
                    onDelete={() => setDeleteTarget(m)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>

      {/* ==================== Диалог отклонения ==================== */}
      <RejectDialog
        media={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={async (comment) => {
          if (!rejectTarget) return;
          try {
            await patchMedia(rejectTarget, "reject", comment);
            toast.success("Медиа отклонено", { description: comment });
          } catch (e) {
            toast.error("Не удалось отклонить", { description: e instanceof Error ? e.message : undefined });
          } finally {
            setRejectTarget(null);
            refetch();
          }
        }}
      />

      {/* ==================== Диалог удаления ==================== */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить медиа?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.original_filename
                ? `Файл «${deleteTarget.original_filename}» будет удалён безвозвратно.`
                : "Файл будет удалён безвозвратно."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) void handleDelete(deleteTarget);
              }}
            >
              <Trash2 className="h-4 w-4 mr-1" />Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ==================== Sortable-карточка медиа ====================

function SortableMediaCard({
  media,
  canModerate,
  canSetCover,
  onApprove,
  onReject,
  onSetCover,
  onDelete,
}: {
  media: MediaRow;
  canModerate: boolean;
  canSetCover: boolean;
  onApprove: () => void;
  onReject: () => void;
  onSetCover: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: media.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  const statusMeta = STATUS_META[media.status];
  const StatusIcon = statusMeta.icon;

  return (
    <div ref={setNodeRef} style={style} className="relative group rounded-xl">
      <div className="relative overflow-hidden rounded-xl border border-border bg-muted/40">
        {/* Превью */}
        {media.media_type === "photo" ? (
          <img
            src={media.url}
            alt={media.original_filename || "Фото товара"}
            loading="lazy"
            decoding="async"
            className="aspect-square w-full object-cover"
          />
        ) : (
          <div className="relative">
            <video
              src={media.url}
              controls
              preload="metadata"
              className="aspect-video w-full rounded-xl bg-black/80"
            />
            {formatDuration(media.duration_seconds) && (
              <span className="absolute bottom-9 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white pointer-events-none">
                {formatDuration(media.duration_seconds)}
              </span>
            )}
          </div>
        )}

        {/* Верхний левый: статус + обложка */}
        <div className="absolute top-1.5 left-1.5 flex flex-col items-start gap-1">
          <Badge variant="outline" className={`text-[10px] gap-1 ${statusMeta.className}`}>
            <StatusIcon className="h-2.5 w-2.5" />
            {statusMeta.label}
          </Badge>
          {media.is_cover && (
            <Badge className="bg-primary text-primary-foreground text-[10px] gap-1">
              <Star className="h-2.5 w-2.5 fill-current" />
              Обложка
            </Badge>
          )}
        </div>

        {/* Верхний правый: сделать обложкой + удалить */}
        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {/* set-cover: только фото, не rejected (pending тоже можно — решает сервер) */}
          {canSetCover && media.media_type === "photo" && !media.is_cover && media.status !== "rejected" && (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-7 w-7 bg-white/90 hover:bg-white text-amber-600 shadow"
              title="Сделать обложкой"
              onClick={onSetCover}
            >
              <Star className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-7 w-7 bg-white/90 hover:bg-white text-red-600 shadow"
            title="Удалить"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Нижний: модерация */}
        {canModerate && media.status === "pending" && (
          <div className="absolute bottom-1.5 left-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <Button
              type="button"
              size="sm"
              className="h-7 flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
              onClick={onApprove}
            >
              <Check className="h-3 w-3 mr-0.5" />Одобрить
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 flex-1 bg-red-600 hover:bg-red-700 text-white text-xs"
              onClick={onReject}
            >
              <X className="h-3 w-3 mr-0.5" />Отклонить
            </Button>
          </div>
        )}
      </div>

      {/* Имя файла + ручка сортировки */}
      <div className="flex items-center gap-1 mt-1 px-0.5">
        <button
          type="button"
          className="flex items-center gap-0.5 text-muted-foreground/60 hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
          aria-label="Перетащить для сортировки"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5 shrink-0" />
        </button>
        <span className="text-[10px] text-muted-foreground truncate min-w-0">
          {media.original_filename || media.mime_type}
        </span>
      </div>
    </div>
  );
}

// ==================== Диалог отклонения с причиной ====================

function RejectDialog({
  media,
  onClose,
  onConfirm,
}: {
  media: MediaRow | null;
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
    <Dialog open={!!media} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Отклонить медиа</DialogTitle>
          <DialogDescription>
            Укажите причину — её увидит кондитер (обязательно, от 3 символов).
            {media?.original_filename ? ` Файл: «${media.original_filename}».` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="media-reject-reason">Причина отклонения</Label>
          <Textarea
            id="media-reject-reason"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Например: фото не соответствует товару, плохое качество, чужие водяные знаки..."
          />
          {comment.trim().length > 0 && !valid && (
            <p className="text-xs text-amber-600">Минимум 3 символа</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button
            variant="destructive"
            disabled={!valid || busy}
            onClick={() => void submit()}
          >
            <X className="h-4 w-4 mr-1" />Отклонить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
