/**
 * GET  /api/operator/messages?escalationId=... — получить сообщения из чата эскалации
 * POST /api/operator/messages — отправить сообщение от оператора в чат пользователя
 *
 * Тело POST: { escalationId, text }
 *
 * После отправки:
 *  - Сообщение сохраняется с sender_id = оператор, is_operator = true
 *  - Если escalation ещё pending — автоматически берётся в работу (assignedTo = operator)
 *  - Отправляется уведомление пользователю (NEW_MESSAGE template)
 *
 * Безопасность:
 *   • GET/POST: требует роль ADMIN/SUPER_ADMIN/SUPPORT.
 *   • POST: safeJsonBody + валидация (text 1..5000 символов).
 *   • При сбое sendNotification — non-blocking (логируется, не прерывает flow).
 *   • Type-safe interfaces для всех данных.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

interface OperatorEscalationRow {
  id: string;
  room_id: string;
  user_id: string;
  user_name: string | null;
  status: string;
  message: string | null;
  reason: string | null;
  assigned_to: string | null;
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const roles = user.roles || [];
    if (!roles.some((r) => (STAFF_ROLES as readonly string[]).includes(r))) {
      throw new HttpError(403, "Нет прав");
    }

    const { searchParams } = new URL(request.url);
    const escalationId = searchParams.get("escalationId");
    if (!escalationId) {
      throw new HttpError(400, "Укажите escalationId");
    }

    const { data: escalation, error: escErr } = await supabaseAdmin
      .from("operator_escalations")
      .select("id, room_id, user_id, user_name, status, message, reason, assigned_to")
      .eq("id", escalationId)
      .maybeSingle() as { data: OperatorEscalationRow | null; error: SupabaseError | null };

    if (escErr) {
      console.error("[operator/messages] escalation lookup failed:", escErr.message);
      throw new HttpError(500, "Не удалось загрузить эскалацию");
    }
    if (!escalation) throw new HttpError(404, "Эскалация не найдена");

    // Получаем последние 50 сообщений из комнаты (старые сначала)
    const { data: messages, error: msgErr } = await supabaseAdmin
      .from("chat_messages")
      .select("id, sender_id, text, is_system, is_bot, bot_kind, created_at")
      .eq("room_id", escalation.room_id)
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

    const roles = user.roles || [];
    if (!roles.some((r) => (STAFF_ROLES as readonly string[]).includes(r))) {
      throw new HttpError(403, "Нет прав");
    }

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
      .from("operator_escalations")
      .select("id, room_id, user_id, status")
      .eq("id", body.escalationId)
      .maybeSingle() as { data: { id: string; room_id: string; user_id: string; status: string } | null; error: SupabaseError | null };

    if (escErr) {
      console.error("[operator/messages] escalation lookup failed:", escErr.message);
      throw new HttpError(500, "Не удалось загрузить эскалацию");
    }
    if (!escalation) throw new HttpError(404, "Эскалация не найдена");

    // Если ещё pending — автоматически берём в работу
    const wasPending = escalation.status === "pending";
    if (wasPending) {
      await supabaseAdmin
        .from("operator_escalations")
        .update({
          status: "assigned",
          assigned_to: user.userId,
          assigned_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.escalationId);
    }

    // Сохраняем сообщение оператора
    const { data: message, error: msgErr } = await supabaseAdmin
      .from("chat_messages")
      .insert({
        room_id: escalation.room_id,
        sender_id: user.userId,
        text: body.text,
        is_system: false,
        is_bot: false,
        created_at: new Date().toISOString(),
      })
      .select("id, sender_id, text, is_system, is_bot, bot_kind, created_at")
      .single() as { data: ChatMessageRow | null; error: SupabaseError | null };

    if (msgErr || !message) {
      console.error("[operator/messages] message insert failed:", msgErr?.message);
      throw new HttpError(500, "Не удалось сохранить сообщение");
    }

    // Обновляем lastMessage в комнате
    const { error: roomErr } = await supabaseAdmin
      .from("chat_rooms")
      .update({
        last_message: `[Оператор]: ${body.text.slice(0, 100)}`,
        last_message_at: new Date().toISOString(),
      })
      .eq("id", escalation.room_id);

    if (roomErr) {
      console.warn("[operator/messages] room update failed:", roomErr.message);
    }

    // Уведомление пользователю (non-blocking)
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
          roomId: escalation.room_id,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[operator/messages] User notification failed:", msg);
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
