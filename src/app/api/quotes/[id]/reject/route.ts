import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { comment?: unknown };
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 1000) : "";

  const { data, error } = await supabaseAdmin.rpc("reject_confectioner_quote", {
    p_quote_id: id,
    p_customer_id: user.id,
    p_comment: comment || null,
  });
  if (error || data !== true) {
    const message = error?.message || "";
    const status =
      /QUOTE_NOT_FOUND|QUOTE_REQUEST_NOT_FOUND/.test(message) ? 404 :
      /QUOTE_CUSTOMER_MISMATCH/.test(message) ? 403 :
      /QUOTE_NOT_PENDING/.test(message) ? 409 : 503;
    return NextResponse.json({
      error: /QUOTE_NOT_PENDING/.test(message) ? "Предложение уже обработано" : "Не удалось отклонить предложение",
    }, { status });
  }
  return NextResponse.json({ rejected: true });
}
