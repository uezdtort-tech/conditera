/**
 * GET /api/orders/[id]/reference-media
 * Исходные фото-пожелания и макеты конструктора, перенесённые в контекст заказа
 * после принятия предложения. Защищённый upload-маршрут order media не меняется.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadOrderLite, canOperateOrder } from "@/lib/ops/order-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    if (order.user_id !== user.id && !(await canOperateOrder(order, user.id))) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "Нет доступа к материалам заказа" },
        { status: 403 }
      );
    }

    // RFQ и quote media находятся в Supabase PG17 control plane.
    const { data: orderSource, error: sourceError } = await supabaseAdmin
      .from("orders")
      .select("source_quote_id")
      .eq("id", id)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!orderSource?.source_quote_id) {
      return NextResponse.json({ media: [] });
    }

    const { data: quote, error: quoteError } = await supabaseAdmin
      .from("confectioner_quotes")
      .select("quote_request_id")
      .eq("id", orderSource.source_quote_id)
      .maybeSingle();
    if (quoteError) throw quoteError;
    if (!quote?.quote_request_id) {
      return NextResponse.json({ media: [] });
    }

    const { data: rows, error: mediaError } = await supabaseAdmin
      .from("quote_request_media")
      .select("id, quote_request_id, kind, mime_type, file_size, width, height, uploaded_at")
      .eq("quote_request_id", quote.quote_request_id)
      .eq("status", "approved")
      .order("uploaded_at", { ascending: true });
    if (mediaError) throw mediaError;

    return NextResponse.json({
      media: (rows ?? []).map((row) => ({
        id: row.id,
        kind: row.kind,
        source: "customer_reference",
        mimeType: row.mime_type,
        fileSize: Number(row.file_size),
        width: row.width,
        height: row.height,
        uploadedAt: new Date(row.uploaded_at).toISOString(),
        url: `/api/quotes/${row.quote_request_id}/media/${row.id}`,
      })),
    });
  } catch (error) {
    console.error(
      "[orders/reference-media] GET failed:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Не удалось загрузить исходные материалы заказа" },
      { status: 500 }
    );
  }
}
