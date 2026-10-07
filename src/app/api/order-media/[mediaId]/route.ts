/**
 * GET /api/order-media/[mediaId] — раздача фото готовности (P0.5 §35).
 *
 * Доступ ТОЛЬКО аутентифицированный и связанный с заказом:
 *   владелец-клиент / назначенный кондитер / ADMIN, SUPER_ADMIN, SUPPORT, COURIER.
 * Остальным — 404 (не раскрываем существование).
 *
 * Head-запросы → без тела; ETag + private cache; Content-Type из БД
 * (доверяем своему снифферу, записанному при загрузке).
 */

import { createReadStream, promises as fsp } from "fs";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";
import { hasAnyRole } from "@/lib/role-guards";
import { safeAbsOrderMediaPath } from "@/lib/ops/order-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MediaRow = {
  [key: string]: unknown;
  id: string;
  order_id: string;
  kind: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  status: string;
  customer_id: string;
  confectioner_id: string | null;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> }
): Promise<Response> {
  try {
    const { mediaId } = await params;
    if (!UUID_RE.test(mediaId)) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
        { status: 401 }
      );
    }

    const pool = getPool();
    const { rows } = await pool.query<MediaRow>(
      `SELECT m.id, m.order_id, m.kind, m.storage_path, m.mime_type,
              m.file_size, m.status,
              o.user_id::text AS customer_id, o.confectioner_id::text AS confectioner_id
       FROM public.order_media m
       JOIN public.orders o ON o.id = m.order_id
       WHERE m.id = $1::uuid AND m.status = 'approved'`,
      [mediaId]
    );
    const media = rows[0];
    if (!media) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    // Доступ: клиент-владелец, кондитер, стафф
    const isParty =
      user.id === media.customer_id || (media.confectioner_id !== null && user.id === media.confectioner_id);
    if (!isParty) {
      const staff = await hasAnyRole(user.id, ["ADMIN", "SUPER_ADMIN", "SUPPORT", "COURIER"]);
      if (!staff) {
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      }
    }

    let absPath: string;
    try {
      absPath = safeAbsOrderMediaPath(media.storage_path);
    } catch {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    let stat: Awaited<ReturnType<typeof fsp.stat>>;
    try {
      stat = await fsp.stat(absPath);
    } catch {
      console.warn(
        `[order-media] DB/filesystem desync: строка ${media.id} есть, файла нет: ${media.storage_path}`
      );
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    if (!stat.isFile()) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const etag = `"${media.id}-${stat.size}"`;
    const headers: Record<string, string> = {
      "Content-Type": media.mime_type,
      "Content-Length": String(stat.size),
      "X-Content-Type-Options": "nosniff",
      ETag: etag,
      "Cache-Control": "private, max-age=86400",
    };

    if (request.headers.get("if-none-match")?.includes(etag)) {
      return new Response(null, { status: 304, headers });
    }

    const nodeStream = createReadStream(absPath);
    const body = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, { status: 200, headers });
  } catch (err) {
    console.error(
      "[order-media] GET failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
