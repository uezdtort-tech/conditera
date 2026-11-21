import { supabaseAdmin } from "@/lib/supabase/admin";

export type SessionAuthMethod = "password" | "oauth" | "two_factor" | "registration" | "dev";

const SESSION_TTL_DAYS = 30;

function requestMetadata(request?: Request) {
  const forwarded = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = (forwarded || request?.headers.get("x-real-ip") || "").slice(0, 64) || null;
  const userAgent = request?.headers.get("user-agent")?.slice(0, 512) || null;
  return { ip, userAgent };
}

export async function createUserSession(
  userId: string,
  request: Request | undefined,
  authMethod: SessionAuthMethod,
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { ip, userAgent } = requestMetadata(request);
  const { error } = await supabaseAdmin.from("user_sessions").insert({
    id: sessionId,
    user_id: userId,
    auth_method: authMethod,
    ip_address: ip,
    user_agent: userAgent,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("[session-registry] create failed; refusing to issue JWT:", error.message);
    throw new Error("Не удалось создать защищённую сессию");
  }

  const { error: eventError } = await supabaseAdmin.from("user_security_events").insert({
    user_id: userId,
    session_id: sessionId,
    event_type: "session_created",
    severity: "info",
    ip_address: ip,
    user_agent: userAgent,
    details: { auth_method: authMethod },
  });
  if (eventError) {
    // Session creation remains authoritative; telemetry failure is logged.
    console.error("[session-registry] session event write failed:", eventError.message);
  }
  return sessionId;
}

export async function isUserSessionActive(sessionId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("user_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error("[session-registry] validation failed; rejecting request:", error.message);
    return false;
  }
  return Boolean(data);
}

export async function revokeUserSession(
  sessionId: string,
  userId: string,
  reason = "user_logout",
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("user_sessions")
    .update({ revoked_at: now, revoked_reason: reason })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[session-registry] revoke failed:", error.message);
    return false;
  }
  if (data) {
    const { error: eventError } = await supabaseAdmin.from("user_security_events").insert({
      user_id: userId,
      session_id: sessionId,
      event_type: "session_revoked",
      severity: "info",
      details: { reason },
    });
    if (eventError) console.error("[session-registry] revoke event write failed:", eventError.message);
  }
  return Boolean(data);
}

export async function revokeAllUserSessions(
  userId: string,
  exceptSessionId?: string,
  reason = "user_revoke_all",
): Promise<number> {
  let query = supabaseAdmin
    .from("user_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (exceptSessionId) query = query.neq("id", exceptSessionId);
  const { data, error } = await query.select("id");
  if (error) {
    console.error("[session-registry] revoke-all failed:", error.message);
    throw new Error("Не удалось завершить остальные сессии");
  }
  return data?.length || 0;
}
