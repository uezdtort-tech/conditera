import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/postgrest/pool";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  sniffMime, parseImageMeta, PHOTO_MIMES, MAX_PHOTO_BYTES,
  MediaValidationError,
} from "@/lib/product-media/validation";

export { MediaValidationError };
const BUCKET = "quote_media";
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

export interface QuoteMedia {
  id: string;
  quoteRequestId: string;
  kind: "customer_reference" | "builder_preview";
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  uploadedAt: string;
}

export async function saveQuoteMedia(input: {
  quoteRequestId: string;
  file: File;
  uploadedBy: string;
  kind: "customer_reference" | "builder_preview";
}): Promise<QuoteMedia> {
  const buffer = Buffer.from(await input.file.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) {
    throw new MediaValidationError(422, "VALIDATION_FAILED",
      buffer.length ? "Файл больше 8 МБ" : "Файл пустой");
  }
  const sniffed = sniffMime(buffer);
  if (!sniffed || !(PHOTO_MIMES as readonly string[]).includes(sniffed.mime)) {
    throw new MediaValidationError(415, "UNSUPPORTED_MEDIA_TYPE",
      "Поддерживаются только фото JPEG/PNG/WebP");
  }
  const meta = await parseImageMeta(buffer, sniffed.mime);
  const path = `quotes/${input.quoteRequestId}/references/${randomUUID()}.${EXT[sniffed.mime]}`;
  const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, {
    contentType: sniffed.mime, cacheControl: "3600", upsert: false,
  });
  if (uploadError) throw new Error(`QUOTE_STORAGE_UPLOAD_FAILED: ${uploadError.message}`);

  try {
    const pool = getPool();
    const result = await pool.query<{
      id: string; quote_request_id: string; kind: "customer_reference" | "builder_preview";
      mime_type: string; file_size: number; width: number; height: number; uploaded_at: Date;
    }>(`INSERT INTO public.quote_request_media
      (quote_request_id, kind, storage_path, original_filename, mime_type,
       file_size, width, height, uploaded_by, status)
      VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid, 'approved')
      RETURNING id::text, quote_request_id::text, kind, mime_type, file_size,
                width, height, uploaded_at`,
      [input.quoteRequestId, input.kind, path, input.file.name.slice(0, 200),
       sniffed.mime, buffer.length, meta.width, meta.height, input.uploadedBy]);
    const row = result.rows[0];
    return {
      id: row.id, quoteRequestId: row.quote_request_id, kind: row.kind,
      mimeType: row.mime_type, fileSize: Number(row.file_size),
      width: row.width, height: row.height, uploadedAt: new Date(row.uploaded_at).toISOString(),
    };
  } catch (error) {
    const { error: cleanupError } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
    if (cleanupError) console.error("[quote-media] storage compensation failed:", cleanupError.message);
    const dbError = error as { code?: string; message?: string };
    if (dbError.code === "23514" && dbError.message?.includes("QUOTE_MEDIA_LIMIT")) {
      throw new MediaValidationError(422, "PHOTO_LIMIT_REACHED",
        "К запросу можно прикрепить не более 10 изображений");
    }
    throw error;
  }
}

export async function listQuoteMedia(quoteRequestId: string): Promise<QuoteMedia[]> {
  const pool = getPool();
  const result = await pool.query<{
    id: string; quote_request_id: string; kind: "customer_reference" | "builder_preview";
    mime_type: string; file_size: number; width: number; height: number; uploaded_at: Date;
  }>(`SELECT id::text, quote_request_id::text, kind, mime_type, file_size,
             width, height, uploaded_at
      FROM public.quote_request_media
      WHERE quote_request_id = $1::uuid AND status = 'approved'
      ORDER BY uploaded_at ASC`, [quoteRequestId]);
  return result.rows.map(row => ({
    id: row.id, quoteRequestId: row.quote_request_id, kind: row.kind,
    mimeType: row.mime_type, fileSize: Number(row.file_size),
    width: row.width, height: row.height, uploadedAt: new Date(row.uploaded_at).toISOString(),
  }));
}

export async function downloadQuoteMedia(quoteRequestId: string, mediaId: string): Promise<{
  buffer: Buffer; mimeType: string;
} | null> {
  const pool = getPool();
  const result = await pool.query<{ storage_path: string; mime_type: string }>(
    `SELECT storage_path, mime_type FROM public.quote_request_media
     WHERE id = $1::uuid AND quote_request_id = $2::uuid AND status = 'approved'`,
    [mediaId, quoteRequestId]);
  const row = result.rows[0];
  if (!row) return null;
  if (!row.storage_path.startsWith(`quotes/${quoteRequestId}/references/`) ||
      row.storage_path.includes("..") || row.storage_path.startsWith("/")) {
    throw new Error("Invalid quote media storage path");
  }
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(row.storage_path);
  if (error || !data) throw new Error(`QUOTE_STORAGE_DOWNLOAD_FAILED: ${error?.message ?? "empty object"}`);
  return { buffer: Buffer.from(await data.arrayBuffer()), mimeType: row.mime_type };
}
