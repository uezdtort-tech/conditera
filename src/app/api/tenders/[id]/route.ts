/**
 * GET /api/tenders/:id — детали тендера (AUTHENTICATED).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

interface RouteParams { params: Promise<{ id: string }>; }

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { data: tender, error } = await supabaseAdmin
      .from("price_inquiries")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !tender) {
      return NextResponse.json({ error: "Тендер не найден" }, { status: 404 });
    }

    return NextResponse.json({ tender });
  } catch (error: any) {
    return NextResponse.json({ error: "Внутренняя ошибка", detail: error?.message }, { status: 500 });
  }
}
