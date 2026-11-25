/**
 * GET/HEAD /api/order-media/[mediaId] — раздача фото из приватного Supabase Storage.
 * Доступ: владелец заказа, назначенный кондитер, staff; курьер — только по назначению.
 * Ни локальная файловая система, ни произвольные storage paths не используются.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";
import { getOrderMedia, downloadOrderMedia, type OrderMediaRow } from "@/lib/ops/order-media";
import { handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AuthorizedMedia = {
  media: OrderMediaRow;
  buffer: Buffer;
  etag: string;
};

async function loadAuthorizedMedia(
  request: NextRequest,
  mediaId: string
): Promise<AuthorizedMedia | NextResponse> {
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

  const media = await getOrderMedia(mediaId);
  if (!media) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const pool = getPool();
  const { rows: orderRows } = await pool.query<{
    user_id: string;
    confectioner_id: string | null;
  }>(
    `SELECT user_id::text, confectioner_id::text
       FROM public.orders
      WHERE id = $1::uuid
      LIMIT 1`,
    [media.orderId]
  );
  const order = orderRows[0];
  if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const roles = user.roles ?? [];
  const isParty =
    user.id === order.user_id ||
    (order.confectioner_id !== null && user.id === order.confectioner_id);
  const isStaff = roles.some((role) => ["ADMIN", "SUPER_ADMIN", "SUPPORT"].includes(role));

  if (!isParty && !isStaff) {
    if (!roles.includes("COURIER")) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    const { rows: assignments } = await pool.query<{ id: string }>(
      `SELECT id::text
         FROM public.deliveries
        WHERE order_id = $1::uuid
          AND courier_id = $2::uuid
          AND status IN ('assigned', 'picked_up', 'on_the_way', 'delivered')
        LIMIT 1`,
      [media.orderId, user.id]
    );
    if (!assignments.length) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
  }

  const buffer = await downloadOrderMedia(media.storagePath);
  const etagValue = media.contentSha256 || `${media.id}-${buffer.length}`;
  return { media, buffer, etag: `"${etagValue}"` };
}

async function respond(
  request: NextRequest,
  params: Promise<{ mediaId: string }>,
  headOnly: boolean
): Promise<Response> {
  try {
    const { mediaId } = await params;
    const result = await loadAuthorizedMedia(request, mediaId);
    if (result instanceof Response) return result;

    const headers = new Headers({
      "Content-Type": result.media.mimeType,
      "Content-Length": String(result.buffer.length),
      "X-Content-Type-Options": "nosniff",
      ETag: result.etag,
      "Cache-Control": "private, max-age=86400",
    });
    if (request.headers.get("if-none-match")?.split(",").map((value) => value.trim()).includes(result.etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(headOnly ? null : new Uint8Array(result.buffer), { status: 200, headers });
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/order-media/[mediaId]",
      component: "orders",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> }
): Promise<Response> {
  return respond(request, params, false);
}

export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> }
): Promise<Response> {
  return respond(request, params, true);
}
