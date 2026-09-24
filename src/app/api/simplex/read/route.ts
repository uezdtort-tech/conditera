/**
 * POST /api/simplex/read — отметить сообщения прочитанными.
 *
 * Тело: { messageIds: string[] } или { all: true, chatId?: string }
 *
 * Auth: AUTHENTICATED
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { messageIds, all, chatId } = await request.json();

    try {
      if (all) {
        // Найти контакт пользователя
        const { data: contact } = await supabaseAdmin
          .from("simplex_contacts")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (contact) {
          let query = supabaseAdmin
            .from("simplex_messages")
            .update({ read_by_operator: true })
            .eq("simplex_contact_id", contact.id)
            .eq("read_by_operator", false);

          if (chatId) {
            query = query.eq("simplex_chat_id", chatId);
          }

          await query;
        }
      } else if (Array.isArray(messageIds) && messageIds.length > 0) {
        await supabaseAdmin
          .from("simplex_messages")
          .update({ read_by_operator: true })
          .in("id", messageIds);
      }
    } catch (e: any) {
      console.warn("[simplex/read] DB not available:", e?.message);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: "Internal error", detail: error?.message }, { status: 500 });
  }
}
