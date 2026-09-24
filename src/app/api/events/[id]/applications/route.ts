/**
 * GET /api/events/:id/applications — список заявок на мероприятие.
 *
 * Auth: EVENT_ORGANIZER или ADMIN
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const guard = await requireAnyRole(user.id, ["EVENT_ORGANIZER", "ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("action", "event_apply")
      .eq("entity_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[events/:id/applications] query error:", error.message);
    }

    return NextResponse.json({ applications: data || [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
