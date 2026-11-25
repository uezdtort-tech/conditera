import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, verifyAccessToken } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session-cookies";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revokeAllUserSessions } from "@/lib/session-registry";

export const runtime = "nodejs";

async function currentSession(request: NextRequest) {
  const user = await getUserFromRequest(request);
  // Согласуем приоритет источника токена с getUserFromRequest().
  const bearerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const token = bearerToken || request.cookies.get(SESSION_COOKIE)?.value;
  const payload = token ? await verifyAccessToken(token) : null;
  if (!user || !payload?.sid || payload.userId !== user.id) return null;
  return { user, sessionId: payload.sid };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const current = await currentSession(request);
  if (!current) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("user_sessions")
    .select("id, auth_method, user_agent, ip_address, device_label, created_at, last_seen_at, expires_at, revoked_at")
    .eq("user_id", current.user.id)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("last_seen_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Не удалось загрузить список сессий" }, { status: 503 });
  return NextResponse.json({
    sessions: (data || []).map((session) => ({
      ...session,
      isCurrent: session.id === current.sessionId,
    })),
  });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const current = await currentSession(request);
  if (!current) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });

  try {
    const revoked = await revokeAllUserSessions(current.user.id, current.sessionId, "user_revoke_all_others");
    return NextResponse.json({ ok: true, revoked });
  } catch {
    return NextResponse.json({ error: "Не удалось завершить остальные сессии" }, { status: 503 });
  }
}
