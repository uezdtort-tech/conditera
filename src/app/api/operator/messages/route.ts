/**
 * GET  /api/operator/messages?escalationId=... — получить сообщения из чата эскалации
 * POST /api/operator/messages — отправить сообщение от оператора в чат пользователя
 *
 * Тело POST: { escalationId, text }
 *
 * После отправки:
 *  - Сообщение сохраняется с sender_id = оператор, is_operator = false (human)
 *  - Если escalation ещё pending — автоматически берётся в работу (assigned_to = operator)
 *  - Отправляется уведомление пользователю (NEW_MESSAGE template)
 *
 * Z-v16 (SUPPORT-1, первопричина): маршрут читал `operator_escalations` (0010),
 * в то время как список эскалаций (operator/escalations), assign и resolve
 * работают с `chat_escalations` (0019) — id из списка всегда давал 404 здесь.
 * Сведено на `chat_escalations` (каноничная таблица; в operator_escalations
 * ни одной записи не существовало — все вставки падали по NOT NULL).
 * Сообщения комнаты читаются/пишутся по `chat_messages.channel_id` (0004);
 * легаси-путь `room_id` + `chat_rooms` сохранён как fallback для эскалаций,
 * чья комната не найдена в chat_channels.
 *
 * Безопасность:
 *   • GET/POST: требует роль ADMIN/SUPER_ADMIN/SUPPORT (проверка на сервере).
 *   • POST: safeJsonBody + валидация (text 1..5000 символов).
 *   • При сбое sendNotification — non-blocking (логируется, не прерывает flow).
 *   • Type-safe interfaces для всех данных.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

/** Строка chat_escalations (0019) — поля, нужные операторскому треду. */
interface ChatEscalationRow {
  id: string;
  chat_room_id: string;
  user_id: string | null;
  reason: string | null;
  priority: string | null;
  status: string;
  assigned_to: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Форма эскалации для UI оператора (совместима с прежним ответом). */
interface OperatorEscalationView {
  id: string;
  room_id: string;
  user_id: string | null;
  user_name: string | null;
  status: string;
  message: string | null;
  reason: string | null;
  priority: string | null;
  assigned_to: string | null;
  created_at: string;
}

interface ChatMessageRow {
  id: string;
  sender_id: string;
  text: string;
  is_system: boolean | null;
  is_bot: boolean | null;
  bot_kind: string | null;
  created_at: string;
}

const STAFF_ROLES = ["ADMIN", "SUPER_ADMIN", "SUPPORT"] as const;
const MAX_TEXT_LENGTH = 5000;
const RECENT_MESSAGES_LIMIT = 50;

interface PostBody {
  escalationId?: string;
  text?: string;
}

function metadataPreview(metadata: Record<string, unknown> | null): string | null {
  const preview = metadata?.message_preview;
  return typeof preview === "string" && preview.length > 0 ? preview : null;
}

async function loadEscalationView(escalationId: string): Promise<OperatorEscalationView | null> {
  const { data: row, error } = await supabaseAdmin
    .from("chat_escalations")
    .select(
      "id, chat_room_id, user_id, reason, priority, status, assigned_to, metadata, created_at"
    )
    .eq("id", escalationId)
    .maybeSingle() as { data: ChatEscalationRow | null; error: SupabaseError | null };

  if (error) {
    console.error("[operator/messages] escalation lookup failed:", error.message);
    throw new HttpError(500, "Не удалось загрузить эскалацию");
  }
  if (!row) return null;

  let userName: string | null = null;
  if (row.user_id) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("name")
      .eq("id", row.user_id)
      .maybeSingle() as { data: { name: string | null } | null; error: SupabaseError | null };
    userName = profile?.name ?? null;
  }

  return {
    id: row.id,
    room_id: row.chat_room_id,
    user_id: row.user_id,
    user_name: (row.metadata?.user_name as string | null) || userName,
    status: row.status,
    message: metadataPreview(row.metadata),
    reason: row.reason,
    priority: row.priority,
    assigned_to: row.assigned_to,
    created_at: row.created_at,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    // ZV31-007: роль сверяется с БД (user_roles через requireAnyRole), а не с
    // JWT-клеймом roles — тот заморожен на срок жизни access-токена (до 7д).
    const guard = await requireAnyRole(user.userId, [...STAFF_ROLES]);
    if (guard) throw new HttpError(403, "Нет прав");

    const { searchParams } = new URL(request.url);
    const escalationId = searchParams.get("escalationId");
    if (!escalationId) {
      throw new HttpError(400, "Укажите escalationId");
    }

    const escalation = await loadEscalationView(escalationId);
    if (!escalation) throw new HttpError(404, "Эскалация не найдена");

    // Последние 50 сообщений комнаты (старые сначала) — каноничный channel_id
    const { data: messages, error: msgErr } = await supabaseAdmin
      .from("chat_messages")
      .select("id, sender_id, text, is_system, is_bot, bot_kind, created_at")
      .eq("channel_id", escalation.room_id)
      .order("created_at", { ascending: true })
      .limit(RECENT_MESSAGES_LIMIT) as { data: ChatMessageRow[] | null; error: SupabaseError | null };

    if (msgErr) {
      console.warn("[operator/messages] messages query failed:", msgErr.message);
    }

    return NextResponse.json({
      escalation,
      messages: messages || [],
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    // ZV31-007: серверная проверка роли по user_roles (см. GET выше).
    const guard = await requireAnyRole(user.userId, [...STAFF_ROLES]);
    if (guard) throw new HttpError(403, "Нет прав");

    const { data: body, error: parseErr } = await safeJsonBody<PostBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    if (typeof body.escalationId !== "string" || body.escalationId.length === 0) {
      throw new HttpError(400, "Укажите escalationId");
    }
    if (typeof body.text !== "string" || body.text.trim().length === 0) {
      throw new HttpError(400, "Укажите text");
    }
    if (body.text.length > MAX_TEXT_LENGTH) {
      throw new HttpError(422, `text слишком длинный (макс ${MAX_TEXT_LENGTH} символов)`);
    }

    const { data: escalation, error: escErr } = await supabaseAdmin
      .from("chat_escalations")
      .select("id, chat_room_id, user_id, status")
      .eq("id", body.escalationId)
      .maybeSingle() as { data: { id: string; chat_room_id: string; user_id: string | null; status: string } | null; error: SupabaseError | null };

    if (escErr) {
      console.error("[operator/messages] escalation lookup failed:", escErr.message);
      throw new HttpError(500, "Не удалось загрузить эскалацию");
    }
    if (!escalation) throw new HttpError(404, "Эскалация не найдена");

    // Если ещё pending — автоматически берём в работу (0019-колонки)
    const wasPending = escalation.status === "pending";
    if (wasPending) {
      const { error: assignErr } = await supabaseAdmin
        .from("chat_escalations")
        .update({
          status: "assigned",
          assigned_to: user.userId,
          assigned_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", escalation.id);
      if (assignErr) {
        console.warn("[operator/messages] assign update failed:", assignErr.message);
      }
    }

    // Комната эскалации — канал chat_channels? (легаси chat_rooms — fallback)
    const { data: channel } = await supabaseAdmin
      .from("chat_channels")
      .select("id")
      .eq("id", escalation.chat_room_id)
      .limit(1) as { data: { id: string }[] | null; error: SupabaseError | null };
    const isChannel = Array.isArray(channel) && channel.length > 0;

    // Сохраняем сообщение оператора: channel_id (0004) или room_id (0040 легаси)
    const messagePayload: Record<string, unknown> = {
      sender_id: user.userId,
      text: body.text,
      is_system: false,
      is_bot: false,
      created_at: new Date().toISOString(),
    };
    if (isChannel) messagePayload.channel_id = escalation.chat_room_id;
    else messagePayload.room_id = escalation.chat_room_id;

    const { data: message, error: msgErr } = await supabaseAdmin
      .from("chat_messages")
      .insert(messagePayload)
      .select("id, sender_id, text, is_system, is_bot, bot_kind, created_at")
      .single() as { data: ChatMessageRow | null; error: SupabaseError | null };

    if (msgErr || !message) {
      console.error("[operator/messages] message insert failed:", msgErr?.message);
      throw new HttpError(500, "Не удалось сохранить сообщение");
    }

    // Обновляем метрики комнаты (каноничный путь — chat_channels 0004)
    if (isChannel) {
      const { error: roomErr } = await supabaseAdmin
        .from("chat_channels")
        .update({
          last_message_at: new Date().toISOString(),
          last_message_text: `[Оператор]: ${body.text.slice(0, 120)}`,
        })
        .eq("id", escalation.chat_room_id);
      if (roomErr) {
        console.warn("[operator/messages] channel update failed:", roomErr.message);
      }
    }

    // Уведомление пользователю (non-blocking)
    if (escalation.user_id) {
      try {
        const { sendNotification } = await import("@/lib/notifications");
        await sendNotification({
          userId: escalation.user_id,
          template: "NEW_MESSAGE",
          vars: {
            senderName: "Оператор поддержки",
            messagePreview: body.text.slice(0, 200),
          },
          data: {
            type: "operator_reply",
            escalationId: escalation.id,
            roomId: escalation.chat_room_id,
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[operator/messages] User notification failed:", msg);
      }
    }

    return NextResponse.json({
      success: true,
      message,
      autoAssigned: wasPending,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
