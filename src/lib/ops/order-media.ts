/**
 * order-media.ts — фото готовности и передачи заказа.
 *
 * Файлы хранятся в отдельном приватном Supabase Storage bucket "order_media".
 * Метаданные и связь с заказом остаются в public.order_media (PostgreSQL).
 * Доступ к объектам выдаётся только через авторизованный API, который
 * проверяет владельца/назначенного участника заказа.
 */
import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/postgrest/pool";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { MediaStorageError } from "@/lib/product-media/storage";
import {
  sniffMime,
  parseImageMeta,
  PHOTO_MIMES,
  MAX_PHOTO_BYTES,
  MAX_IMAGE_DIM,
  MediaValidationError,
} from "@/lib/product-media/validation";

export { MediaValidationError, MediaStorageError, MAX_PHOTO_BYTES };

const ORDER_MEDIA_BUCKET = "order_media";

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

/** Проверка ключа объекта: не допускаем произвольные storage paths. */
function assertOrderMediaPath(storagePath: string): void {
  if (
    typeof storagePath !== "string" ||
    !storagePath.startsWith("orders/") ||
    storagePath.includes("..") ||
    storagePath.startsWith("/")
  ) {
    throw new MediaStorageError("Invalid order media storage path");
  }
}

/**
 * Сохранить фото готовности: валидация → private Supabase Storage → метаданные PG.
 * При ошибке INSERT удаляет уже загруженный объект (компенсация).
 */
export async function saveOrderReadyPhoto(params: {
  orderId: string;
  file: File;
  uploadedBy: string;
  kind?: "ready_photo" | "handoff_photo";
}): Promise<OrderMediaRow> {
  const buffer = Buffer.from(await params.file.arrayBuffer());

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

  // Реальный MIME по magic bytes; не доверяем расширению/Content-Type клиента.
  const sniffed = sniffMime(buffer);
  if (!sniffed || !isPhotoMime(sniffed.mime)) {
    throw new MediaValidationError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Поддерживаются только фото JPEG/PNG/WebP"
    );
  }

  const meta = await parseImageMeta(buffer, sniffed.mime);
  if (
    meta.width > MAX_IMAGE_DIM ||
    meta.height > MAX_IMAGE_DIM
  ) {
    throw new MediaValidationError(
      422,
      "IMAGE_DIMENSIONS_TOO_LARGE",
      `Размер изображения не должен превышать ${MAX_IMAGE_DIM}px по каждой стороне`
    );
  }

  const ext = EXT_BY_MIME[sniffed.mime] ?? "jpg";
  const storagePath = `orders/${params.orderId}/published/photos/${randomUUID()}.${ext}`;
  assertOrderMediaPath(storagePath);

  const { error: uploadError } = await supabaseAdmin.storage
    .from(ORDER_MEDIA_BUCKET)
    .upload(storagePath, buffer, {
      contentType: sniffed.mime,
      cacheControl: "3600",
      upsert: false,
    });
  if (uploadError) {
    throw new MediaStorageError(`Supabase Storage upload failed: ${uploadError.message}`);
  }

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
        storagePath,
        params.file.name?.slice(0, 200) ?? null,
        sniffed.mime,
        buffer.length,
        meta.width,
        meta.height,
        params.uploadedBy,
      ]
    );
    const row = res.rows[0];
    return {
      id: row.id,
      orderId: row.order_id,
      kind: row.kind,
      storagePath: row.storage_path,
      mimeType: row.mime_type,
      fileSize: Number(row.file_size),
      width: row.width,
      height: row.height,
      uploadedBy: row.uploaded_by,
      uploadedAt: new Date(row.uploaded_at).toISOString(),
    };
  } catch (err) {
    const { error: cleanupError } = await supabaseAdmin.storage
      .from(ORDER_MEDIA_BUCKET)
      .remove([storagePath]);
    if (cleanupError) {
      console.error("[order-media] failed to compensate storage upload:", cleanupError.message);
    }
    throw err;
  }
}

/** Скачать фото из приватного bucket. Вызывать только после проверки доступа к заказу. */
export async function downloadOrderMedia(storagePath: string): Promise<Buffer> {
  assertOrderMediaPath(storagePath);
  const { data, error } = await supabaseAdmin.storage
    .from(ORDER_MEDIA_BUCKET)
    .download(storagePath);
  if (error || !data) {
    throw new MediaStorageError(`Supabase Storage download failed: ${error?.message ?? "empty object"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

/** Удалить фото: статус PG + объект Storage. */
export async function deleteOrderMedia(
  mediaId: string
): Promise<{ deleted: boolean; storagePath: string | null }> {
  const pool = getPool();
  const selected = await pool.query<{ storage_path: string }>(
    `SELECT storage_path FROM public.order_media WHERE id = $1::uuid`,
    [mediaId]
  );
  const storagePath = selected.rows[0]?.storage_path;
  if (!storagePath) return { deleted: false, storagePath: null };

  assertOrderMediaPath(storagePath);
  await pool.query(`UPDATE public.order_media SET status='deleted' WHERE id = $1::uuid`, [mediaId]);
  const { error } = await supabaseAdmin.storage.from(ORDER_MEDIA_BUCKET).remove([storagePath]);
  if (error) {
    console.warn("[order-media] Storage object deletion failed:", error.message);
  }
  return { deleted: true, storagePath };
}

/** Получить метаданные фото по id (для API после проверки доступа). */
export async function getOrderMedia(mediaId: string): Promise<OrderMediaRow | null> {
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
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    kind: row.kind,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    width: row.width,
    height: row.height,
    uploadedBy: row.uploaded_by,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
  };
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
