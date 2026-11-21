import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPool } from "@/lib/postgrest/pool";
import {
  deleteOrderMedia,
  MAX_PHOTO_BYTES,
  MediaStorageError,
  MediaValidationError,
  saveOrderReadyPhoto,
} from "@/lib/ops/order-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CUSTOMER_CATEGORIES = new Set(["quality", "damage", "wrong_item", "missing_item", "other"]);
const STAFF_ROLES = ["ADMIN", "SUPER_ADMIN", "SUPPORT"];

async function loadOrder(orderId: string) {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, number, user_id, confectioner_id, status")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function canReview(roles: string[]) {
  return roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id: orderId } = await params;
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const order = await loadOrder(orderId);
    if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });

    const pool = getPool();
    const result = await pool.query(
      `SELECT d.id, d.order_id, d.opened_by, d.assigned_to, d.category,
              d.description, d.status, d.resolution, d.created_at, d.updated_at, d.closed_at
       FROM public.order_disputes d
       WHERE d.order_id = $1::uuid
       ORDER BY d.created_at DESC LIMIT 1`,
      [orderId],
    );
    const dispute = result.rows[0];
    if (!dispute) return NextResponse.json({ dispute: null });

    const isParty = order.user_id === user.id || order.confectioner_id === user.id;
    const isAdmin = canReview(user.roles);
    const isAssignedSupport = user.roles.includes("SUPPORT") && dispute.assigned_to === user.id;
    if (!isParty && !isAdmin && !isAssignedSupport) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const [evidence, events] = await Promise.all([
      pool.query(
        `SELECT e.id, e.order_media_id, e.uploaded_by, e.note, e.created_at,
                m.kind, m.mime_type, m.file_size, m.width, m.height,
                '/api/order-media/' || m.id::text AS url
         FROM public.order_dispute_evidence e
         JOIN public.order_media m ON m.id = e.order_media_id
         WHERE e.dispute_id = $1::uuid
         ORDER BY e.created_at ASC`,
        [dispute.id],
      ),
      pool.query(
        `SELECT id, actor_id, event_type, from_status, to_status, details, created_at
         FROM public.order_dispute_events
         WHERE dispute_id = $1::uuid
         ORDER BY created_at ASC`,
        [dispute.id],
      ),
    ]);

    return NextResponse.json({ dispute: { ...dispute, evidence: evidence.rows, events: events.rows } });
  } catch (error) {
    console.error("[orders/disputes] GET failed:", (error as Error).message);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}

/** Покупатель открывает спор по дефекту; исходные файлы попадают в приватный order_media. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const uploadedMedia: Array<{ id: string }> = [];
  try {
    const { id: orderId } = await params;
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const order = await loadOrder(orderId);
    if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
    if (order.user_id !== user.id) {
      return NextResponse.json({ error: "ONLY_ORDER_OWNER_CAN_OPEN_DISPUTE" }, { status: 403 });
    }
    if (!["DELIVERED", "COMPLETED"].includes(String(order.status).toUpperCase())) {
      return NextResponse.json({ error: "ORDER_NOT_HANDED_OFF" }, { status: 409 });
    }

    const form = await request.formData();
    const category = String(form.get("category") || "other");
    const description = String(form.get("description") || "").trim();
    const files = form.getAll("evidence").filter((item): item is File => item instanceof File);
    if (!CUSTOMER_CATEGORIES.has(category)) {
      return NextResponse.json({ error: "INVALID_DISPUTE_CATEGORY" }, { status: 400 });
    }
    if (description.length < 20 || description.length > 5000) {
      return NextResponse.json({ error: "DESCRIPTION_LENGTH_MUST_BE_20_TO_5000" }, { status: 422 });
    }
    if (files.length < 1 || files.length > 5) {
      return NextResponse.json({ error: "EVIDENCE_REQUIRED_MAX_5_FILES" }, { status: 422 });
    }
    if (files.some((file) => file.size <= 0 || file.size > MAX_PHOTO_BYTES)) {
      return NextResponse.json({ error: "INVALID_EVIDENCE_FILE_SIZE" }, { status: 422 });
    }

    // Сохраняем оригиналы в приватном bucket; никакие публичные URL от клиента не принимаются.
    for (const file of files) {
      const media = await saveOrderReadyPhoto({
        orderId,
        file,
        uploadedBy: user.id,
        kind: "dispute_evidence",
      });
      uploadedMedia.push({ id: media.id });
    }

    const pool = getPool();
    const client = await pool.connect();
    let dispute: Record<string, unknown>;
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO public.order_disputes (order_id, opened_by, category, description)
         VALUES ($1::uuid, $2::uuid, $3, $4)
         RETURNING id, order_id, opened_by, category, description, status, created_at`,
        [orderId, user.id, category, description],
      );
      dispute = inserted.rows[0];
      for (const media of uploadedMedia) {
        await client.query(
          `INSERT INTO public.order_dispute_evidence (dispute_id, order_media_id, uploaded_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid)`,
          [dispute.id, media.id, user.id],
        );
      }
      await client.query(
        `INSERT INTO public.order_dispute_events
          (dispute_id, actor_id, event_type, to_status, details)
         VALUES ($1::uuid, $2::uuid, 'dispute.opened', 'open',
           jsonb_build_object('category', $3, 'evidence_count', $4))`,
        [dispute.id, user.id, category, uploadedMedia.length],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return NextResponse.json({ dispute, evidenceCount: uploadedMedia.length }, { status: 201 });
  } catch (error) {
    // Компенсация только для объектов, которые ещё не закреплены в реестре спора.
    for (const media of uploadedMedia) {
      await deleteOrderMedia(media.id).catch((cleanupError) =>
        console.error("[orders/disputes] evidence cleanup failed:", (cleanupError as Error).message),
      );
    }
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json({ error: "ACTIVE_DISPUTE_ALREADY_EXISTS" }, { status: 409 });
    }
    if (error instanceof MediaValidationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof MediaStorageError) {
      return NextResponse.json({ error: "EVIDENCE_STORAGE_FAILED" }, { status: 500 });
    }
    console.error("[orders/disputes] POST failed:", (error as Error).message);
    return NextResponse.json({ error: "DISPUTE_CREATION_FAILED" }, { status: 500 });
  }
}

/** Решение спора: доступно только администратору или назначенному сотруднику поддержки. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const client = await getPool().connect();
  try {
    const { id: orderId } = await params;
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    if (!user.roles.some((role) => STAFF_ROLES.includes(role))) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await request.json();
    const disputeId = typeof body.disputeId === "string" ? body.disputeId : "";
    const nextStatus = typeof body.status === "string" ? body.status : "";
    const resolution = typeof body.resolution === "string" ? body.resolution.trim() : "";
    const allowed = new Set(["under_review", "awaiting_customer", "resolved", "rejected"]);
    if (!disputeId || !allowed.has(nextStatus)) {
      return NextResponse.json({ error: "INVALID_DISPUTE_TRANSITION" }, { status: 400 });
    }
    if (["resolved", "rejected"].includes(nextStatus) && resolution.length < 10) {
      return NextResponse.json({ error: "RESOLUTION_REQUIRED" }, { status: 422 });
    }

    await client.query("BEGIN");
    const selected = await client.query(
      `SELECT id, status, assigned_to FROM public.order_disputes
       WHERE id = $1::uuid AND order_id = $2::uuid FOR UPDATE`,
      [disputeId, orderId],
    );
    const current = selected.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "DISPUTE_NOT_FOUND" }, { status: 404 });
    }
    const isAdmin = canReview(user.roles);
    if (!isAdmin && current.assigned_to !== user.id) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "DISPUTE_NOT_ASSIGNED_TO_YOU" }, { status: 403 });
    }
    const transitions: Record<string, string[]> = {
      open: ["under_review"],
      under_review: ["awaiting_customer", "resolved", "rejected"],
      awaiting_customer: ["under_review", "resolved", "rejected"],
    };
    const currentStatus = String(current.status);
    if (!transitions[currentStatus]?.includes(nextStatus)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "INVALID_DISPUTE_TRANSITION", currentStatus }, { status: 409 });
    }

    const updated = await client.query(
      `UPDATE public.order_disputes
       SET status = $2, resolution = CASE WHEN $3 = '' THEN resolution ELSE $3 END,
           updated_at = now(),
           closed_at = CASE WHEN $2 IN ('resolved', 'rejected') THEN now() ELSE NULL END
       WHERE id = $1::uuid
       RETURNING id, order_id, status, resolution, updated_at, closed_at`,
      [disputeId, nextStatus, resolution],
    );
    await client.query(
      `INSERT INTO public.order_dispute_events
        (dispute_id, actor_id, event_type, from_status, to_status, details)
       VALUES ($1::uuid, $2::uuid, 'dispute.status_changed', $3, $4,
         jsonb_build_object('resolution', NULLIF($5, '')))`,
      [disputeId, user.id, current.status, nextStatus, resolution],
    );
    await client.query("COMMIT");
    return NextResponse.json({ dispute: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[orders/disputes] PATCH failed:", (error as Error).message);
    return NextResponse.json({ error: "DISPUTE_UPDATE_FAILED" }, { status: 500 });
  } finally {
    client.release();
  }
}
