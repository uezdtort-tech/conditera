/**
 * /api/cms/nav-menu — CRUD пунктов навигации (cms_nav_menu, миграция 0005).
 *
 * GET    — список пунктов. Public: только is_active=true, parent_id IS NULL
 *          (плоский список v1). ?include_inactive=true и/или ?location=... —
 *          полный список по локации, только ADMIN/SUPER_ADMIN.
 * POST   — создать пункт (ADMIN/SUPER_ADMIN): { location, label, url, icon?,
 *          sortOrder?, isActive? }.
 * PATCH  — обновить пункт по body.id (ADMIN/SUPER_ADMIN).
 * DELETE — удалить пункт (?id=) (ADMIN/SUPER_ADMIN).
 *
 * location: header | footer | mobile. url — имя SPA-view (catalog,
 * promotions, ...) или внешний http(s)/mailto/tel-адрес.
 *
 * Иерархия (parent_id) и таргетинг (show_for_roles/show_for_authenticated)
 * существуют в схеме, но наружу в v1 не выставляются — плоский список.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { cmsAudit } from "@/lib/cms/settings-versioning";

export const runtime = "nodejs";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;
const LOCATIONS = ["header", "footer", "mobile"] as const;

/** Аудит навигации: best-effort, details — только нечувствительные поля. */
function auditNav(
  action: "nav_create" | "nav_update" | "nav_delete",
  itemId: string,
  actorId: string,
  details: Record<string, unknown>
): void {
  void cmsAudit({ entityType: "cms_nav_menu", entityId: itemId, action, actorId, details });
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

// ==================== GET ====================

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const location = str(searchParams.get("location"), 20);
    const includeInactive = searchParams.get("include_inactive") === "true";

    let isAdmin = false;
    if (includeInactive) {
      const user = await getUserFromRequest(request);
      isAdmin =
        !!user && (user.roles || []).some((r: string) => (ADMIN_ROLES as readonly string[]).includes(r));
    }

    let query = supabaseAdmin
      .from("cms_nav_menu")
      .select("*")
      .order("sort_order", { ascending: true });

    if (!(includeInactive && isAdmin)) {
      query = query.eq("is_active", true).is("parent_id", null);
    }
    if (location && (LOCATIONS as readonly string[]).includes(location)) {
      query = query.eq("location", location);
    }

    const { data, error } = await query;
    if (error) console.warn("[cms/nav-menu] GET error:", error.message);
    return NextResponse.json({ items: data || [] });
  } catch (error) {
    // Fail-safe: публичный рендер никогда не падает из-за CMS.
    console.warn("[cms/nav-menu] GET fatal:", (error as Error).message);
    return NextResponse.json({ items: [] });
  }
}

// ==================== POST ====================

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, [...ADMIN_ROLES]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = await request.json().catch(() => null);
    const b = (body ?? {}) as Record<string, unknown>;
    const label = str(b.label, 100);
    const url = str(b.url, 500);
    if (!label || !url) {
      return NextResponse.json({ error: "label и url обязательны" }, { status: 400 });
    }
    const locationRaw = str(b.location, 20) || "header";
    const location = (LOCATIONS as readonly string[]).includes(locationRaw) ? locationRaw : "header";

    const { data, error } = await supabaseAdmin
      .from("cms_nav_menu")
      .insert({
        location,
        label,
        url,
        icon: str(b.icon, 60),
        sort_order: Number(b.sortOrder) || 0,
        is_active: b.isActive !== false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: "DB error", details: error.message }, { status: 500 });
    auditNav("nav_create", String(data.id), user.id, { location, isActive: data.is_active });
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Ошибка", detail: (error as Error).message },
      { status: 500 }
    );
  }
}

// ==================== PATCH ====================

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, [...ADMIN_ROLES]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = await request.json().catch(() => null);
    const b = (body ?? {}) as Record<string, unknown>;
    const id = str(b.id, 100);
    if (!id) return NextResponse.json({ error: "id обязателен" }, { status: 400 });

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.label !== undefined) {
      const label = str(b.label, 100);
      if (!label) return NextResponse.json({ error: "label не может быть пустым" }, { status: 400 });
      updates.label = label;
    }
    if (b.url !== undefined) {
      const url = str(b.url, 500);
      if (!url) return NextResponse.json({ error: "url не может быть пустым" }, { status: 400 });
      updates.url = url;
    }
    if (b.icon !== undefined) updates.icon = str(b.icon, 60);
    if (b.location !== undefined) {
      const loc = str(b.location, 20) || "header";
      updates.location = (LOCATIONS as readonly string[]).includes(loc) ? loc : "header";
    }
    if (b.sortOrder !== undefined) updates.sort_order = Number(b.sortOrder) || 0;
    if (b.isActive !== undefined) updates.is_active = Boolean(b.isActive);

    if (Object.keys(updates).length === 1) {
      return NextResponse.json({ error: "Нет полей для обновления" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("cms_nav_menu")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: "DB error", details: error.message }, { status: 500 });
    auditNav("nav_update", id, user.id, { fields: Object.keys(updates).filter((k) => k !== "updated_at") });
    return NextResponse.json({ item: data });
  } catch (error) {
    return NextResponse.json(
      { error: "Ошибка", detail: (error as Error).message },
      { status: 500 }
    );
  }
}

// ==================== DELETE ====================

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, [...ADMIN_ROLES]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id обязателен" }, { status: 400 });

    const { error } = await supabaseAdmin.from("cms_nav_menu").delete().eq("id", id);
    if (error) return NextResponse.json({ error: "DB error", details: error.message }, { status: 500 });
    auditNav("nav_delete", id, user.id, {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Ошибка", detail: (error as Error).message },
      { status: 500 }
    );
  }
}
