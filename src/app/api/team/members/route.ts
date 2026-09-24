/**
 * GET  /api/team/members — список участников команды.
 * POST /api/team/members — пригласить участника (создать TeamInvitation).
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

    const teamId = user.id;

    const [membersResult, invitationsResult] = await Promise.all([
      supabaseAdmin.from("team_members").select("*").eq("team_id", teamId).order("joined_at", { ascending: true }),
      supabaseAdmin.from("team_invitations").select("*").eq("team_id", teamId).eq("status", "pending").order("created_at", { ascending: false }),
    ]);

    const members = membersResult.data || [];
    const invitations = invitationsResult.data || [];

    // Get user profiles for members
    const userIds = members.map((m: any) => m.user_id).filter(Boolean);
    let userMap = new Map<string, any>();
    if (userIds.length > 0) {
      const { data: users } = await supabaseAdmin
        .from("profiles")
        .select("id, name, email, avatar_url")
        .in("id", userIds);
      for (const u of users || []) {
        userMap.set(u.id, u);
      }
    }

    const membersWithUsers = members.map((m: any) => ({
      ...m,
      user: userMap.get(m.user_id) || null,
    }));

    return NextResponse.json({ members: membersWithUsers, invitations, total: membersWithUsers.length });
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
    const { inviteeEmail, role, permissions } = body;

    if (!inviteeEmail) {
      return NextResponse.json({ error: "Укажите inviteeEmail" }, { status: 400 });
    }

    const { data: invitation, error } = await supabaseAdmin
      .from("team_invitations")
      .insert({
        team_id: user.id,
        invitee_email: inviteeEmail,
        role: role || "member",
        permissions: permissions || {},
        status: "pending",
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "DB error", details: error.message }, { status: 500 });
    }

    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
