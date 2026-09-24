/**
 * /api/ai-assistant/conversations/route.ts — список диалогов пользователя.
 *
 * GET /api/ai-assistant/conversations
 *
 * Query параметры:
 *  - role_context — фильтр по роли (CUSTOMER, CONFECTIONER, ...)
 *  - include_archived — true/false (по умолчанию false — скрыть архивные)
 *  - limit — по умолчанию 20, макс 100
 *  - offset — по умолчанию 0
 *
 * Возвращает список диалогов с последним сообщением и метаданными.
 *
 * Права:
 *  GET — любой AUTHENTICATED пользователь (только свои диалоги)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import type { user_role, AIAssistantConversation } from "@/lib/supabase/types";

export const runtime = "nodejs";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/ai-assistant/conversations — список диалогов пользователя.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Необходима аутентификация" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const roleContext = searchParams.get("role_context") as user_role | null;
    const includeArchived = searchParams.get("include_archived") === "true";
    const limit = Math.min(
      parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10),
      MAX_LIMIT
    );
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let query = supabaseAdmin
      .from("ai_assistant_conversations")
      .select(
        `
        id, role_context, title, message_count, last_message_at,
        is_archived, metadata, created_at, updated_at
      `
      )
      .eq("user_id", user.id)
      .order("last_message_at", { ascending: false, nullsFirst: false });

    if (!includeArchived) {
      query = query.eq("is_archived", false);
    }

    if (roleContext) {
      query = query.eq("role_context", roleContext);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) {
      console.error("[ai-assistant/conversations] GET error:", error.message);
      return NextResponse.json(
        { error: "Ошибка при получении списка диалогов" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: (data || []) as Partial<AIAssistantConversation>[],
      meta: {
        limit,
        offset,
        count: data?.length ?? 0,
      },
    });
  } catch (error: any) {
    console.error("[ai-assistant/conversations] GET unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
