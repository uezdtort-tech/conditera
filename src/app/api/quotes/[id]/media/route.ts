import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { listQuoteMedia, saveQuoteMedia, MediaValidationError } from "@/lib/ops/quote-media";
import { resolveQuoteMediaAccess } from "@/lib/ops/quote-media-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
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
    const media = await listQuoteMedia(id);
    return NextResponse.json({ media: media.map(item => ({
      ...item, url: `/api/quotes/${id}/media/${item.id}`,
    })) });
  } catch (error) {
    console.error("[quote-media] list failed:", (error as Error).message);
    return NextResponse.json({ error: "MEDIA_UNAVAILABLE" }, { status: 503 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  let access;
  try {
    access = await resolveQuoteMediaAccess(id, user.id, user.roles ?? []);
  } catch (error) {
    console.error("[quote-media] upload access check failed:", (error as Error).message);
    return NextResponse.json({ error: "MEDIA_ACCESS_UNAVAILABLE" }, { status: 503 });
  }
  if (!access.quote) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // Только покупатель прикрепляет исходные пожелания и макет к своему запросу.
  if (!access.isOwner && !access.isAdmin) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "Ожидается multipart/form-data" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  const rawKind = form.get("kind");
  if (rawKind !== "customer_reference" && rawKind !== "builder_preview") {
    return NextResponse.json({ error: "INVALID_MEDIA_KIND" }, { status: 400 });
  }
  try {
    const media = await saveQuoteMedia({
      quoteRequestId: id, file, uploadedBy: user.id, kind: rawKind,
    });
    return NextResponse.json({
      media: { ...media, url: `/api/quotes/${id}/media/${media.id}` },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof MediaValidationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    console.error("[quote-media] upload failed:", (error as Error).message);
    return NextResponse.json({ error: "MEDIA_UPLOAD_FAILED" }, { status: 503 });
  }
}
