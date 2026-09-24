/**
 * POST /api/crm/tickets/:id/messages — добавить сообщение в тикет.
 *
 * Body: { message, isInternal?, attachments? }
 * Auth: AUTHENTICATED (покупатель видит тикет, админ — внутренние сообщения)
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

    const isAdmin = user.roles?.includes("ADMIN") || user.roles?.includes("SUPPORT");
    if (!isAdmin && ticket.user_id !== user.id) {
      return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
    }

    const { data: message, error } = await supabaseAdmin
      .from("ticket_messages")
      .insert({
        ticket_id: id,
        sender_id: user.id,
        sender_name: user.name || "Пользователь",
        message: parse.data.message,
        is_internal: parse.data.isInternal && isAdmin ? true : false,
        attachments: parse.data.attachments || [],
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: "DB error", details: error.message }, { status: 500 });

    return NextResponse.json({ message }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
