/**
 * POST /api/webhooks/n8n — приём вебхуков от n8n-воркфлоу.
 *
 * Auth: заголовок X-N8N-Secret (env: N8N_WEBHOOK_SECRET).
 * Body: { event: string, data: any }
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const expected = process.env.N8N_WEBHOOK_SECRET;
    if (!expected) {
      return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
    }

    const got = request.headers.get("X-N8N-Secret");
    if (!got || got !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { event, data } = body ?? {};

    if (!event || typeof event !== "string") {
      return NextResponse.json({ error: "Укажите event (string)" }, { status: 400 });
    }

    // Log webhook in audit_log (non-blocking)
    try {
      await supabaseAdmin.from("audit_log").insert({
        action: `n8n:${event}`,
        entity_type: "webhook",
        entity_id: event,
        metadata: { event, data, received_at: new Date().toISOString() },
        created_at: new Date().toISOString(),
      });
    } catch (e: any) {
      console.warn("[n8n-webhook] audit log failed:", e?.message);
    }

    // Dispatch event (non-blocking, in real project this would be a queue)
    console.info(`[n8n-webhook] Received event: ${event}`);

    return NextResponse.json({ success: true, event });
  } catch (error: any) {
    console.error("[n8n-webhook] error:", error?.message);
    return NextResponse.json({ error: "Internal error", detail: error?.message }, { status: 500 });
  }
}
