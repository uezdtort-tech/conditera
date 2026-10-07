/**
 * order-media.ts — фото готовности заказа (P0.5 §35).
 *
 * ПЕРЕИСПОЛЬЗУЕТ существующую product-media инфраструктуру:
 *   • src/lib/product-media/storage.ts — STORAGE_ROOT, absMediaPath,
 *     writeFileAtomic, removeFileQuiet (единый storage subsystem);
 *   • src/lib/product-media/validation.ts — sniffMime, parseImageMeta
 *     (реальный MIME по magic bytes, НЕ только расширение).
 *
 * Путь: orders/<orderId>/published/photos/<uuid>.<ext> — относительный
 * от storage root (ТЗ P0.4 §storage). Статус сразу 'approved': это
 * внутренний QC-артефакт, не витринный контент (в модерации не участвует).
 */

import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { getPool } from "@/lib/postgrest/pool";
import {
  STORAGE_ROOT,
  writeFileAtomic,
  removeFileQuiet,
  MediaStorageError,
} from "@/lib/product-media/storage";
import {
  sniffMime,
  parseImageMeta,
  PHOTO_MIMES,
  MAX_PHOTO_BYTES,
  MAX_IMAGE_DIM,
  MediaValidationError,
} from "@/lib/product-media/validation";

export { MediaValidationError, MediaStorageError, MAX_PHOTO_BYTES };

/** MIME относится к допустимым фото? */
function isPhotoMime(mime: string): boolean {
  return (PHOTO_MIMES as readonly string[]).includes(mime);
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface OrderMediaRow {
  id: string;
  orderId: string;
  kind: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

/**
 * Безопасно построить абсолютный путь из относительного (анти-path-traversal).
 * Путь обязан оставаться внутри STORAGE_ROOT.
 */
export function safeAbsOrderMediaPath(relPath: string): string {
  const abs = resolve(STORAGE_ROOT, relPath);
  const root = resolve(STORAGE_ROOT);
  if (abs !== root && !abs.startsWith(root + "/")) {
    throw new MediaStorageError("Path traversal attempt blocked");
  }
  return abs;
}

/**
 * Сохранить фото готовности: валидация → FS → метаданные в БД.
 * Возвращает строку order_media.
 */
export async function saveOrderReadyPhoto(params: {
  orderId: string;
  file: File;
  uploadedBy: string;
  kind?: "ready_photo" | "handoff_photo";
}): Promise<OrderMediaRow> {
  const buffer = Buffer.from(await params.file.arrayBuffer());

  // Размер
  if (buffer.length === 0) {
    throw new MediaValidationError(422, "VALIDATION_FAILED", "Файл пустой");
  }
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new MediaValidationError(
      422,
      "VALIDATION_FAILED",
      `Файл больше ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} МБ`
    );
  }

  // Реальный MIME по magic bytes (ТЗ: «не доверять только расширению»)
  const sniffed = sniffMime(buffer);
  if (!sniffed || !isPhotoMime(sniffed.mime)) {
    throw new MediaValidationError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Поддерживаются только фото JPEG/PNG/WebP"
    );
  }

  // Размеры изображения (полное чтение заголовков; формат сверяется со сниффером)
  const meta = await parseImageMeta(buffer, sniffed.mime);

  // Относительный путь с UUID-именем (не оригинальное имя пользователя)
  const ext = EXT_BY_MIME[sniffed.mime] ?? "jpg";
  const relPath = `orders/${params.orderId}/published/photos/${randomUUID()}.${ext}`;
  const abs = safeAbsOrderMediaPath(relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFileAtomic(abs, buffer);

  const pool = getPool();
  try {
    const res = await pool.query<{
      id: string;
      order_id: string;
      kind: string;
      storage_path: string;
      mime_type: string;
      file_size: number;
      width: number | null;
      height: number | null;
      uploaded_by: string | null;
      uploaded_at: Date;
    }>(
      `INSERT INTO public.order_media
         (order_id, kind, media_type, storage_path, original_filename,
          mime_type, file_size, width, height, uploaded_by, status)
       VALUES ($1::uuid, $2, 'photo', $3, $4, $5, $6, $7, $8, $9::uuid, 'approved')
       RETURNING id::text, order_id::text, kind, storage_path, mime_type,
                 file_size, width, height, uploaded_by::text, uploaded_at`,
      [
        params.orderId,
        params.kind ?? "ready_photo",
        relPath,
        params.file.name?.slice(0, 200) ?? null,
        sniffed.mime,
        buffer.length,
        meta.width,
        meta.height,
        params.uploadedBy,
      ]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      orderId: r.order_id,
      kind: r.kind,
      storagePath: r.storage_path,
      mimeType: r.mime_type,
      fileSize: Number(r.file_size),
      width: r.width,
      height: r.height,
      uploadedBy: r.uploaded_by,
      uploadedAt: new Date(r.uploaded_at).toISOString(),
    };
  } catch (err) {
    // Компенсация: удалить файл, если БД-вставка не удалась (DB/FS consistency)
    await removeFileQuiet(abs);
    throw err;
  }
}

/** Удалить фото: БД-запись + файл (файл может отсутствовать — не ошибка). */
export async function deleteOrderMedia(
  mediaId: string
): Promise<{ deleted: boolean; storagePath: string | null }> {
  const pool = getPool();
  const sel = await pool.query<{ storage_path: string }>(
    `SELECT storage_path FROM public.order_media WHERE id = $1::uuid`,
    [mediaId]
  );
  const rel = sel.rows[0]?.storage_path;
  if (!rel) return { deleted: false, storagePath: null };

  await pool.query(`UPDATE public.order_media SET status='deleted' WHERE id = $1::uuid`, [
    mediaId,
  ]);
  try {
    await unlink(safeAbsOrderMediaPath(rel));
  } catch {
    // Файл может отсутствовать — толерантно (ТЗ §«Удаление»)
  }
  return { deleted: true, storagePath: rel };
}

/** Получить фото по id (для стриминга). */
export async function getOrderMedia(
  mediaId: string
): Promise<OrderMediaRow | null> {
  const pool = getPool();
  const res = await pool.query<{
    id: string;
    order_id: string;
    kind: string;
    storage_path: string;
    mime_type: string;
    file_size: number;
    width: number | null;
    height: number | null;
    uploaded_by: string | null;
    uploaded_at: Date;
  }>(
    `SELECT id::text, order_id::text, kind, storage_path, mime_type,
            file_size, width, height, uploaded_by::text, uploaded_at
     FROM public.order_media
     WHERE id = $1::uuid AND status = 'approved'`,
    [mediaId]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    orderId: r.order_id,
    kind: r.kind,
    storagePath: r.storage_path,
    mimeType: r.mime_type,
    fileSize: Number(r.file_size),
    width: r.width,
    height: r.height,
    uploadedBy: r.uploaded_by,
    uploadedAt: new Date(r.uploaded_at).toISOString(),
  };
}

/** Путь до физического файла фото. */
export function orderMediaAbsPath(row: OrderMediaRow): string {
  return join(STORAGE_ROOT, row.storagePath);
}

/** Count approved ready photos (для гейтов/UI). */
export async function countApprovedReadyPhotos(orderId: string): Promise<number> {
  const pool = getPool();
  const res = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM public.order_media
     WHERE order_id = $1::uuid AND kind='ready_photo' AND status='approved'`,
    [orderId]
  );
  return res.rows[0]?.c ?? 0;
}
