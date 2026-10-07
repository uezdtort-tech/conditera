/**
 * upload-service.ts — общий движок совместимых upload-endpoint'ов (ТЗ P0.5 §3).
 *
 * Аудит показал: фронтенд реально вызывает
 *   • POST /api/services/upload (services-manager, поле files → {urls})
 *   • POST /api/upload          (atelier/lessons, поле file → {url})
 * но оба endpoint'а не существовали (404 в рантайме).
 *
 * Реализация переиспользует СУЩЕСТВУЮЩИЙ storage-шим (bucket 'media',
 * миграция compat 0000, раздача /storage/v1/object/public/media/...):
 *   • реальный MIME по magic bytes (sniffMime) — не доверяем расширению;
 *   • UUID-имя файла (оригинальное имя не используется);
 *   • лимит размера и количества.
 */

import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sniffMime } from "@/lib/product-media/validation";

export const UPLOAD_BUCKET = "media";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 МБ
export const MAX_UPLOAD_FILES = 8;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "application/pdf": "pdf",
};

export class UploadServiceError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Сохранить один файл. Возвращает публичный URL (относительный путь шима).
 * Каталог — <category>/<uuid>.<ext>; category очищается (анти-traversal).
 */
export async function saveUploadedFile(file: File, category: string): Promise<string> {
  if (file.size === 0) {
    throw new UploadServiceError(400, "EMPTY_FILE", `Файл ${file.name}: пустой`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadServiceError(
      422,
      "FILE_TOO_LARGE",
      `Файл ${file.name}: больше ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} МБ`
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffMime(buffer);
  if (!sniffed) {
    throw new UploadServiceError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      `Файл ${file.name}: тип не распознан (допустимы JPEG/PNG/WebP/GIF/MP4/WebM/PDF)`
    );
  }
  const ext = EXT_BY_MIME[sniffed.mime] ?? "bin";

  // Анти-traversal: только [a-z0-9-_]
  const safeCategory =
    (category || "misc")
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .slice(0, 40) || "misc";

  const filePath = `${safeCategory}/${randomUUID()}.${ext}`;
  const { error } = await supabaseAdmin.storage.from(UPLOAD_BUCKET).upload(filePath, buffer, {
    contentType: sniffed.mime,
    upsert: false,
  });
  if (error) {
    throw new UploadServiceError(500, "STORAGE_ERROR", `Не удалось сохранить файл: ${error.message}`);
  }

  const { data } = supabaseAdmin.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

/** Сохранить несколько файлов (поле files/file), возвращая URL'ы. */
export async function saveUploadedFiles(files: File[], category: string): Promise<string[]> {
  const urls: string[] = [];
  for (const f of files) {
    urls.push(await saveUploadedFile(f, category));
  }
  return urls;
}
