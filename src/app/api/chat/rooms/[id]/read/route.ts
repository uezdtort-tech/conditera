/**
 * POST /api/chat/rooms/[id]/read — отметить комнату прочитанной:
 * chat_channel_members.last_read_at = now() для текущего пользователя.
 * Staff без membership в support-комнате получает ok-но-оп (нечего апдейтить).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { HttpError, handleRouteError } from "@/lib/http-helpers";
import {
  canAccessRoom,
  fetchChannel,
  fetchMyMember,
  type SupabaseError,
} from "@/lib/chat-rooms";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");
    const { id } = await params;

    const channel = await fetchChannel(id);
    if (!channel || channel.deleted_at) throw new HttpError(404, "Комната не найдена");
    if (!(await canAccessRoom(channel, user))) throw new HttpError(403, "Нет доступа к комнате");

    const member = await fetchMyMember(id, user.id);
    if (!member) {
      // Staff-оператор смотрит support-комнату без membership — отмечать нечего
      return NextResponse.json({ ok: true, skipped: true });
    }

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("chat_channel_members")
      .update({ last_read_at: now })
      .eq("id", member.id) as { error: SupabaseError | null };
    if (error) {
      console.error("[chat/read] update:", error.message);
      throw new HttpError(500, "Не удалось отметить прочитанным");
    }

    return NextResponse.json({ ok: true, lastReadAt: now });
  } catch (error) {
    return handleRouteError(error);
  }
}
