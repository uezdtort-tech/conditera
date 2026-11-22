import { supabaseAdmin } from "@/lib/supabase/admin";

export type SessionAuthMethod = "password" | "oauth" | "two_factor" | "registration" | "dev";

export const NEW_DEVICE_LOGIN_BLOCKED = "ACCOUNT_NEW_DEVICE_REQUIRES_LOGOUT";
export const SESSION_POLICY_UNAVAILABLE = "ACCOUNT_SESSION_POLICY_UNAVAILABLE";

const SESSION_TTL_DAYS = 30;

function requestMetadata(request?: Request) {
  const forwarded = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = (forwarded || request?.headers.get("x-real-ip") || "").slice(0, 64) || null;
  const userAgent = request?.headers.get("user-agent")?.slice(0, 512) || null;
  const ua = userAgent || "";
  const platform = /Windows/i.test(ua) ? "Windows"
    : /Android/i.test(ua) ? "Android"
    : /iPhone|iPad|iPod/i.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/i.test(ua) ? "macOS"
    : /Linux/i.test(ua) ? "Linux"
    : "Неизвестная ОС";
  const browser = /Edg/i.test(ua) ? "Edge"
    : /Firefox/i.test(ua) ? "Firefox"
    : /Chrome/i.test(ua) ? "Chrome"
    : /Safari/i.test(ua) ? "Safari"
    : "Браузер";
  return { ip, userAgent, deviceLabel: `${platform} · ${browser}` };
}

export async function createUserSession(
  userId: string,
  request: Request | undefined,
  authMethod: SessionAuthMethod,
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { ip, userAgent, deviceLabel } = requestMetadata(request);
  const { data: previousSessions, error: historyError } = await supabaseAdmin
    .from("user_sessions")
    .select("id, ip_address, user_agent")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("last_seen_at", { ascending: false })
    .limit(10);
  if (historyError) {
    // Fail closed: без достоверной проверки активного устройства нельзя
    // разрешать новый вход и тем самым обходить персональную защиту аккаунта.
    console.error("[session-registry] prior-session lookup failed:", historyError.message);
    throw new Error(SESSION_POLICY_UNAVAILABLE);
  }
  const newDevice = Boolean(previousSessions?.length && !previousSessions.some(
    (session) => session.user_agent === userAgent && session.ip_address === ip
  ));

  if (newDevice) {
    const deviceDetails = {
      event_type: "new_device_login_blocked",
      ip_address: ip,
      user_agent: userAgent,
      device_label: deviceLabel,
      auth_method: authMethod,
      previous_active_sessions: previousSessions?.length || 0,
      policy: "existing_device_must_end_session_before_device_change",
    };
    const { error: eventError } = await supabaseAdmin.from("user_security_events").insert({
      user_id: userId,
      session_id: null,
      event_type: "new_device_login_blocked",
      severity: "warning",
      ip_address: ip,
      user_agent: userAgent,
      details: deviceDetails,
    });
    if (eventError) {
      console.error("[session-registry] blocked-device event write failed:", eventError.message);
      throw new Error(SESSION_POLICY_UNAVAILABLE);
    }

    const { error: notificationError } = await supabaseAdmin.from("notifications").insert({
      user_id: userId,
      type: "security_alert",
      channel: "in_app",
      status: "queued",
      title: "Заблокирован вход с нового устройства",
      body: `Попытка входа с нового устройства (${deviceLabel}) отклонена: сначала завершите активный сеанс на прежнем устройстве.`,
      metadata: deviceDetails,
    });
    if (notificationError) {
      console.error("[session-registry] blocked-device notification failed:", notificationError.message);
    }

    const eventDate = new Date().toISOString().slice(0, 10);
    const { error: taskError } = await supabaseAdmin.from("ops_tasks").upsert({
      dedup_key: `ACCOUNT_NEW_DEVICE_BLOCKED:${userId}:${eventDate}`,
      type: "ACCOUNT_NEW_DEVICE",
      severity: "important",
      title: "Проверить заблокированную попытку входа с нового устройства",
      description: `Пользователь ${userId}: ${deviceLabel}; IP: ${ip ?? "не определён"}. Активный сеанс на прежнем устройстве не был завершён.`,
      entity_type: "user",
      entity_id: userId,
      assignee_role: "ADMIN",
      payload: deviceDetails,
      status: "open",
      source: "security",
    }, { onConflict: "dedup_key" });
    if (taskError) {
      console.error("[session-registry] blocked-device admin task failed:", taskError.message);
    }

    // Не создаём новую сессию и не отзываем действующую. Для смены устройства
    // владелец сначала завершает прежний сеанс или обращается в поддержку.
    throw new Error(NEW_DEVICE_LOGIN_BLOCKED);
  }

  const { error } = await supabaseAdmin.from("user_sessions").insert({
    id: sessionId,
    user_id: userId,
    auth_method: authMethod,
    ip_address: ip,
    user_agent: userAgent,
    device_label: deviceLabel,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("[session-registry] create failed; refusing to issue JWT:", error.message);
    throw new Error("Не удалось создать защищённую сессию");
  }

  // Личный аккаунт не должен одновременно использоваться с нескольких устройств.
  // RPC сериализует параллельные логины и отзывает все прежние сессии атомарно.
  const { data: exclusivityResult, error: exclusivityError } = await supabaseAdmin.rpc(
    "enforce_single_active_user_session",
    { p_user_id: userId, p_session_id: sessionId },
  );
  if (exclusivityError || typeof exclusivityResult !== "number" || exclusivityResult === -1) {
    console.error("[session-registry] exclusive-session enforcement failed:", exclusivityError?.message ?? "replaced by concurrent login");
    await supabaseAdmin.from("user_sessions")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: "session_policy_enforcement_failed" })
      .eq("id", sessionId)
      .eq("user_id", userId)
      .is("revoked_at", null);
    if (exclusivityResult === -1) {
      throw new Error("ACCOUNT_SESSION_REPLACED_BY_CONCURRENT_LOGIN");
    }
    throw new Error("Не удалось обеспечить защиту персонального аккаунта");
  }

  const { error: eventError } = await supabaseAdmin.from("user_security_events").insert({
    user_id: userId,
    session_id: sessionId,
    event_type: newDevice ? "new_device_session" : "session_created",
    severity: newDevice ? "warning" : "info",
    ip_address: ip,
    user_agent: userAgent,
    details: {
      auth_method: authMethod,
      previous_active_sessions: previousSessions?.length || 0,
      new_device: newDevice,
    },
  });
  if (eventError) {
    // Session creation remains authoritative; telemetry failure is logged.
    console.error("[session-registry] session event write failed:", eventError.message);
  }

  if (newDevice) {
    const eventDate = new Date().toISOString().slice(0, 10);
    const dedupKey = `ACCOUNT_NEW_DEVICE:${userId}:${eventDate}`;
    const deviceDetails = {
      event_type: "new_device_session",
      session_id: sessionId,
      ip_address: ip,
      user_agent: userAgent,
      device_label: deviceLabel,
      auth_method: authMethod,
      previous_active_sessions: previousSessions?.length || 0,
    };

    const { error: notificationError } = await supabaseAdmin.from("notifications").insert({
      user_id: userId,
      type: "security_alert",
      channel: "in_app",
      status: "queued",
      title: "Вход с нового устройства",
      body: `В ваш аккаунт выполнен вход с нового устройства (${deviceLabel}). Если это не вы, проверьте активные сессии и смените пароль.`,
      metadata: deviceDetails,
    });
    if (notificationError) {
      console.error("[session-registry] new-device notification failed:", notificationError.message);
    }

    const { error: taskError } = await supabaseAdmin.from("ops_tasks").upsert({
      dedup_key: dedupKey,
      type: "ACCOUNT_NEW_DEVICE",
      severity: "important",
      title: "Проверить вход в аккаунт с нового устройства",
      description: `Пользователь ${userId}: ${deviceLabel}; IP: ${ip ?? "не определён"}. Проверьте историю сессий и признаки передачи аккаунта.`,
      entity_type: "user",
      entity_id: userId,
      assignee_role: "ADMIN",
      payload: deviceDetails,
      status: "open",
      source: "security",
    }, { onConflict: "dedup_key" });
    if (taskError) {
      console.error("[session-registry] new-device admin task failed:", taskError.message);
    }
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
  if (!data) return false;

  // Update activity at most once per five minutes to avoid a write on every API call.
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { error: touchError } = await supabaseAdmin
    .from("user_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .lt("last_seen_at", staleBefore);
  if (touchError) {
    console.error("[session-registry] activity update failed:", touchError.message);
    return false;
  }
  return true;
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
  const revokedIds = (data ?? []).map((row) => row.id);
  if (revokedIds.length) {
    const { error: eventError } = await supabaseAdmin.from("user_security_events").insert(
      revokedIds.map((sessionId) => ({
        user_id: userId,
        session_id: sessionId,
        event_type: "session_revoked",
        severity: "info",
        details: { reason },
      }))
    );
    if (eventError) {
      // Отзыв сессий уже состоялся; событие не меняет результат операции.
      console.error("[session-registry] revoke-all event write failed:", eventError.message);
    }
  }
  return revokedIds.length;
}


/** Первичная привязка единственного refresh-токена к сессии. */
export async function setSessionRefreshJti(
  sessionId: string,
  userId: string,
  jti: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("user_sessions")
    .update({ refresh_jti: jti })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    console.error("[session-registry] initial refresh jti write failed:", error?.message);
    await supabaseAdmin.from("user_sessions")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: "refresh_jti_init_failed" })
      .eq("id", sessionId)
      .eq("user_id", userId)
      .is("revoked_at", null);
    throw new Error("Не удалось инициализировать refresh-сессию");
  }
}

/** Атомарная одноразовая ротация: старый jti после успеха больше не принимается. */
export async function rotateSessionRefreshJti(
  sessionId: string,
  userId: string,
  currentJti: string,
  nextJti: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("user_sessions")
    .update({ refresh_jti: nextJti, last_seen_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("refresh_jti", currentJti)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[session-registry] refresh rotation failed closed:", error.message);
    return false;
  }
  if (!data) {
    // Сессия уже была проверена как активная; отсутствие строки при CAS
    // означает повторное использование/устаревший refresh JTI.
    const { error: eventError } = await supabaseAdmin.from("user_security_events").insert({
      user_id: userId,
      session_id: sessionId,
      event_type: "refresh_replay_detected",
      severity: "warning",
      details: { reason: "refresh_jti_mismatch" },
    });
    if (eventError) console.error("[session-registry] replay event write failed:", eventError.message);
    return false;
  }
  return true;
}
