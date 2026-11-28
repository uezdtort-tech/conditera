import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("user_security_events")
    .select("id, event_type, severity, ip_address, user_agent, details, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[auth/security-events] query failed:", error.message);
    return NextResponse.json({ error: "Не удалось загрузить журнал безопасности" }, { status: 503 });
  }
  return NextResponse.json({
    events: (data ?? []).map((event) => ({
      id: String(event.id),
      event_type: event.event_type,
      severity: event.severity,
      ip_address: event.ip_address,
      user_agent: event.user_agent,
      details: event.details && typeof event.details === "object" ? event.details : null,
      created_at: event.created_at,
    })),
  });
}
