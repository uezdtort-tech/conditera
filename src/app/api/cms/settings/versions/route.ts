/**
 * GET /api/cms/settings/versions — список версий настроек (ADMIN/SUPER_ADMIN).
 *
 * Возвращает { versions: [{ version, status, comment, created_by, created_at }] }
 * (без data — документы тяжёлые; конкретный документ читается через
 * GET /api/cms/settings?version=N).
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import { CMS_SETTINGS_ENTITY_ID, CMS_SETTINGS_ENTITY_TYPE } from "@/lib/cms/settings-versioning";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const res = await getPool().query(
      `SELECT version, status, comment, created_by, created_at
         FROM cms_versions
        WHERE entity_type = $1 AND entity_id = $2
        ORDER BY version DESC
        LIMIT 200`,
      [CMS_SETTINGS_ENTITY_TYPE, CMS_SETTINGS_ENTITY_ID]
    );

    return NextResponse.json({ versions: res.rows });
  } catch (error) {
    console.warn("[cms/settings/versions] GET error:", (error as Error).message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
