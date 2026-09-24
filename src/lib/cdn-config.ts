/**
 * CDN Configuration — управление CDN для статики и загрузок.
 *
 * Поддерживаемые провайдеры:
 *   1. Cloudflare R2 (S3-compatible) — рекомендуется для production
 *   2. Supabase Storage — встроен в Supabase
 *   3. Локальное хранение (public/uploads/) — для dev
 *
 * CDN_URL env: если задан, все URL загрузок заменяются на CDN.
 * Пример: CDN_URL=https://cdn.conditera.ru → /uploads/products/1.webp → https://cdn.conditera.ru/uploads/products/1.webp
 *
 * R2/S3 конфигурация (опционально):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *
 * Использование:
 *   import { getPublicUrl, isCDNEnabled, getCDNConfig } from "@/lib/cdn-config";
 *   const url = getPublicUrl("/uploads/products/123.webp");
 */

const CDN_URL = process.env.CDN_URL || "";
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET || "";

export interface CDNConfig {
  enabled: boolean;
  provider: "local" | "cloudflare-r2" | "supabase";
  cdnUrl: string;
  bucket?: string;
}

/**
 * Проверить, включён ли CDN.
 */
export function isCDNEnabled(): boolean {
  return CDN_URL.length > 0;
}

/**
 * Получить конфигурацию CDN.
 */
export function getCDNConfig(): CDNConfig {
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET) {
    return {
      enabled: true,
      provider: "cloudflare-r2",
      cdnUrl: CDN_URL || `https://${R2_BUCKET}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      bucket: R2_BUCKET,
    };
  }

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return {
      enabled: Boolean(CDN_URL),
      provider: "supabase",
      cdnUrl: CDN_URL || supabaseUrl,
      bucket: "uploads",
    };
  }

  return {
    enabled: false,
    provider: "local",
    cdnUrl: "",
  };
}

/**
 * Преобразовать локальный URL в CDN URL.
 * Если CDN не включён — возвращает оригинальный URL.
 *
 * @example
 *   getPublicUrl("/uploads/products/123.webp")
 *   // → "https://cdn.conditera.ru/uploads/products/123.webp" (если CDN включён)
 *   // → "/uploads/products/123.webp" (если CDN выключен)
 */
export function getPublicUrl(localUrl: string): string {
  if (!localUrl) return localUrl;

  // Уже абсолютный URL (https://...) — возвращаем как есть
  if (localUrl.startsWith("http://") || localUrl.startsWith("https://")) {
    return localUrl;
  }

  // CDN включён — заменяем на CDN URL
  if (isCDNEnabled() && localUrl.startsWith("/uploads/")) {
    return `${CDN_URL}${localUrl}`;
  }

  return localUrl;
}

/**
 * Получить thumbnail URL из основного URL.
 * /uploads/products/123.webp → /uploads/products/123_thumb.webp
 */
export function getThumbUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.endsWith("_thumb.webp")) return url;
  if (url.endsWith(".webp")) {
    return url.replace(/\.webp$/, "_thumb.webp");
  }
  return null;
}

/**
 * Загрузить файл в R2/S3 (если настроен).
 * Возвращает публичный URL или null если R2 не настроен.
 */
export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string | null> {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    return null; // R2 не настроен
  }

  try {
    const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`;

    // AWS S3 compatible PUT
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": buffer.length.toString(),
      },
      body: new Uint8Array(buffer),
    });

    if (!response.ok) {
      console.error("[cdn] R2 upload failed:", response.status, await response.text());
      return null;
    }

    return `${CDN_URL || `https://${R2_BUCKET}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`}/${key}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cdn] R2 upload error:", msg);
    return null;
  }
}
