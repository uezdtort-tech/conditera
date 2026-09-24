/**
 * /api/crm/tickets — CRUD для тикетов поддержки.
 *
 * GET — список тикетов (для support/admin или свои)
 * POST — создать тикет
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    const { searchParams } = request.nextUrl;
    const filter = searchParams.get("filter") || "all";

    let query = supabaseAdmin.from("support_tickets").select(`
      *,
      messages:ticket_messages(id, sender_id, text, is_internal, created_at)
    `);

    if (filter === "own") {
      query = query.eq("user_id", user.id);
    } else if (filter === "assigned") {
      query = query.eq("assigned_to", user.id);
    } else {
      // all — только для support/admin
      if (!user.roles.some((r: string) => ["ADMIN", "SUPER_ADMIN", "SUPPORT", "MODERATOR"].includes(r))) {
        return forbiddenResponse("Только support может видеть все тикеты");
      }
    }

    const { data, error } = await query.order("created_at", { ascending: false }).limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ tickets: data });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const { subject, category = "other", priority = "medium", orderId, message } = body as {
      subject: string;
      category?: string;
      priority?: string;
      orderId?: string;
      message: string;
    };

    if (!subject || !message) {
      return NextResponse.json(
        { error: "Subject и message обязательны" },
        { status: 400 }
      );
    }

    // Создать тикет (number генерируется триггером)
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from("support_tickets")
      .insert({
        user_id: user.id,
        subject,
        category,
        priority,
        order_id: orderId,
      })
      .select()
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json(
        { error: "Ошибка создания тикета", detail: ticketError?.message },
        { status: 500 }
      );
    }

    // Создать первое сообщение
    const { error: msgError } = await supabaseAdmin
      .from("ticket_messages")
      .insert({
        ticket_id: ticket.id,
        sender_id: user.id,
        text: message,
      });

    if (msgError) {
      console.warn("[crm/tickets] First message error:", msgError.message);
    }

    // Отправить уведомление support через Edge Function
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (supabaseUrl) {
        await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "ticket_created",
            ticketId: ticket.number,
            customer: user.email,
            priority,
          }),
        });
      }
    } catch (e) {
      console.warn("[crm/tickets] Notification error:", (e as Error).message);
    }

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
