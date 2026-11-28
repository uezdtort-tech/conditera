import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; disputeId: string }> },
): Promise<NextResponse> {
  let client: PoolClient | null = null;
  const uploadedMedia: Array<{ id: string; contentSha256: string }> = [];
  let transactionStarted = false;
  try {
    const { id: orderId, disputeId } = await params;
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, user_id")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
    if (order.user_id !== user.id) {
      return NextResponse.json({ error: "ONLY_ORDER_OWNER_CAN_REPLY" }, { status: 403 });
    }

    const form = await request.formData();
    const message = String(form.get("message") || "").trim();
    const files = form.getAll("evidence").filter((item): item is File => item instanceof File);
    if (message.length < 10 || message.length > 5000) {
      return NextResponse.json({ error: "MESSAGE_LENGTH_MUST_BE_10_TO_5000" }, { status: 422 });
    }
    if (files.length > 5 || files.some((file) => file.size <= 0 || file.size > MAX_PHOTO_BYTES)) {
      return NextResponse.json({ error: "INVALID_EVIDENCE_FILES_MAX_5" }, { status: 422 });
    }

    client = await getPool().connect();
    await client.query("BEGIN");
    transactionStarted = true;
    const selected = await client.query(
      `SELECT id, status FROM public.order_disputes
       WHERE id = $1::uuid AND order_id = $2::uuid FOR UPDATE`,
      [disputeId, orderId],
    );
    const dispute = selected.rows[0];
    if (!dispute) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return NextResponse.json({ error: "DISPUTE_NOT_FOUND" }, { status: 404 });
    }
    if (dispute.status !== "awaiting_customer") {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return NextResponse.json({ error: "DISPUTE_NOT_AWAITING_CUSTOMER", status: dispute.status }, { status: 409 });
    }

    for (const file of files) {
      const media = await saveOrderReadyPhoto({
        orderId,
        file,
        uploadedBy: user.id,
        kind: "dispute_evidence",
      });
      uploadedMedia.push({ id: media.id, contentSha256: media.contentSha256 });
    }

    const insertedMessage = await client.query(
      `INSERT INTO public.order_dispute_messages (dispute_id, sender_id, message)
       VALUES ($1::uuid, $2::uuid, $3)
       RETURNING id, dispute_id, sender_id, message, created_at`,
      [disputeId, user.id, message],
    );
    for (const media of uploadedMedia) {
      await client.query(
        `INSERT INTO public.order_dispute_evidence
          (dispute_id, order_media_id, uploaded_by, content_sha256, note)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)`,
        [disputeId, media.id, user.id, media.contentSha256, message.slice(0, 1000)],
      );
    }

    await client.query(
      `UPDATE public.order_disputes
       SET status = 'under_review', resolution = NULL, updated_at = now(), closed_at = NULL
       WHERE id = $1::uuid`,
      [disputeId],
    );
    await client.query(
      `INSERT INTO public.order_dispute_events
        (dispute_id, actor_id, event_type, from_status, to_status, details)
       VALUES ($1::uuid, $2::uuid, 'dispute.customer_replied', 'awaiting_customer', 'under_review',
         jsonb_build_object('message_id', $3::text, 'evidence_count', $4::integer))`,
      [disputeId, user.id, insertedMessage.rows[0].id, uploadedMedia.length],
    );
    await client.query("COMMIT");
    transactionStarted = false;

    return NextResponse.json({
      message: insertedMessage.rows[0],
      evidenceCount: uploadedMedia.length,
      status: "under_review",
    }, { status: 201 });
  } catch (error) {
    if (transactionStarted && client) await client.query("ROLLBACK").catch(() => {});
    for (const media of uploadedMedia) {
      await deleteOrderMedia(media.id).catch((cleanupError) =>
        console.error("[orders/disputes/reply] evidence cleanup failed:", (cleanupError as Error).message),
      );
    }
    if (error instanceof MediaValidationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof MediaStorageError) {
      return NextResponse.json({ error: "EVIDENCE_STORAGE_FAILED" }, { status: 500 });
    }
    console.error("[orders/disputes/reply] POST failed:", (error as Error).message);
    return NextResponse.json({ error: "DISPUTE_REPLY_FAILED" }, { status: 500 });
  } finally {
    client?.release();
  }
}
