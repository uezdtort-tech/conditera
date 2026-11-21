import { randomUUID } from "node:crypto";
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
    const { data: row, error: insertError } = await supabaseAdmin
      .from("quote_request_media")
      .insert({
        quote_request_id: input.quoteRequestId,
        kind: input.kind,
        storage_path: path,
        original_filename: input.file.name.slice(0, 200),
        mime_type: sniffed.mime,
        file_size: buffer.length,
        width: meta.width,
        height: meta.height,
        uploaded_by: input.uploadedBy,
        status: "approved",
      })
      .select("id, quote_request_id, kind, mime_type, file_size, width, height, uploaded_at")
      .single();
    if (insertError || !row) throw insertError || new Error("QUOTE_MEDIA_METADATA_INSERT_FAILED");
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
  const { data: rows, error } = await supabaseAdmin
    .from("quote_request_media")
    .select("id, quote_request_id, kind, mime_type, file_size, width, height, uploaded_at")
    .eq("quote_request_id", quoteRequestId)
    .eq("status", "approved")
    .order("uploaded_at", { ascending: true });
  if (error) throw error;
  return (rows ?? []).map(row => ({
    id: row.id, quoteRequestId: row.quote_request_id, kind: row.kind,
    mimeType: row.mime_type, fileSize: Number(row.file_size),
    width: row.width, height: row.height, uploadedAt: new Date(row.uploaded_at).toISOString(),
  }));
}

export async function downloadQuoteMedia(quoteRequestId: string, mediaId: string): Promise<{
  buffer: Buffer; mimeType: string;
} | null> {
  const { data: row, error: lookupError } = await supabaseAdmin
    .from("quote_request_media")
    .select("storage_path, mime_type")
    .eq("id", mediaId)
    .eq("quote_request_id", quoteRequestId)
    .eq("status", "approved")
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!row) return null;
  if (!row.storage_path.startsWith(`quotes/${quoteRequestId}/references/`) ||
      row.storage_path.includes("..") || row.storage_path.startsWith("/")) {
    throw new Error("Invalid quote media storage path");
  }
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(row.storage_path);
  if (error || !data) throw new Error(`QUOTE_STORAGE_DOWNLOAD_FAILED: ${error?.message ?? "empty object"}`);
  return { buffer: Buffer.from(await data.arrayBuffer()), mimeType: row.mime_type };
}
