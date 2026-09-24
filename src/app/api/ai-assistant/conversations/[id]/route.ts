/**
 * /api/ai-assistant/conversations/[id]/route.ts — операции с конкретным диалогом.
 *
 * GET    /api/ai-assistant/conversations/:id — карточка диалога + последние сообщения
 * PATCH  /api/ai-assistant/conversations/:id — обновить (title, is_archived, metadata)
 * DELETE /api/ai-assistant/conversations/:id — удалить диалог (каскадно удаляет все сообщения)
 *
 * Права:
 *  Все операции — только владелец диалога
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import type { AIAssistantConversation, AIAssistantLog } from "@/lib/supabase/types";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const MAX_MESSAGES_PER_PAGE = 50;

/**
 * GET /api/ai-assistant/conversations/:id — карточка диалога с последними сообщениями.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: "Необходима аутентификация" },
        { status: 401 }
      );
    }

    // Найти диалог
    const { data: conv, error: convErr } = await supabaseAdmin
      .from("ai_assistant_conversations")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (convErr || !conv) {
      return NextResponse.json(
        { error: "Диалог не найден" },
        { status: 404 }
      );
    }

    if (conv.user_id !== user.id) {
      return NextResponse.json(
        { error: "Диалог принадлежит другому пользователю" },
        { status: 403 }
      );
    }

    // Получить последние сообщения из ai_assistant_logs
    const { searchParams } = new URL(request.url);
    const messageLimit = Math.min(
      parseInt(searchParams.get("message_limit") || "20", 10),
      MAX_MESSAGES_PER_PAGE
    );

    const { data: messages, error: msgErr } = await supabaseAdmin
      .from("ai_assistant_logs")
      .select(
        `
        id, request_type, input_text, output_text, model_used,
        latency_ms, was_helpful, error_code, created_at
      `
      )
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .limit(messageLimit);

    if (msgErr) {
      console.warn("[ai-assistant/conversations/:id] messages fetch error:", msgErr.message);
    }

    return NextResponse.json({
      data: {
        conversation: conv as AIAssistantConversation,
        messages: (messages || []) as Partial<AIAssistantLog>[],
      },
    });
  } catch (error: any) {
    console.error("[ai-assistant/conversations/:id] GET unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/ai-assistant/conversations/:id — обновить диалог.
 * Можно изменить: title, is_archived, metadata
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: "Необходима аутентификация" },
        { status: 401 }
      );
    }

    // Проверить владение
    const { data: conv, error: convErr } = await supabaseAdmin
      .from("ai_assistant_conversations")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle();

    if (convErr || !conv) {
      return NextResponse.json(
        { error: "Диалог не найден" },
        { status: 404 }
      );
    }

    if (conv.user_id !== user.id) {
      return NextResponse.json(
        { error: "Диалог принадлежит другому пользователю" },
        { status: 403 }
      );
    }

    const body = await request.json();

    const allowed: Record<string, unknown> = {};
    if (typeof body.title === "string" && body.title.length > 0 && body.title.length <= 255) {
      allowed.title = body.title;
    }
    if (typeof body.is_archived === "boolean") {
      allowed.is_archived = body.is_archived;
    }
    if (body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) {
      allowed.metadata = body.metadata;
    }

    if (Object.keys(allowed).length === 0) {
      return NextResponse.json(
        { error: "Нет полей для обновления (разрешены: title, is_archived, metadata)" },
        { status: 422 }
      );
    }

    const { data: updated, error } = await supabaseAdmin
      .from("ai_assistant_conversations")
      .update(allowed)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[ai-assistant/conversations/:id] PATCH error:", error.message);
      return NextResponse.json(
        { error: "Ошибка при обновлении" },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: updated as AIAssistantConversation });
  } catch (error: any) {
    console.error("[ai-assistant/conversations/:id] PATCH unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/ai-assistant/conversations/:id — удалить диалог.
 * Каскадно удаляются все связанные сообщения в ai_assistant_logs (FK ON DELETE CASCADE).
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: "Необходима аутентификация" },
        { status: 401 }
      );
    }

    // Проверить владение
    const { data: conv, error: convErr } = await supabaseAdmin
      .from("ai_assistant_conversations")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle();

    if (convErr || !conv) {
      return NextResponse.json(
        { error: "Диалог не найден" },
        { status: 404 }
      );
    }

    if (conv.user_id !== user.id) {
      return NextResponse.json(
        { error: "Диалог принадлежит другому пользователю" },
        { status: 403 }
      );
    }

    // Удалить диалог (каскадно удалит сообщения)
    const { error: deleteErr } = await supabaseAdmin
      .from("ai_assistant_conversations")
      .delete()
      .eq("id", id);

    if (deleteErr) {
      console.error("[ai-assistant/conversations/:id] DELETE error:", deleteErr.message);
      return NextResponse.json(
        { error: "Ошибка при удалении" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: { id },
      message: "Диалог удалён со всеми сообщениями",
    });
  } catch (error: any) {
    console.error("[ai-assistant/conversations/:id] DELETE unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
