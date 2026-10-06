"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Play,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProductMediaItem } from "@/lib/types";

// ==== Публичная галерея карточки товара (product_media, миграция 0052) ====
// Источники: media[] — уже approved-фото/видео с бэка (cover-first),
// images[] — legacy URL (дописываем в конец те, которых нет среди media).

export interface GalleryEntry {
  type: "photo" | "video";
  src: string;
  alt: string;
  durationSeconds?: number | null;
  isCover?: boolean;
}

function buildEntries(
  media?: ProductMediaItem[],
  images?: string[],
  title?: string
): GalleryEntry[] {
  const entries: GalleryEntry[] = [];
  const seen = new Set<string>();
  let photoNo = 0;
  let videoNo = 0;

  for (const m of media ?? []) {
    if (!m?.url || seen.has(m.url)) continue;
    // Бэк отдаёт только approved, но не полагаемся на это —
    // pending/rejected никогда не показываем публично.
    if (m.status && m.status !== "approved") continue;
    const isVideo = m.mediaType === "video" || m.mimeType?.startsWith("video/");
    const type: "photo" | "video" = isVideo ? "video" : "photo";
    const label = isVideo ? `Видео ${++videoNo}` : `Фото ${++photoNo}`;
    seen.add(m.url);
    entries.push({
      type,
      src: m.url,
      alt: title ? `${title} — ${label.toLowerCase()}` : label,
      durationSeconds: m.durationSeconds ?? undefined,
      isCover: Boolean(m.isCover),
    });
  }

  // Legacy-фото (старые товары без product_media): дописываем в конец без дублей
  for (const img of images ?? []) {
    if (!img || seen.has(img)) continue;
    seen.add(img);
    const label = `Фото ${++photoNo}`;
    entries.push({
      type: "photo",
      src: img,
      alt: title ? `${title} — ${label.toLowerCase()}` : label,
    });
  }

  return entries;
}

function formatDuration(seconds?: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const MAIN_MOTION = {
  initial: { opacity: 0, scale: 0.985 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.25, ease: "easeOut" as const },
};

export function ProductMediaGallery({
  media,
  images,
  title,
}: {
  media?: ProductMediaItem[];
  images?: string[];
  title?: string;
}) {
  const entries = useMemo(
    () => buildEntries(media, images, title),
    [media, images, title]
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const count = entries.length;
  const safeIndex = Math.min(activeIndex, Math.max(0, count - 1));
  const active = entries[safeIndex];

  // Медиа-набор мог измениться (live-обновление карточки) — не даём индексу выйти за границы
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, count - 1)));
  }, [count]);

  const goPrev = useCallback(() => {
    setActiveIndex((i) => (i - 1 + count) % count);
  }, [count]);

  const goNext = useCallback(() => {
    setActiveIndex((i) => (i + 1) % count);
  }, [count]);

  const handleLightboxKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    },
    [goPrev, goNext]
  );

  // Нет ни approved-медиа, ни legacy-фото — аккуратный пустой стейт
  if (count === 0 || !active) {
    return (
      <div
        className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-muted/40 px-6 text-center text-muted-foreground md:aspect-[16/10]"
        role="status"
      >
        <ImageOff className="h-8 w-8 opacity-50" aria-hidden />
        <p className="text-sm">Фото появятся после модерации</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Главная область */}
      <div className="relative">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={safeIndex} {...MAIN_MOTION}>
            {active.type === "photo" ? (
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="block w-full cursor-zoom-in rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label={`Открыть фото на весь экран (${safeIndex + 1} из ${count})`}
              >
                <img
                  src={active.src}
                  alt={active.alt}
                  className="w-full aspect-[4/3] md:aspect-[16/10] object-cover rounded-2xl"
                  loading="eager"
                  decoding="async"
                />
              </button>
            ) : (
              <video
                key={active.src}
                src={active.src}
                controls
                preload="metadata"
                playsInline
                className="w-full aspect-[4/3] md:aspect-[16/10] object-cover rounded-2xl bg-black/90"
                aria-label={active.alt}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Строка миниатюр */}
      {count > 1 && (
        <div
          className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent"
          role="listbox"
          aria-label="Медиа товара"
        >
          {entries.map((entry, i) => {
            const isActive = i === safeIndex;
            const duration = formatDuration(entry.durationSeconds);
            return (
              <button
                key={`${entry.src}-${i}`}
                type="button"
                onClick={() => setActiveIndex(i)}
                role="option"
                aria-selected={isActive}
                aria-label={entry.alt}
                className={`relative h-[72px] w-[88px] shrink-0 overflow-hidden rounded-lg bg-muted transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:h-20 sm:w-24 ${
                  isActive
                    ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : "opacity-80 ring-1 ring-border hover:opacity-100"
                }`}
              >
                {entry.type === "photo" ? (
                  <img
                    src={entry.src}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <>
                    <video
                      src={`${entry.src}#t=0.1`}
                      preload="metadata"
                      muted
                      playsInline
                      tabIndex={-1}
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <Play
                        className="h-5 w-5 fill-white text-white"
                        aria-hidden
                      />
                    </span>
                    {duration && (
                      <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-medium leading-none text-white">
                        {duration}
                      </span>
                    )}
                  </>
                )}
                {entry.isCover && entry.type === "photo" && (
                  <span className="absolute left-1 top-1 rounded bg-primary/90 px-1.5 py-0.5 text-[9px] font-medium leading-none text-primary-foreground">
                    Главное
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Лайтбокс — полноразмерный просмотр с клавиатурной навигацией */}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent
          className="max-w-5xl border-none bg-black/95 p-3 sm:p-4"
          onKeyDown={handleLightboxKeyDown}
        >
          <DialogTitle className="sr-only">
            {title ? `Фотографии: ${title}` : "Просмотр медиа"}
          </DialogTitle>
          <div className="relative">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`lightbox-${safeIndex}`}
                {...MAIN_MOTION}
                className="flex min-h-[40vh] items-center justify-center"
              >
                {active.type === "photo" ? (
                  <img
                    src={active.src}
                    alt={active.alt}
                    className="mx-auto max-h-[75vh] w-auto max-w-full rounded-lg object-contain"
                    decoding="async"
                  />
                ) : (
                  <video
                    key={active.src}
                    src={active.src}
                    controls
                    preload="metadata"
                    playsInline
                    className="mx-auto max-h-[75vh] w-full max-w-full rounded-lg bg-black"
                    aria-label={active.alt}
                  />
                )}
              </motion.div>
            </AnimatePresence>

            {count > 1 && (
              <>
                <button
                  type="button"
                  onClick={goPrev}
                  aria-label="Предыдущее фото"
                  className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/85 text-foreground shadow-md transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  aria-label="Следующее фото"
                  className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/85 text-foreground shadow-md transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ChevronRight className="h-5 w-5" aria-hidden />
                </button>
              </>
            )}

            <p className="mt-3 text-center text-sm text-white/80" aria-live="polite">
              {safeIndex + 1} / {count}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
