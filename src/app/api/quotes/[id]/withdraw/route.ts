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
  const { id: quoteRequestId } = await params;

  const { data: confectioner } = await supabaseAdmin
    .from("confectioners").select("id").eq("userId", user.userId).maybeSingle();
  if (!confectioner) return NextResponse.json({ error: "Вы не кондитер" }, { status: 403 });

  const { data: quote, error } = await supabaseAdmin
    .from("confectioner_quotes").select("id, status")
    .eq("quote_request_id", quoteRequestId)
    .eq("confectioner_id", confectioner.id)
    .maybeSingle();
  if (error || !quote) return NextResponse.json({ error: "Предложение не найдено" }, { status: 404 });
  if (quote.status !== "pending") return NextResponse.json({ error: "Предложение уже обработано" }, { status: 409 });

  const { error: updateError } = await supabaseAdmin
    .from("confectioner_quotes")
    .update({ status: "rejected", customer_comment: "Предложение отозвано кондитером" })
    .eq("id", quote.id)
    .eq("status", "pending");
  if (updateError) return NextResponse.json({ error: "Не удалось отозвать предложение" }, { status: 503 });
  return NextResponse.json({ withdrawn: true });
}
