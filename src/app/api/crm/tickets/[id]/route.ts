/**
 * /api/crm/tickets/[id] — управление конкретным тикетом.
 *
 * GET — детали тикета с сообщениями
 * PATCH — обновить (assign, change status)
 * POST /messages — добавить сообщение (через query param ?action=message)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    const { data: ticket, error } = await supabaseAdmin
      .from("support_tickets")
      .select(`
        *,
        messages:ticket_messages(*)
      `)
      .eq("id", id)
      .single();

    if (error || !ticket) {
      return NextResponse.json({ error: "Тикет не найден" }, { status: 404 });
    }

    // Проверка доступа
    const isOwner = ticket.user_id === user.id;
    const isAssigned = ticket.assigned_to === user.id;
    const isStaff = user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN", "SUPPORT", "MODERATOR"].includes(r)
    );

    // Для non-staff — скрыть internal notes
    if (!isStaff && !isAssigned) {
      if (!isOwner) {
        return forbiddenResponse("Нет доступа к этому тикету");
      }
      ticket.messages = (ticket.messages || []).filter((m: { is_internal: boolean }) => !m.is_internal);
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const { status, assignedTo, priority } = body as {
      status?: string;
      assignedTo?: string;
      priority?: string;
    };

    const updateData: Record<string, string | null> = {};
    if (status) {
      updateData.status = status;
      if (status === "resolved") updateData.resolved_at = new Date().toISOString();
      if (status === "closed") updateData.closed_at = new Date().toISOString();
    }
    if (assignedTo !== undefined) updateData.assigned_to = assignedTo;
    if (priority) updateData.priority = priority;

    // Загрузить текущий тикет для проверки прав
    const { data: ticket } = await supabaseAdmin
      .from("support_tickets")
      .select("user_id, assigned_to")
      .eq("id", id)
      .single();

    if (!ticket) {
      return NextResponse.json({ error: "Тикет не найден" }, { status: 404 });
    }

    const isOwner = ticket.user_id === user.id;
    const isAssigned = ticket.assigned_to === user.id;
    const isStaff = user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN", "SUPPORT"].includes(r)
    );

    // User может только закрыть свой тикет, support — любые действия
    if (!isStaff) {
      if (!isOwner && !isAssigned) {
        return forbiddenResponse();
      }
      // User не может назначать
      if (assignedTo !== undefined) {
        return forbiddenResponse("Только support может назначать тикеты");
      }
    }

    const { data: updated, error } = await supabaseAdmin
      .from("support_tickets")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ticket: updated });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
