import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import { cmsAudit } from "@/lib/cms/settings-versioning";
import { normalizeCmsSectionOrder } from "@/lib/cms-section-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const includeInactive = request.nextUrl.searchParams.get("include_inactive") === "true";
    if (includeInactive) {
      const user = await getUserFromRequest(request);
      if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
      const guard = await requireAnyRole(user.id, [...ADMIN_ROLES]);
      if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });
    }
    const where = includeInactive ? "" : 'WHERE "visible" = true';
    const result = await getPool().query(
      `SELECT id, slug, title, visible, "sortOrder" AS "sortOrder"
       FROM public.cms_sections ${where}
       ORDER BY "sortOrder" ASC, slug ASC`
    );
    return NextResponse.json({ sections: result.rows }, {
      headers: { "Cache-Control": includeInactive ? "private, no-store" : "public, s-maxage=30, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("[cms/sections] GET failed:", (error as Error).message);
    return NextResponse.json({ error: "CMS_SECTIONS_UNAVAILABLE" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const guard = await requireAnyRole(user.id, [...ADMIN_ROLES]);
  if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

  const body = await request.json().catch(() => null) as { sections?: unknown } | null;
  const sections = normalizeCmsSectionOrder(body?.sections);
  if (!sections) return NextResponse.json({ error: "INVALID_SECTION_ORDER" }, { status: 400 });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('conditera:cms_sections:reorder'))");

    const updated = [];
    for (const section of sections) {
      const result = await client.query(
        `UPDATE public.cms_sections
         SET "sortOrder" = $2,
             "visible" = $3,
             title = COALESCE($4, title),
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE slug = $1
         RETURNING id, slug, title, visible, "sortOrder" AS "sortOrder"`,
        [section.slug, section.sortOrder, section.visible, section.title ?? null]
      );
      if (result.rowCount !== 1) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "CMS_SECTION_NOT_FOUND", slug: section.slug }, { status: 404 });
      }
      updated.push(result.rows[0]);
      await cmsAudit({
        entityType: "cms_sections",
        entityId: String(result.rows[0].id),
        action: "section_reorder",
        actorId: user.id,
        details: { slug: section.slug, sortOrder: section.sortOrder, visible: section.visible },
      }, client);
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, sections: updated });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[cms/sections] PUT failed:", (error as Error).message);
    return NextResponse.json({ error: "CMS_SECTION_UPDATE_FAILED" }, { status: 500 });
  } finally {
    client.release();
  }
}
