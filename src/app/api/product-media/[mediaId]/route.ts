/**
 * GET /api/product-media/[mediaId] — публичная раздача файла медиа (Task 2-b).
 * HEAD — те же заголовки без тела.
 *
 * Правила доступа:
 *   - approved → файл из published/ по storage_path, кэш public immutable;
 *   - pending/rejected → только owner товара / MODERATOR / ADMIN /
 *     SUPER_ADMIN; всем остальным — 404 (НЕ 403, чтобы не раскрывать
 *     существование медиа);
 *   - файла нет на диске при живой строке → 404 + console.warn
 *     (рассинхрон DB/filesystem).
 *
 * Заголовки: Content-Type из БД (доверяем своему снифферу при загрузке),
 * Content-Length, Accept-Ranges, X-Content-Type-Options: nosniff,
 * ETag "<id>-<size>" (If-None-Match → 304).
 * Range: "bytes=start-end" / "bytes=start-" / "bytes=-N" → 206 + Content-Range;
 * невалидный диапазон → 416. Стриминг через fs.createReadStream + Readable.toWeb.
 */

import { createReadStream, promises as fsp } from "fs";
import { Readable } from "stream";
import { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";
import { absMediaPath } from "@/lib/product-media/storage";
import {
  hasModeratorRole,
  jsonError,
  UUID_RE,
} from "@/lib/product-media/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ mediaId: string }>;
}

interface StreamMediaRow {
  [key: string]: unknown;
  id: string;
  product_id: string;
  media_type: "photo" | "video";
  storage_path: string;
  mime_type: string;
  file_size: number;
  status: "pending" | "approved" | "rejected";
  owner_id: string;
  product_deleted_at: string | null;
}

async function loadMedia(mediaId: string): Promise<StreamMediaRow | null> {
  if (!UUID_RE.test(mediaId)) return null;
  const pool = getPool();
  const { rows } = await pool.query<StreamMediaRow>(
    `SELECT m.id, m.product_id, m.media_type, m.storage_path, m.mime_type,
            m.file_size, m.status,
            p.confectioner_id AS owner_id, p.deleted_at AS product_deleted_at
     FROM product_media m
     JOIN products p ON p.id = m.product_id
     WHERE m.id = $1`,
    [mediaId]
  );
  return rows[0] ?? null;
}

type ParsedRange = { start: number; end: number } | "invalid" | null;

/**
 * Разбор Range-заголовка (одиночный диапазон; multi-range → игнорируем,
 * отдавая полный ответ, как разрешает RFC 9110).
 */
function parseRange(header: string | null, size: number): ParsedRange {
  if (!header) return null;
  // неизвестная единица или multi-range → игнорируем Range, отдаём полный ответ
  if (!header.startsWith("bytes=") || header.includes(",")) {
    return null;
  }
  const spec = header.slice("bytes=".length);
  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match) return null;

  const [, startRaw, endRaw] = match;
  if (startRaw === "" && endRaw === "") return null;

  if (startRaw === "") {
    // суффикс "-N" — последние N байт
    const n = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(n) || n <= 0 || size === 0) return "invalid";
    const start = Math.max(0, size - n);
    return { start, end: size - 1 };
  }

  const start = Number.parseInt(startRaw, 10);
  if (!Number.isFinite(start) || start < 0 || start >= size) return "invalid";
  const end =
    endRaw === ""
      ? size - 1
      : Math.min(Number.parseInt(endRaw, 10), size - 1);
  if (!Number.isFinite(end) || start > end) return "invalid";
  return { start, end };
}

async function handleMediaRequest(
  request: NextRequest,
  { params }: RouteParams,
  onlyHead: boolean
): Promise<Response> {
  try {
    const { mediaId } = await params;
    const media = await loadMedia(mediaId);
    if (!media || media.product_deleted_at) {
      return jsonError(404, "NOT_FOUND", "Файл не найден");
    }

    if (media.status !== "approved") {
      const user = await getUserFromRequest(request);
      const allowed =
        user !== null &&
        (user.id === media.owner_id || (await hasModeratorRole(user.id)));
      if (!allowed) {
        // 404 вместо 403 — не раскрываем существование pending/rejected
        return jsonError(404, "NOT_FOUND", "Файл не найден");
      }
    }

    let absPath: string;
    try {
      absPath = absMediaPath(media.storage_path);
    } catch {
      // path traversal в storage_path — целостность БД нарушена
      return jsonError(404, "NOT_FOUND", "Файл не найден");
    }

    let stat: Awaited<ReturnType<typeof fsp.stat>>;
    try {
      stat = await fsp.stat(absPath);
    } catch {
      console.warn(
        `[product-media] DB/filesystem desync: строка ${media.id} есть, файла нет: ${media.storage_path}`
      );
      return jsonError(404, "NOT_FOUND", "Файл не найден");
    }
    if (!stat.isFile()) {
      console.warn(
        `[product-media] storage_path указывает не на файл: ${media.storage_path}`
      );
      return jsonError(404, "NOT_FOUND", "Файл не найден");
    }

    const size = stat.size;
    const etag = `"${media.id}-${size}"`;
    const baseHeaders: Record<string, string> = {
      "Content-Type": media.mime_type,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      ETag: etag,
      "Cache-Control":
        media.status === "approved"
          ? "public, max-age=31536000, immutable"
          : "private, no-store",
    };

    // Conditional GET/HEAD
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch) {
      const candidates = ifNoneMatch
        .split(",")
        .map((s) => s.trim().replace(/^W\//, ""));
      if (candidates.includes(etag) || candidates.includes("*")) {
        return new Response(null, { status: 304, headers: baseHeaders });
      }
    }

    const range = parseRange(request.headers.get("range"), size);
    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
      });
    }

    if (range) {
      const { start, end } = range;
      const headers: Record<string, string> = {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      };
      if (onlyHead) return new Response(null, { status: 206, headers });
      const nodeStream = createReadStream(absPath, { start, end });
      const body = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
      return new Response(body, { status: 206, headers });
    }

    const headers: Record<string, string> = {
      ...baseHeaders,
      "Content-Length": String(size),
    };
    if (onlyHead) return new Response(null, { status: 200, headers });
    const nodeStream = createReadStream(absPath);
    const body = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, { status: 200, headers });
  } catch (error) {
    console.error("[product-media] stream error:", error);
    return jsonError(500, "INTERNAL_ERROR", "Внутренняя ошибка сервера");
  }
}

export async function GET(
  request: NextRequest,
  context: RouteParams
): Promise<Response> {
  return handleMediaRequest(request, context, false);
}

export async function HEAD(
  request: NextRequest,
  context: RouteParams
): Promise<Response> {
  return handleMediaRequest(request, context, true);
}
