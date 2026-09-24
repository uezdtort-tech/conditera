/**
 * GET  /api/team/tasks — список задач команды (kanban-доска)
 * POST /api/team/tasks — создать задачу
 *
 * Auth: CONFECTIONER или STUDIO
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["CONFECTIONER", "STUDIO"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let query = supabaseAdmin
      .from("team_tasks")
      .select("*")
      .eq("team_id", user.id)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);

    const { data: tasks, error } = await query;
    if (error) console.warn("[team/tasks] GET error:", error.message);

    // Group by status for kanban
    const grouped: Record<string, any[]> = {};
    for (const t of tasks || []) {
      const s = t.status || "todo";
      if (!grouped[s]) grouped[s] = [];
      grouped[s].push(t);
    }

    return NextResponse.json({ tasks: tasks || [], grouped, total: (tasks || []).length });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["CONFECTIONER", "STUDIO"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = await request.json();

    const { data: task, error } = await supabaseAdmin
      .from("team_tasks")
      .insert({
        team_id: user.id,
        title: body.title || "Untitled",
        description: body.description || null,
        status: body.status || "todo",
        priority: body.priority || 0,
        assigned_to: body.assignedTo || null,
        due_date: body.dueDate || null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "DB error", details: error.message }, { status: 500 });
    }

    return NextResponse.json({ task }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
