import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import { cmsAudit } from "@/lib/cms/settings-versioning";
import { normalizeCmsBlockOrder } from "@/lib/cms-section-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const guard = await requireAnyRole(user.id, [...ADMIN_ROLES]);
  if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

  const body = await request.json().catch(() => null) as { sectionSlug?: unknown; blockIds?: unknown } | null;
  const sectionSlug = typeof body?.sectionSlug === "string" ? body.sectionSlug : "";
  const blockIds = normalizeCmsBlockOrder(body?.blockIds);
  if (!/^[a-z0-9][a-z0-9_-]{0,59}$/i.test(sectionSlug) || !blockIds) {
    return NextResponse.json({ error: "INVALID_BLOCK_ORDER" }, { status: 400 });
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`conditera:cms_section_blocks:${sectionSlug}`]);
    const section = await client.query(
      "SELECT id FROM public.cms_sections WHERE slug = $1 FOR UPDATE",
      [sectionSlug]
    );
    if (section.rowCount !== 1) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "CMS_SECTION_NOT_FOUND" }, { status: 404 });
    }
    const sectionId = String(section.rows[0].id);
    const current = await client.query(
      'SELECT id FROM public.cms_section_blocks WHERE "sectionId" = $1 ORDER BY "order", id FOR UPDATE',
      [sectionId]
    );
    const currentIds = current.rows.map((row) => String(row.id));
    if (currentIds.length !== blockIds.length || currentIds.some((id) => !blockIds.includes(id))) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "BLOCK_ORDER_STALE_OR_INCOMPLETE" }, { status: 409 });
    }

    if (blockIds.length > 0) {
      await client.query(
        `UPDATE public.cms_section_blocks AS b
         SET "order" = ordered.position - 1, "updatedAt" = CURRENT_TIMESTAMP
         FROM unnest($2::text[]) WITH ORDINALITY AS ordered(id, position)
         WHERE b.id = ordered.id AND b."sectionId" = $1`,
        [sectionId, blockIds]
      );
    }
    await cmsAudit({
      entityType: "cms_section_blocks",
      entityId: sectionId,
      action: "block_reorder",
      actorId: user.id,
      details: { sectionSlug, blockCount: blockIds.length, blockIds },
    }, client);
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, sectionSlug, blockIds });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[cms/blocks/reorder] POST failed:", (error as Error).message);
    return NextResponse.json({ error: "CMS_BLOCK_REORDER_FAILED" }, { status: 500 });
  } finally {
    client.release();
  }
}
