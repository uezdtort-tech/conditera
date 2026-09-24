/**
 * GET    /api/franchise-exchange/listing/:id — получить листинг франшизы
 * PUT    /api/franchise-exchange/listing/:id — обновить (владелец или ADMIN)
 * DELETE /api/franchise-exchange/listing/:id — снять с продажи (soft-delete: status=withdrawn)
 *
 * Auth: GET public, PUT/DELETE — владелец листинга или ADMIN
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { data: listing, error } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("id", id)
      .eq("action", "franchise_listing")
      .maybeSingle();

    if (error || !listing) {
      return NextResponse.json({ error: "Листинг не найден" }, { status: 404 });
    }

    // Increment views (non-blocking)
    const meta = (listing.metadata as any) || {};
    supabaseAdmin
      .from("audit_log")
      .update({ metadata: { ...meta, views: (meta.views || 0) + 1 } })
      .eq("id", id)
      .then(() => {});

    return NextResponse.json({ listing });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const body = await request.json();
    const { price, description, status } = body;

    // Найти листинг
    const { data: listing, error: fetchErr } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("id", id)
      .eq("action", "franchise_listing")
      .maybeSingle();

    if (fetchErr || !listing) {
      return NextResponse.json({ error: "Листинг не найден" }, { status: 404 });
    }

    // Проверка прав — владелец или ADMIN
    if (listing.user_id !== user.id) {
      const adminCheck = await isAdmin(user.id);
      if (!adminCheck) {
        return NextResponse.json({ error: "Нет прав" }, { status: 403 });
      }
    }

    const meta = (listing.metadata as any) || {};
    if (price) meta.price = price;
    if (description) meta.description = description;
    if (status) meta.status = status;

    const { error: updateErr } = await supabaseAdmin
      .from("audit_log")
      .update({ metadata: meta })
      .eq("id", id);

    if (updateErr) {
      return NextResponse.json({ error: "Ошибка обновления" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { data: listing, error: fetchErr } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("id", id)
      .eq("action", "franchise_listing")
      .maybeSingle();

    if (fetchErr || !listing) {
      return NextResponse.json({ error: "Листинг не найден" }, { status: 404 });
    }

    if (listing.user_id !== user.id) {
      const adminCheck = await isAdmin(user.id);
      if (!adminCheck) {
        return NextResponse.json({ error: "Нет прав" }, { status: 403 });
      }
    }

    // Soft-delete: status=withdrawn
    const meta = (listing.metadata as any) || {};
    meta.status = "withdrawn";
    meta.withdrawnAt = new Date().toISOString();

    await supabaseAdmin.from("audit_log").update({ metadata: meta }).eq("id", id);

    return NextResponse.json({ success: true, status: "withdrawn" });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
