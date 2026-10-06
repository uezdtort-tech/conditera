/**
 * PATCH  /api/products/[id]/media/[mediaId] — модерация/обложка (Task 2-b).
 * DELETE /api/products/[id]/media/[mediaId] — удалить медиа.
 *
 * PATCH body: { action: "approve" | "reject" | "set-cover", comment?: string }
 *   - approve: ТОЛЬКО MODERATOR/ADMIN/SUPER_ADMIN (владелец сам себе
 *     одобрить не может). Идемпотентно: уже approved → 200.
 *     После UPDATE — перенос файла pending→published (moveToStage);
 *     если перенос упал → откат статуса к pending (компенсация) + 500.
 *   - reject: comment ОБЯЗАТЕЛЕН (trim 3..500) → иначе 422
 *     MISSING_MODERATION_COMMENT. Файл остаётся в pending/.
 *   - set-cover: owner ИЛИ ADMIN/SUPER_ADMIN; только фото. В одной
 *     транзакции: снять is_cover со всех фото товара, выставить нужному.
 *     Конфликт частичного UNIQUE-индекса → 409.
 *
 * DELETE: owner | MODERATOR | ADMIN | SUPER_ADMIN. В транзакции удаляем
 * строку; если удалили обложку — назначаем обложкой оставшееся фото
 * с минимальным sort_order (status <> 'rejected'). Файл удаляем после
 * коммита, ошибки удаления — console.warn (не 500).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";
import {
  absMediaPath,
  moveToStage,
  removeFileQuiet,
  switchStageInPath,
  MediaStorageError,
} from "@/lib/product-media/storage";
import {
  hasAdminRole,
  hasModeratorRole,
  jsonError,
  resolveProduct,
  withUrl,
  UUID_RE,
  IdRow,
  type MediaRow,
  type ProductRef,
} from "@/lib/product-media/http";
import { recordEvent } from "@/lib/ops/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string; mediaId: string }>;
}

interface PatchBody {
  action?: unknown;
  comment?: unknown;
}

/**
 * Резолв медиа, принадлежащего данному товару. null → 404.
 */
async function resolveMedia(
  productId: string,
  mediaId: string
): Promise<MediaRow | null> {
  if (!UUID_RE.test(mediaId)) return null;
  const pool = getPool();
  const { rows } = await pool.query<MediaRow>(
    `SELECT * FROM product_media WHERE id = $1 AND product_id = $2`,
    [mediaId, productId]
  );
  return rows[0] ?? null;
}

interface DeletedMediaRow {
  [key: string]: unknown;
  storage_path: string;
  media_type: "photo" | "video";
  is_cover: boolean;
}

/**
 * PATCH — approve / reject / set-cover.
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id, mediaId } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return jsonError(401, "UNAUTHORIZED", "Необходима аутентификация");
    }
    const product: ProductRef | null = await resolveProduct(id);
    if (!product || product.deleted_at) {
      return jsonError(404, "NOT_FOUND", "Товар не найден");
    }
    const media = await resolveMedia(product.id, mediaId);
    if (!media) {
      return jsonError(404, "NOT_FOUND", "Медиа не найдено");
    }

    let body: PatchBody;
    try {
      body = (await request.json()) as PatchBody;
    } catch {
      return jsonError(422, "VALIDATION_FAILED", "Ожидается JSON-тело");
    }

    const pool = getPool();

    if (body.action === "approve" || body.action === "reject") {
      // Владелец НЕ может сам-одобрить/сам-отклонить
      if (!(await hasModeratorRole(user.id))) {
        return jsonError(
          403,
          "FORBIDDEN",
          "Модерация доступна только MODERATOR/ADMIN/SUPER_ADMIN"
        );
      }

      if (body.action === "approve") {
        // Идемпотентность
        if (media.status === "approved") {
          return NextResponse.json(withUrl(media));
        }

        const { rows } = await pool.query<MediaRow>(
          `UPDATE product_media
           SET status = 'approved', moderated_by = $3, moderated_at = now(), moderation_comment = NULL
           WHERE id = $1 AND product_id = $2 RETURNING *`,
          [media.id, product.id, user.id]
        );
        const approved = rows[0];
        if (!approved) {
          return jsonError(404, "NOT_FOUND", "Медиа не найдено");
        }

        // ops: event log (append-only, fail-safe)
        void recordEvent("media.approved", {
          entityType: "product_media",
          entityId: approved.id,
          actorId: user.id,
          payload: { productId: product.id },
        });

        // pending → published; при падении — откат статуса (компенсация)
        const toRel = switchStageInPath(approved.storage_path, "published");
        if (toRel && toRel !== approved.storage_path) {
          try {
            await moveToStage(approved.storage_path, toRel);
            const moved = await pool.query<MediaRow>(
              `UPDATE product_media SET storage_path = $2 WHERE id = $1 RETURNING *`,
              [approved.id, toRel]
            );
            return NextResponse.json(withUrl(moved.rows[0] ?? approved));
          } catch (moveErr) {
            console.error(
              "[products/[id]/media/[mediaId]] moveToStage failed, rollback status:",
              moveErr instanceof Error ? moveErr.message : moveErr
            );
            await pool.query(
              `UPDATE product_media
               SET status = 'pending', moderated_by = NULL, moderated_at = NULL, moderation_comment = NULL
               WHERE id = $1`,
              [approved.id]
            );
            return jsonError(
              500,
              "INTERNAL_ERROR",
              "Не удалось перенести файл в published"
            );
          }
        }
        return NextResponse.json(withUrl(approved));
      }

      // reject
      const comment =
        typeof body.comment === "string" ? body.comment.trim() : "";
      if (comment.length < 3 || comment.length > 500) {
        return jsonError(
          422,
          "MISSING_MODERATION_COMMENT",
          "Комментарий модерации обязателен (3–500 символов)"
        );
      }
      const { rows } = await pool.query<MediaRow>(
        `UPDATE product_media
         SET status = 'rejected', moderated_by = $3, moderated_at = now(), moderation_comment = $4
         WHERE id = $1 AND product_id = $2 RETURNING *`,
        [media.id, product.id, user.id, comment]
      );
      const rejected = rows[0];
      if (!rejected) {
        return jsonError(404, "NOT_FOUND", "Медиа не найдено");
      }

      // ops: event log (append-only, fail-safe)
      void recordEvent("media.rejected", {
        entityType: "product_media",
        entityId: rejected.id,
        actorId: user.id,
        payload: { productId: product.id, comment },
      });

      // Файл остаётся в pending/ — не удаляем
      return NextResponse.json(withUrl(rejected));
    }

    if (body.action === "set-cover") {
      // Модератор обложку назначать не может — только владелец или админ
      const isOwner = user.id === product.confectioner_id;
      if (!isOwner && !(await hasAdminRole(user.id))) {
        return jsonError(
          403,
          "FORBIDDEN",
          "Обложка доступна владельцу товара или ADMIN/SUPER_ADMIN"
        );
      }
      if (media.media_type !== "photo") {
        return jsonError(
          422,
          "VALIDATION_FAILED",
          "Обложкой может быть только фото"
        );
      }
      if (media.status === "rejected") {
        return jsonError(
          422,
          "VALIDATION_FAILED",
          "Отклонённое фото не может стать обложкой"
        );
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE product_media SET is_cover = false
           WHERE product_id = $1 AND media_type = 'photo' AND is_cover = true`,
          [product.id]
        );
        await client.query(
          `UPDATE product_media SET is_cover = true WHERE id = $1 AND product_id = $2`,
          [media.id, product.id]
        );
        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK").catch(() => {});
        const err = txErr as { code?: string };
        if (err?.code === "23505") {
          return jsonError(
            409,
            "COVER_CONFLICT",
            "Конфликт назначения обложки, повторите запрос"
          );
        }
        console.error(
          "[products/[id]/media/[mediaId]] set-cover tx error:",
          txErr instanceof Error ? txErr.message : txErr
        );
        return jsonError(500, "INTERNAL_ERROR", "Не удалось назначить обложку");
      } finally {
        client.release();
      }

      const fresh = await resolveMedia(product.id, media.id);
      if (!fresh) {
        return jsonError(404, "NOT_FOUND", "Медиа не найдено");
      }
      return NextResponse.json(withUrl(fresh));
    }

    return jsonError(
      422,
      "VALIDATION_FAILED",
      'action должен быть "approve", "reject" или "set-cover"'
    );
  } catch (error) {
    console.error("[products/[id]/media/[mediaId]] PATCH error:", error);
    return jsonError(500, "INTERNAL_ERROR", "Внутренняя ошибка сервера");
  }
}

/**
 * DELETE — удалить медиа (строку + файл).
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id, mediaId } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return jsonError(401, "UNAUTHORIZED", "Необходима аутентификация");
    }
    const product: ProductRef | null = await resolveProduct(id);
    if (!product || product.deleted_at) {
      return jsonError(404, "NOT_FOUND", "Товар не найден");
    }
    const media = await resolveMedia(product.id, mediaId);
    if (!media) {
      return jsonError(404, "NOT_FOUND", "Медиа не найдено");
    }

    const isOwner = user.id === product.confectioner_id;
    if (!isOwner && !(await hasModeratorRole(user.id))) {
      return jsonError(
        403,
        "FORBIDDEN",
        "Удаление доступно владельцу товара или модератору"
      );
    }

    const pool = getPool();
    const client = await pool.connect();
    let deleted: DeletedMediaRow | null = null;
    try {
      await client.query("BEGIN");
      const del = await client.query<DeletedMediaRow>(
        `DELETE FROM product_media
         WHERE id = $1 AND product_id = $2
         RETURNING storage_path, media_type, is_cover`,
        [media.id, product.id]
      );
      if (del.rowCount === 0) {
        await client.query("ROLLBACK").catch(() => {});
        return jsonError(404, "NOT_FOUND", "Медиа не найдено");
      }
      deleted = del.rows[0];

      // Если удалили обложку — назначаем обложкой оставшееся фото
      // (не rejected) с минимальным sort_order.
      if (deleted.media_type === "photo" && deleted.is_cover) {
        const next = await client.query<IdRow>(
          `SELECT id FROM product_media
           WHERE product_id = $1 AND media_type = 'photo' AND status <> 'rejected'
           ORDER BY sort_order ASC LIMIT 1`,
          [product.id]
        );
        if (next.rows[0]) {
          await client.query(
            `UPDATE product_media SET is_cover = true WHERE id = $1`,
            [next.rows[0].id]
          );
        }
      }

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(
        "[products/[id]/media/[mediaId]] DELETE tx error:",
        txErr instanceof Error ? txErr.message : txErr
      );
      return jsonError(500, "INTERNAL_ERROR", "Не удалось удалить медиа");
    } finally {
      client.release();
    }

    // Файл — после коммита. Рассинхрон файловой системы не роняет ответ.
    if (deleted) {
      try {
        const abs = absMediaPath(deleted.storage_path);
        const removed = await removeFileQuiet(abs);
        if (!removed) {
          console.warn(
            `[products/[id]/media/[mediaId]] файл уже отсутствовал на диске: ${deleted.storage_path}`
          );
        }
      } catch (fileErr) {
        if (fileErr instanceof MediaStorageError) {
          console.warn(
            `[products/[id]/media/[mediaId]] подозрительный storage_path при удалении: ${deleted.storage_path}`
          );
        } else {
          console.warn(
            "[products/[id]/media/[mediaId]] удаление файла не удалось:",
            fileErr instanceof Error ? fileErr.message : fileErr
          );
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[products/[id]/media/[mediaId]] DELETE error:", error);
    return jsonError(500, "INTERNAL_ERROR", "Внутренняя ошибка сервера");
  }
}
