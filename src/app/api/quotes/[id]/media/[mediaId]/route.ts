import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { downloadQuoteMedia } from "@/lib/ops/quote-media";
import { resolveQuoteMediaAccess } from "@/lib/ops/quote-media-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> }
) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id, mediaId } = await params;
  let access;
  try {
    access = await resolveQuoteMediaAccess(id, user.id, user.roles ?? []);
  } catch (error) {
    console.error("[quote-media] access check failed:", (error as Error).message);
    return NextResponse.json({ error: "MEDIA_ACCESS_UNAVAILABLE" }, { status: 503 });
  }
  if (!access.quote) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!access.isOwner && !access.isRecipient && !access.isAdmin) {
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
