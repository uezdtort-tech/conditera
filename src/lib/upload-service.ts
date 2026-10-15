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
 * Единое сообщение о превышении лимита для pre-parse гейта (DEV-20 / U-12, U-13).
 * Имя файла здесь ещё неизвестно (multipart не разобран), формат согласован
 * с per-file сообщением в saveUploadedFile (…: больше N МБ).
 */
export const OVERSIZE_UPLOAD_MESSAGE = `Файл слишком большой: больше ${Math.round(
  MAX_UPLOAD_BYTES / 1024 / 1024
)} МБ`;

/** Content-Length заголовка как число или null (chunked / отсутствует / не число). */
function contentLengthOf(request: Request): number | null {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Разобрать multipart/form-data с когерентным контрактом размеров (DEV-20).
 *
 * Три зоны контракта:
 *  1. Content-Length ≤ MAX_UPLOAD_BYTES — обычный разбор request.formData().
 *  2. Content-Length > MAX_UPLOAD_BYTES → 422 FILE_TOO_LARGE ЕЩЁ ДО разбора
 *     тела (тело не читается). Та же 422 возвращается из catch при неудаче
 *     formData(), если заголовок говорит «больше лимита» — это покрывает зону
 *     молчаливой обрезки тела платформой (клон тела для middleware/proxy:
 *     DEFAULT_BODY_CLONE_SIZE_LIMIT = 10 MiB, node_modules/next/dist/server/
 *     body-streams.js:30 — formData() бросает TypeError "Unexpected end of
 *     form", а раньше это выдавало бессмысленный 400 BAD_REQUEST).
 *  3. Chunked-запрос без Content-Length (или с нечисловым): размер заранее
 *     неизвестен — неудача разбора остаётся документированным 400
 *     BAD_REQUEST (прежнее поведение).
 *
 * Бросает только UploadServiceError; сам лимит MAX_UPLOAD_BYTES не меняет.
 * Общий хелпер для POST /api/upload и POST /api/services/upload — без
 * дублирования логики в роутах.
 */
export async function parseUploadRequest(request: Request): Promise<FormData> {
  const contentLength = contentLengthOf(request);

  if (contentLength !== null && contentLength > MAX_UPLOAD_BYTES) {
    throw new UploadServiceError(422, "FILE_TOO_LARGE", OVERSIZE_UPLOAD_MESSAGE);
  }

  try {
    return await request.formData();
  } catch {
    // Defense-in-depth: до разбора мы гейт уже прошли, здесь 422 достижим
    // только если платформа обрезала тело при Content-Length > лимита
    // (например, заголовок появился после предварительной проверки) —
    // переводим в тот же FILE_TOO_LARGE вместо бессмысленного BAD_REQUEST.
    if (contentLength !== null && contentLength > MAX_UPLOAD_BYTES) {
      throw new UploadServiceError(422, "FILE_TOO_LARGE", OVERSIZE_UPLOAD_MESSAGE);
    }
    throw new UploadServiceError(400, "BAD_REQUEST", "Ожидается multipart/form-data");
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
