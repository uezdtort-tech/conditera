/**
 * GET /api/fillings/:id/slice — получить конфигурацию среза для начинки (public)
 * PUT /api/fillings/:id/slice — обновить sliceImage/sliceConfig (владелец или ADMIN)
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
    const { id: fillingId } = await params;
    const { data: filling, error } = await supabaseAdmin
      .from("fillings")
      .select("id, name, color, slice_image, slice_config, consistency, category")
      .eq("id", fillingId)
      .maybeSingle();

    if (error || !filling) {
      return NextResponse.json({ error: "Начинка не найдена" }, { status: 404 });
    }
    return NextResponse.json({ filling });
  } catch (error: any) {
    return NextResponse.json({ error: "Internal error", detail: error?.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: fillingId } = await params;
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const adminCheck = await isAdmin(user.id);
    const { data: existing } = await supabaseAdmin
      .from("fillings")
      .select("created_by")
      .eq("id", fillingId)
      .maybeSingle();

    if (existing?.created_by && existing.created_by !== user.id && !adminCheck) {
      return NextResponse.json({ error: "Только создатель начинки или админ может редактировать срез" }, { status: 403 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.sliceImage !== undefined) updateData.slice_image = body.sliceImage;
    if (body.sliceConfig !== undefined) updateData.slice_config = body.sliceConfig;

    const { data: updated, error } = await supabaseAdmin
      .from("fillings")
      .update(updateData)
      .eq("id", fillingId)
      .select("id, name, slice_image, slice_config")
      .single();

    if (error) {
      return NextResponse.json({ error: "Не удалось обновить" }, { status: 500 });
    }
    return NextResponse.json({ filling: updated });
  } catch (error: any) {
    return NextResponse.json({ error: "Internal error", detail: error?.message }, { status: 500 });
  }
}
