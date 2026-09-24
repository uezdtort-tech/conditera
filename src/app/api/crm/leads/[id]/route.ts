/**
 * /api/crm/leads/[id] — управление лидом.
 *
 * GET — детали лида с активностями
 * PATCH — обновить (сменить статус, назначить)
 * DELETE — удалить
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

    if (!user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN", "SUPPORT", "MODERATOR", "CONFECTIONER"].includes(r)
    )) {
      return forbiddenResponse();
    }

    const { data: lead, error } = await supabaseAdmin
      .from("leads")
      .select(`
        *,
        activities:lead_activities(*)
      `)
      .eq("id", id)
      .single();

    if (error || !lead) {
      return NextResponse.json({ error: "Лид не найден" }, { status: 404 });
    }

    return NextResponse.json({ lead });
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

    if (!user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN", "SUPPORT"].includes(r)
    )) {
      return forbiddenResponse();
    }

    const body = await request.json();
    const { status, stage, assignedTo, lostReason } = body as {
      status?: string;
      stage?: string;
      assignedTo?: string;
      lostReason?: string;
    };

    const updateData: Record<string, string | null> = {};
    if (status) {
      updateData.status = status;
      if (status === "contacted") updateData.contacted_at = new Date().toISOString();
      if (status === "qualified") updateData.qualified_at = new Date().toISOString();
      if (status === "won") updateData.won_at = new Date().toISOString();
      if (status === "lost") {
        updateData.lost_at = new Date().toISOString();
        if (lostReason) updateData.lost_reason = lostReason;
      }
    }
    if (stage) updateData.stage = stage;
    if (assignedTo !== undefined) updateData.assigned_to = assignedTo;

    const { data: updated, error } = await supabaseAdmin
      .from("leads")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Создать активность о смене статуса
    if (status) {
      await supabaseAdmin.from("lead_activities").insert({
        lead_id: id,
        user_id: user.id,
        type: "status_change",
        description: `Статус изменён на ${status}`,
        completed_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ lead: updated });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    if (!user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN"].includes(r)
    )) {
      return forbiddenResponse("Только admin может удалять лиды");
    }

    const { error } = await supabaseAdmin
      .from("leads")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
