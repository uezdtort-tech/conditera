/**
 * POST /api/crm/tickets/:id/messages — добавить сообщение в тикет.
 *
 * Body: { message, isInternal?, attachments? }
 * Auth: единый контракт getUserFromRequest (cookie cd_session | Bearer).
 *
 * SCHEMA MATCH: таблица ticket_messages (0005_crm_cms.sql:52-63) имеет
 * колонку `text TEXT NOT NULL` и НЕ имеет колонок `message`/`sender_name`.
 * Пишем строго в схему: text + is_internal + attachments.
 * Ответ маппится в UI-контракт (authorId/authorName/authorRole/message/
 * isInternal/createdAt) — admin-crm-tickets.tsx читает эти поля.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { z } from "zod";

export const runtime = "nodejs";

const createMessageSchema = z.object({
  message: z.string().min(1).max(5000),
  isInternal: z.boolean().default(false),
  attachments: z.array(z.object({
    name: z.string(),
    url: z.string().url(),
    size: z.number().optional(),
  })).max(5).optional(),
});

interface RouteParams { params: Promise<{ id: string }>; }

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const body = await request.json();
    const parse = createMessageSchema.safeParse(body);
    if (!parse.success) {
      return NextResponse.json({ error: "Invalid data", details: parse.error.flatten() }, { status: 400 });
    }

    const { data: ticket } = await supabaseAdmin
      .from("support_tickets")
      .select("id, user_id, status")
      .eq("id", id)
      .maybeSingle();

    if (!ticket) return NextResponse.json({ error: "Тикет не найден" }, { status: 404 });

    const isStaff = user.roles?.includes("ADMIN") || user.roles?.includes("SUPER_ADMIN") || user.roles?.includes("SUPPORT");
    if (!isStaff && ticket.user_id !== user.id) {
      return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
    }

    // === Пишем строго в схему: `text`, НЕ `message`; sender_name не существует ===
    const { data: row, error } = await supabaseAdmin
      .from("ticket_messages")
      .insert({
        ticket_id: id,
        sender_id: user.id,
        text: parse.data.message,
        is_internal: parse.data.isInternal && isStaff ? true : false,
        attachments: parse.data.attachments || [],
      })
      .select()
      .single();

    if (error || !row) {
      return NextResponse.json({ error: "DB error", details: error?.message }, { status: 500 });
    }

    // Маппинг в UI-контракт (authorRole: customer | admin | system)
    const message = mapTicketMessage(row, ticket.user_id);

    return NextResponse.json({ message }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}

/**
 * Row ticket_messages → UI-модель TicketMessage (admin-crm-tickets.tsx).
 * sender_name не хранится — выводим из контекста: владелец тикета = клиент,
 * прочие sender'ы (staff) = оператор.
 */
export function mapTicketMessage(
  row: {
    id: string;
    ticket_id: string;
    sender_id: string;
    text: string;
    is_internal: boolean | null;
    is_system: boolean | null;
    created_at: string;
  },
  ticketOwnerId: string
) {
  const isOwner = row.sender_id === ticketOwnerId;
  return {
    id: row.id,
    ticketId: row.ticket_id,
    authorId: row.sender_id,
    authorName: isOwner ? "Клиент" : "Оператор поддержки",
    authorRole: row.is_system ? "system" : isOwner ? "customer" : "admin",
    message: row.text,
    isInternal: Boolean(row.is_internal),
    createdAt: row.created_at,
  };
}
