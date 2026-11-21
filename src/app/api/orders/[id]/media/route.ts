/**
 * POST /api/orders/[id]/media — загрузка фото готовности (ТЗ §35).
 *
 * Переиспользует product-media инфраструктуру (storage/validation libs).
 * Реальный MIME по magic bytes; UUID-имя; лимиты размера; метаданные в БД.
 * После загрузки ready_photo отмечается этап чеклиста (для гейта READY).
 *
 * Права: назначенный кондитер или ADMIN/SUPER_ADMIN.
 * Лимит: не более 5 фото готовности на заказ.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";
import { loadOrderLite, canOperateOrder } from "@/lib/ops/order-access";
import {
  saveOrderReadyPhoto,
  MediaValidationError,
  MediaStorageError,
  countApprovedReadyPhotos,
} from "@/lib/ops/order-media";
import { setStageDone } from "@/lib/ops/production";
import { recordEvent } from "@/lib/ops/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_READY_PHOTOS = 5;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
        { status: 401 }
      );
    }

    const order = await loadOrderLite(id);
    if (!order) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Заказ не найден" },
        { status: 404 }
      );
    }
    if (!(await canOperateOrder(order, user.id))) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "Нет доступа к производственному контуру заказа" },
        { status: 403 }
      );
    }

    // Лимит количества
    const existing = await countApprovedReadyPhotos(id);
    if (existing >= MAX_READY_PHOTOS) {
      return NextResponse.json(
        { error: "PHOTO_LIMIT_REACHED", message: `Максимум ${MAX_READY_PHOTOS} фото готовности на заказ` },
        { status: 422 }
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Ожидается multipart/form-data" },
        { status: 400 }
      );
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "NO_FILE", message: "Не передан файл (поле 'file')" },
        { status: 400 }
      );
    }

    const kind = form.get("kind") === "handoff_photo" ? "handoff_photo" : "ready_photo";

    let media;
    try {
      media = await saveOrderReadyPhoto({
        orderId: id,
        file,
        uploadedBy: user.id,
        kind,
      });
    } catch (err) {
      if (err instanceof MediaValidationError) {
        return NextResponse.json(
          { error: err.code, message: err.message },
          { status: err.status }
        );
      }
      if (err instanceof MediaStorageError) {
        return NextResponse.json(
          { error: "STORAGE_ERROR", message: err.message },
          { status: 500 }
        );
      }
      throw err;
    }

    // Этап чеклиста «Фото готовности» — выполнен
    if (kind === "ready_photo") {
      await setStageDone(id, "ready_photo", true, user.id);
    }

    await recordEvent("media.uploaded", {
      entityType: "order",
      entityId: id,
      actorId: user.id,
      payload: { orderNumber: order.number, kind, mediaId: media.id },
    });

    return NextResponse.json(
      {
        media: {
          id: media.id,
          orderId: media.orderId,
          kind: media.kind,
          mimeType: media.mimeType,
          fileSize: media.fileSize,
          width: media.width,
          height: media.height,
          url: `/api/order-media/${media.id}`,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error(
      "[orders/media] POST failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/** GET — список фото заказа (для workspace). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
        { status: 401 }
      );
    }

    const order = await loadOrderLite(id);
    if (!order) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Заказ не найден" },
        { status: 404 }
      );
    }
    // Фото готового изделия — часть заказа и доказательство исполнения:
    // владелец-покупатель должен иметь возможность просматривать их.
    // SUPPORT/COURIER не получают доступ только по наличию глобальной роли.
    if (order.user_id !== user.id && !(await canOperateOrder(order, user.id))) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "Нет доступа" },
        { status: 403 }
      );
    }

    const pool = getPool();
    const [orderMedia, referenceMedia] = await Promise.all([
      pool.query<{
        id: string;
        kind: string;
        mime_type: string;
        file_size: number;
        width: number | null;
        height: number | null;
        uploaded_at: Date;
      }>(
        `SELECT id::text, kind, mime_type, file_size, width, height, uploaded_at
         FROM public.order_media
         WHERE order_id = $1::uuid AND status = 'approved'
         ORDER BY uploaded_at ASC`,
        [id]
      ),
      // Исходные пожелания и превью конструктора остаются в приватном
      // quote_media bucket. После принятия предложения включаем их в медиа
      // заказа через source_quote_id, не копируя файлы и не меняя владельца.
      pool.query<{
        id: string;
        quote_request_id: string;
        kind: string;
        mime_type: string;
        file_size: number;
        width: number | null;
        height: number | null;
        uploaded_at: Date;
      }>(
        `SELECT qrm.id::text, qr.id::text AS quote_request_id, qrm.kind,
                qrm.mime_type, qrm.file_size, qrm.width, qrm.height, qrm.uploaded_at
         FROM public.orders AS o
         JOIN public.confectioner_quotes AS cq ON cq.id = o.source_quote_id
         JOIN public.quote_requests AS qr ON qr.id = cq.quote_request_id
         JOIN public.quote_request_media AS qrm ON qrm.quote_request_id = qr.id
         WHERE o.id = $1::uuid AND qrm.status = 'approved'
         ORDER BY qrm.uploaded_at ASC`,
        [id]
      ),
    ]);

    const orderFiles = orderMedia.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      source: "order",
      mimeType: r.mime_type,
      fileSize: Number(r.file_size),
      width: r.width,
      height: r.height,
      uploadedAt: new Date(r.uploaded_at).toISOString(),
      url: `/api/order-media/${r.id}`,
    }));
    const customerReferences = referenceMedia.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      source: "customer_reference",
      mimeType: r.mime_type,
      fileSize: Number(r.file_size),
      width: r.width,
      height: r.height,
      uploadedAt: new Date(r.uploaded_at).toISOString(),
      url: `/api/quotes/${r.quote_request_id}/media/${r.id}`,
    }));

    return NextResponse.json({ media: [...customerReferences, ...orderFiles] });
  } catch (err) {
    console.error(
      "[orders/media] GET failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
