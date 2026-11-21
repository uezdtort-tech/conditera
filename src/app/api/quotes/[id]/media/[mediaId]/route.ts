import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { downloadQuoteMedia } from "@/lib/ops/quote-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> }
) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id, mediaId } = await params;
  const { data: quote, error } = await supabaseAdmin
    .from("quote_requests")
    .select("id, customer_id, confectioner_ids")
    .eq("id", id)
    .maybeSingle();
  if (error || !quote) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const isOwner = quote.customer_id === user.id;
  const isAdmin = (user.roles ?? []).some(role => role === "ADMIN" || role === "SUPER_ADMIN");
  let isRecipient = false;
  if (!isOwner && !isAdmin) {
    const { data: confectioner } = await supabaseAdmin
      .from("confectioners").select("id").eq("userId", user.id).maybeSingle();
    isRecipient = Boolean(confectioner && (quote.confectioner_ids ?? []).includes(confectioner.id));
  }
  if (!isOwner && !isRecipient && !isAdmin) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  try {
    const media = await downloadQuoteMedia(id, mediaId);
    if (!media) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    return new NextResponse(new Uint8Array(media.buffer), {
      status: 200,
      headers: {
        "Content-Type": media.mimeType,
        "Content-Length": String(media.buffer.length),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    console.error("[quote-media] download failed:", (error as Error).message);
    return NextResponse.json({ error: "MEDIA_UNAVAILABLE" }, { status: 503 });
  }
}
