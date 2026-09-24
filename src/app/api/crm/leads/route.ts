/**
 * /api/crm/leads — CRUD для лидов (Kanban).
 *
 * GET — список лидов (только для CRM ролей)
 * POST — создать лид
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    // Только CRM роли
    if (!user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN", "SUPPORT", "MODERATOR", "CONFECTIONER"].includes(r)
    )) {
      return forbiddenResponse("Только CRM роли могут просматривать лиды");
    }

    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status");

    let query = supabaseAdmin.from("leads").select("*");

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error } = await query.order("updated_at", { ascending: false }).limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ leads: data });
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

    // Только CRM роли
    if (!user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN", "SUPPORT"].includes(r)
    )) {
      return forbiddenResponse("Только CRM роли могут создавать лиды");
    }

    const body = await request.json();
    const { name, email, phone, company, source, inquiry, budget, eventDate, city } = body as {
      name: string;
      email?: string;
      phone?: string;
      company?: string;
      source?: string;
      inquiry?: string;
      budget?: number;
      eventDate?: string;
      city?: string;
    };

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const { data: lead, error } = await supabaseAdmin
      .from("leads")
      .insert({
        name,
        email: email || null,
        phone: phone || null,
        company: company || null,
        source: source || "website",
        inquiry: inquiry || null,
        budget: budget || null,
        event_date: eventDate || null,
        city: city || null,
        status: "new",
        stage: "awareness",
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Создать первую активность
    await supabaseAdmin.from("lead_activities").insert({
      lead_id: lead.id,
      user_id: user.id,
      type: "note",
      description: "Лид создан",
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({ lead }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
