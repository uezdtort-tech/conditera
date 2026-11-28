import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — собственный журнал событий безопасности, без доступа к чужим аккаунтам. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("user_security_events")
    .select("id, session_id, event_type, severity, ip_address, user_agent, details, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("[security-events] read failed:", error.message);
    return NextResponse.json({ error: "Не удалось загрузить журнал безопасности" }, { status: 503 });
  }

  return NextResponse.json({ events: data ?? [] });
}
