/**
 * POST /api/products/[id]/media/reorder — пересортировка медиа (Task 2-b).
 *
 * Body: { photos?: string[], videos?: string[] } — ПОЛНЫЕ упорядоченные
 * списки ID (uuid). Каждый id из массива обязан принадлежать данному
 * товару и соответствующему media_type — иначе 422 (транзакция откатывается).
 *
 * sort_order = (idx + 1) * 10 — устойчивые зазоры для будущих вставок.
 *
 * Права: owner (confectioner_id) ИЛИ ADMIN/SUPER_ADMIN
 * (MODERATOR порядок не меняет).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";
import {
  hasAdminRole,
  jsonError,
  resolveProduct,
  UUID_RE,
  type ProductRef,
} from "@/lib/product-media/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface ReorderBody {
  photos?: unknown;
  videos?: unknown;
}

/** Строго string[] из валидных uuid; undefined → [] (поле опционально). */
function parseIdList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !UUID_RE.test(item)) return null;
    ids.push(item);
  }
  return ids;
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
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
    if (!isOwner && !(await hasAdminRole(user.id))) {
      return jsonError(
        403,
        "FORBIDDEN",
        "Сортировка доступна владельцу товара или ADMIN/SUPER_ADMIN"
      );
    }

    let body: ReorderBody;
    try {
      body = (await request.json()) as ReorderBody;
    } catch {
      return jsonError(422, "VALIDATION_FAILED", "Ожидается JSON-тело");
    }

    const photos = parseIdList(body.photos);
    const videos = parseIdList(body.videos);
    if (photos === null || videos === null) {
      return jsonError(
        422,
        "VALIDATION_FAILED",
        "photos/videos должны быть массивами uuid-строк"
      );
    }
    if (photos.length === 0 && videos.length === 0) {
      return jsonError(
        422,
        "VALIDATION_FAILED",
        "Передайте непустой список photos и/или videos"
      );
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const applyOrder = async (
        ids: string[],
        mediaType: "photo" | "video"
      ): Promise<number> => {
        let applied = 0;
        for (let idx = 0; idx < ids.length; idx += 1) {
          const updated = await client.query<{ id: string }>(
            `UPDATE product_media SET sort_order = $1
             WHERE id = $2 AND product_id = $3 AND media_type = $4
             RETURNING id`,
            [(idx + 1) * 10, ids[idx], product.id, mediaType]
          );
          if (updated.rowCount === 0) {
            // Чужой/несуществующий id в списке — откатываем всё
            throw new ReorderViolation(
              `Медиа ${ids[idx]} не принадлежит товару (${mediaType})`
            );
          }
          applied += 1;
        }
        return applied;
      };

      let photosCount = 0;
      let videosCount = 0;
      try {
        photosCount = await applyOrder(photos, "photo");
        videosCount = await applyOrder(videos, "video");
        await client.query("COMMIT");
      } catch (inner) {
        await client.query("ROLLBACK").catch(() => {});
        if (inner instanceof ReorderViolation) {
          return jsonError(422, "VALIDATION_FAILED", inner.message);
        }
        throw inner;
      }

      return NextResponse.json({
        ok: true,
        photos: photosCount,
        videos: videosCount,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[products/[id]/media/reorder] POST error:", error);
    return jsonError(500, "INTERNAL_ERROR", "Внутренняя ошибка сервера");
  }
}

/** Сигнальная ошибка нарушения принадлежности медиа товару. */
class ReorderViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReorderViolation";
  }
}
