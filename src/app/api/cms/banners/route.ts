/**
 * GET    /api/cms/banners — список баннеров (public: active only)
 *                            ?include_inactive=true — полный список (ADMIN/SUPER_ADMIN/COPYWRITER)
 *                            ?position=... — фильтр по позиции
 * POST   /api/cms/banners — создать баннер (ADMIN/SUPER_ADMIN/COPYWRITER)
 * PATCH  /api/cms/banners — обновить баннер по id (ADMIN/SUPER_ADMIN/COPYWRITER), body: { id, ...fields }
 * DELETE /api/cms/banners — удалить баннер (?id=) (ADMIN/SUPER_ADMIN)
 *
 * Таблица cms_banners (миграция 0005): title, image_url, link_url, position,
 * text, cta_text, starts_at, ends_at, is_active, sort_order, created_at, updated_at.
 *
 * Тело POST/PATCH (camelCase): { title, imageUrl, linkUrl, position, sortOrder,
 * isActive, startAt, endAt, subtitle | text, buttonText | ctaText }.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { cmsAudit } from "@/lib/cms/settings-versioning";

export const runtime = "nodejs";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN", "COPYWRITER"] as const;

/** Аудит баннеров (Z-v32 E-1): best-effort, details — только нечувствительные поля. */
function auditBanner(
  action: "banner_create" | "banner_update" | "banner_delete",
  bannerId: string,
  actorId: string,
  details: Record<string, unknown>
): void {
  void cmsAudit({ entityType: "cms_banners", entityId: bannerId, action, actorId, details });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const position = searchParams.get("position");
    const includeInactive = searchParams.get("include_inactive") === "true";

    let query = supabaseAdmin
      .from("cms_banners")
      .select("*")
      .order("sort_order", { ascending: true });

    if (includeInactive) {
      // Полный список (включая скрытые) — только для админ-ролей
      const user = await getUserFromRequest(request);
      const isAdmin =
        !!user && (user.roles || []).some((r: string) => (ADMIN_ROLES as readonly string[]).includes(r));
      if (!isAdmin) query = query.eq("is_active", true);
    } else {
      query = query.eq("is_active", true);
    }
    if (position) query = query.eq("position", position);

    const { data, error } = await query;
    if (error) console.warn("[cms/banners] GET error:", error.message);
    return NextResponse.json({ banners: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN", "COPYWRITER"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = await request.json();
    const { data, error } = await supabaseAdmin
      .from("cms_banners")
      .insert({
        title: body.title || "Untitled",
        image_url: body.imageUrl || null,
        link_url: body.linkUrl || null,
        position: body.position || "hero",
        sort_order: body.sortOrder || 0,
        is_active: body.isActive !== false,
        starts_at: body.startAt || null,
        ends_at: body.endAt || null,
        text: body.text ?? body.subtitle ?? null,
        cta_text: body.ctaText ?? body.buttonText ?? null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: "DB error", details: error.message }, { status: 500 });
    auditBanner("banner_create", String(data.id), user.id, {
      title: data.title,
      position: data.position,
      isActive: data.is_active,
    });
    return NextResponse.json({ banner: data }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN", "COPYWRITER"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = await request.json();
    if (!body?.id) return NextResponse.json({ error: "id обязателен" }, { status: 400 });

    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) updates.title = String(body.title);
    if (body.imageUrl !== undefined) updates.image_url = body.imageUrl || null;
    if (body.linkUrl !== undefined) updates.link_url = body.linkUrl || null;
    if (body.position !== undefined) updates.position = String(body.position);
    if (body.sortOrder !== undefined) updates.sort_order = Number(body.sortOrder) || 0;
    if (body.isActive !== undefined) updates.is_active = Boolean(body.isActive);
    if (body.startAt !== undefined) updates.starts_at = body.startAt || null;
    if (body.endAt !== undefined) updates.ends_at = body.endAt || null;
    if (body.text !== undefined || body.subtitle !== undefined) {
      updates.text = (body.text ?? body.subtitle) || null;
    }
    if (body.ctaText !== undefined || body.buttonText !== undefined) {
      updates.cta_text = (body.ctaText ?? body.buttonText) || null;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Нет полей для обновления" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("cms_banners")
      .update(updates)
      .eq("id", String(body.id))
      .select()
      .single();

    if (error) return NextResponse.json({ error: "DB error", details: error.message }, { status: 500 });
    auditBanner("banner_update", String(data.id), user.id, {
      fields: Object.keys(updates), // только имена изменённых полей, без значений
    });
    return NextResponse.json({ banner: data });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id обязателен" }, { status: 400 });

    const { error } = await supabaseAdmin.from("cms_banners").delete().eq("id", id);
    if (error) return NextResponse.json({ error: "DB error", details: error.message }, { status: 500 });
    auditBanner("banner_delete", id, user.id, {});
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
