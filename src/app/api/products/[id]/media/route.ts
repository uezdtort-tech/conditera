/**
 * GET  /api/products/[id]/media — медиа товара (Task 2-b).
 * POST /api/products/[id]/media — загрузка фото/видео (multipart, поле "file").
 *
 * GET:
 *   - товар не существует / deleted_at → 404;
 *   - owner (confectioner_id) | MODERATOR | ADMIN | SUPER_ADMIN видят все
 *     статусы, остальные — только approved;
 *   - ответ: { product_id, photos[], videos[], counts: { photos: {pending,
 *     approved, rejected}, videos: {...} } }, каждый элемент — строка БД
 *     (snake_case) + url /api/product-media/<id>;
 *   - photos: is_cover DESC, sort_order ASC; videos: sort_order ASC.
 *
 * POST (owner | MODERATOR | ADMIN | SUPER_ADMIN):
 *   - mediaType: "photo"|"video" (default photo);
 *   - размер → 413; сниффер магических байтов → 415 (SVG и прочее — запрет);
 *   - фото: sharp-метаданные (формат должен совпасть со сниффером,
 *     ≤8000px) → 415/422; видео: best-effort mvhd → 422 при >900 c;
 *   - пречек лимита (10 фото / 3 видео, rejected не считаются) → 409;
 *   - файл пишется в pending/ под СГЕНЕРИРОВАННЫМ именем; при любой ошибке
 *     INSERT (в т.ч. триггер P0001) файл удаляется (компенсация), код
 *     триггера PHOTO_LIMIT_REACHED / VIDEO_LIMIT_REACHED → 409.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";
import {
  absMediaPath,
  buildRelativePath,
  ensureProductDirs,
  removeFileQuiet,
  writeFileAtomic,
} from "@/lib/product-media/storage";
import {
  MediaValidationError,
  MAX_PHOTO_BYTES,
  MAX_VIDEO_BYTES,
  PHOTO_MIMES,
  VIDEO_MIMES,
  parseImageMeta,
  parseVideoMeta,
  sniffMime,
} from "@/lib/product-media/validation";
import {
  hasModeratorRole,
  jsonError,
  resolveProduct,
  sanitizeOriginalFilename,
  withUrl,
  CountRow,
  type MediaRow,
  type ProductRef,
} from "@/lib/product-media/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PHOTOS = 10;
const MAX_VIDEOS = 3;

interface RouteParams {
  params: Promise<{ id: string }>;
}

type Counts = { pending: number; approved: number; rejected: number };

function countsByStatus(
  rows: MediaRow[],
  mediaType: "photo" | "video"
): Counts {
  const counts: Counts = { pending: 0, approved: 0, rejected: 0 };
  for (const row of rows) {
    if (row.media_type === mediaType && row.status in counts) {
      counts[row.status] += 1;
    }
  }
  return counts;
}

/**
 * GET /api/products/[id]/media — список медиа товара.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const product: ProductRef | null = await resolveProduct(id);
    if (!product || product.deleted_at) {
      return jsonError(404, "NOT_FOUND", "Товар не найден");
    }

    const user = await getUserFromRequest(request);
    const privileged =
      user !== null &&
      (user.id === product.confectioner_id ||
        (await hasModeratorRole(user.id)));

    const pool = getPool();
    const { rows } = await pool.query<MediaRow>(
      privileged
        ? `SELECT * FROM product_media WHERE product_id = $1`
        : `SELECT * FROM product_media WHERE product_id = $1 AND status = 'approved'`,
      [product.id]
    );

    const photos = rows
      .filter((r) => r.media_type === "photo")
      .sort(
        (a, b) =>
          Number(b.is_cover) - Number(a.is_cover) ||
          a.sort_order - b.sort_order
      );
    const videos = rows
      .filter((r) => r.media_type === "video")
      .sort((a, b) => a.sort_order - b.sort_order);

    return NextResponse.json({
      product_id: product.id,
      photos: photos.map(withUrl),
      videos: videos.map(withUrl),
      counts: {
        photos: countsByStatus(rows, "photo"),
        videos: countsByStatus(rows, "video"),
      },
    });
  } catch (error) {
    console.error("[products/[id]/media] GET error:", error);
    return jsonError(500, "INTERNAL_ERROR", "Внутренняя ошибка сервера");
  }
}

/**
 * POST /api/products/[id]/media — загрузка фото/видео.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  let uploadedAbsPath: string | null = null;

  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return jsonError(401, "UNAUTHORIZED", "Необходима аутентификация");
    }
    const product: ProductRef | null = await resolveProduct(id);
    if (!product || product.deleted_at) {
      return jsonError(404, "NOT_FOUND", "Товар не найден");
    }
    const isOwner = user.id === product.confectioner_id;
    if (!isOwner && !(await hasModeratorRole(user.id))) {
      return jsonError(
        403,
        "FORBIDDEN",
        "Загрузка доступна владельцу товара или модератору"
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError(
        422,
        "VALIDATION_FAILED",
        "Ожидается multipart/form-data с полем file"
      );
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError(422, "VALIDATION_FAILED", "Файл не передан (поле file)");
    }

    const mediaTypeRaw = form.get("mediaType") ?? "photo";
    const mediaType =
      mediaTypeRaw === "video"
        ? "video"
        : mediaTypeRaw === "photo"
          ? "photo"
          : null;
    if (!mediaType) {
      return jsonError(
        422,
        "VALIDATION_FAILED",
        'mediaType должен быть "photo" или "video"'
      );
    }

    const maxBytes = mediaType === "photo" ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES;
    if (file.size > maxBytes) {
      return jsonError(
        413,
        "PAYLOAD_TOO_LARGE",
        `Файл слишком большой: ${file.size} байт (лимит ${maxBytes} для ${mediaType})`
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Только сниффер магических байтов — client Content-Type не доверяем.
    const sniffed = sniffMime(buffer);
    const allowed: readonly string[] =
      mediaType === "photo" ? PHOTO_MIMES : VIDEO_MIMES;
    if (!sniffed || !allowed.includes(sniffed.mime)) {
      return jsonError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        mediaType === "photo"
          ? "Допустимы только JPEG, PNG, WebP"
          : "Допустимы только MP4, WebM"
      );
    }

    let width: number | null = null;
    let height: number | null = null;
    let durationSeconds: number | null = null;
    try {
      if (mediaType === "photo") {
        const meta = await parseImageMeta(buffer, sniffed.mime);
        width = meta.width;
        height = meta.height;
      } else {
        const meta = parseVideoMeta(buffer, sniffed.mime);
        width = meta.width;
        height = meta.height;
        durationSeconds = meta.durationSeconds;
      }
    } catch (err) {
      if (err instanceof MediaValidationError) {
        return jsonError(err.status, err.code, err.message);
      }
      throw err;
    }

    const pool = getPool();

    // Пречек лимита (финальная гарантия — триггер в БД)
    const limit = mediaType === "photo" ? MAX_PHOTOS : MAX_VIDEOS;
    const countResult = await pool.query<CountRow>(
      `SELECT count(*)::int AS n FROM product_media
       WHERE product_id = $1 AND media_type = $2 AND status <> 'rejected'`,
      [product.id, mediaType]
    );
    if ((countResult.rows[0]?.n ?? 0) >= limit) {
      const code =
        mediaType === "photo" ? "PHOTO_LIMIT_REACHED" : "VIDEO_LIMIT_REACHED";
      return jsonError(
        409,
        code,
        mediaType === "photo"
          ? `Достигнут лимит: не более ${MAX_PHOTOS} фото на товар`
          : `Достигнут лимит: не более ${MAX_VIDEOS} видео на товар`
      );
    }

    const sortResult = await pool.query<{ [key: string]: unknown; max_sort: number }>(
      `SELECT COALESCE(MAX(sort_order), 0)::int AS max_sort FROM product_media
       WHERE product_id = $1 AND media_type = $2`,
      [product.id, mediaType]
    );
    const sortOrder = (sortResult.rows[0]?.max_sort ?? 0) + 10;

    // Первое живое фото товара автоматически становится обложкой
    let isCover = false;
    if (mediaType === "photo") {
      const anyPhoto = await pool.query(
        `SELECT 1 FROM product_media
         WHERE product_id = $1 AND media_type = 'photo' AND status <> 'rejected'
         LIMIT 1`,
        [product.id]
      );
      isCover = anyPhoto.rowCount === 0;
    }

    await ensureProductDirs(product.id);

    const relativePath = buildRelativePath({
      productId: product.id,
      stage: "pending",
      mediaType,
      ext: sniffed.ext,
      seq: Math.max(1, Math.round(sortOrder / 10)),
    });
    const absPath = absMediaPath(relativePath);
    await writeFileAtomic(absPath, buffer);
    uploadedAbsPath = absPath;

    const originalFilename = sanitizeOriginalFilename(file.name);

    try {
      const insertResult = await pool.query<MediaRow>(
        `INSERT INTO product_media
           (product_id, media_type, storage_path, original_filename, mime_type,
            file_size, width, height, duration_seconds, sort_order,
            status, is_cover, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $12)
         RETURNING *`,
        [
          product.id,
          mediaType,
          relativePath,
          originalFilename,
          sniffed.mime,
          buffer.length,
          width,
          height,
          durationSeconds,
          sortOrder,
          isCover,
          user.id,
        ]
      );
      const row = insertResult.rows[0];
      return NextResponse.json(withUrl(row), { status: 201 });
    } catch (dbErr) {
      // Компенсация: строка не вставлена — файл не должен остаться на диске
      await removeFileQuiet(absPath);
      uploadedAbsPath = null;

      const err = dbErr as { code?: string; message?: string };
      const message = String(err?.message ?? "");
      if (
        err?.code === "P0001" &&
        (message.includes("PHOTO_LIMIT_REACHED") ||
          message.includes("VIDEO_LIMIT_REACHED"))
      ) {
        const isPhoto =
          message.includes("PHOTO_LIMIT_REACHED");
        return jsonError(
          409,
          isPhoto ? "PHOTO_LIMIT_REACHED" : "VIDEO_LIMIT_REACHED",
          isPhoto
            ? `Достигнут лимит: не более ${MAX_PHOTOS} фото на товар`
            : `Достигнут лимит: не более ${MAX_VIDEOS} видео на товар`
        );
      }
      if (err?.code === "23505") {
        return jsonError(
          409,
          "COVER_CONFLICT",
          "Обложка уже назначена другому фото товара"
        );
      }
      console.error("[products/[id]/media] INSERT error:", err?.message);
      return jsonError(500, "INTERNAL_ERROR", "Не удалось сохранить медиа");
    }
  } catch (error) {
    if (uploadedAbsPath) {
      await removeFileQuiet(uploadedAbsPath).catch(() => {});
    }
    console.error("[products/[id]/media] POST error:", error);
    return jsonError(500, "INTERNAL_ERROR", "Внутренняя ошибка сервера");
  }
}
