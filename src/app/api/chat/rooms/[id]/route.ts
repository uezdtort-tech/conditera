/**
 * GET /api/chat/rooms/[id] — одна комната (membership или staff для support).
 * Используется виджетом (заголовок комнаты) и chat-server'ом (определение
 * типа комнаты для FAQ-бота, кеш на стороне сервера сокетов).
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { HttpError, handleRouteError } from "@/lib/http-helpers";
import { canAccessRoom, fetchChannel, fetchMyMember } from "@/lib/chat-rooms";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(_request);
    if (!user) throw new HttpError(401, "Не авторизован");
    const { id } = await params;

    const channel = await fetchChannel(id);
    if (!channel || channel.deleted_at) throw new HttpError(404, "Комната не найдена");
    if (!(await canAccessRoom(channel, user))) throw new HttpError(403, "Нет доступа к комнате");

    const member = await fetchMyMember(channel.id, user.id);
    return NextResponse.json({
      room: {
        id: channel.id,
        type: channel.order_id ? "order" : channel.type === "group" ? "group" : channel.type,
        name: channel.name || "Чат",
        lastMessage: channel.last_message_text || undefined,
        lastMessageAt: channel.last_message_at || undefined,
        orderId: channel.order_id || undefined,
        supportTicketId: channel.support_ticket_id || undefined,
        createdAt: channel.created_at,
      },
      lastReadAt: member?.last_read_at || null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
