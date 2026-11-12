/**
 * POST /api/cms/settings/rollback — откат к предыдущей версии (ADMIN/SUPER_ADMIN).
 *
 * Тело: { toVersion: number } — номер ЛЮБОЙ существующей версии (published
 * или superseded): её документ становится ОСНОВОЙ НОВОЙ версии, которая
 * сразу публикуется (история не переписывается — создаётся новая запись).
 *
 * Одна транзакция:
 *   1) исходная версия должна существовать (нет → 404 CMS_VERSION_NOT_FOUND);
 *   2) следующая версия = MAX(version)+1, status='published',
 *      data = копия документа исходной версии;
 *   3) прежняя опубликованная → 'superseded';
 *   4) легаси-таблица site_settings синхронизируется;
 *   5) cms_audit 'rollback' с details { from, to, rolledBackTo }.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import {
  CMS_SETTINGS_ENTITY_ID,
  CMS_SETTINGS_ENTITY_TYPE,
  cmsAudit,
  syncSiteSettingsFromDoc,
} from "@/lib/cms/settings-versioning";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Ожидается JSON-объект" }, { status: 400 });
    }

    const toVersion = Number(body.toVersion);
    if (!Number.isInteger(toVersion) || toVersion < 1) {
      return NextResponse.json({ error: "toVersion должна быть целым числом ≥ 1" }, { status: 400 });
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const srcRes = await client.query(
        `SELECT version, data FROM cms_versions
          WHERE entity_type = $1 AND entity_id = $2 AND version = $3`,
        [CMS_SETTINGS_ENTITY_TYPE, CMS_SETTINGS_ENTITY_ID, toVersion]
      );
      const src = srcRes.rows[0] as { version: number; data: unknown } | undefined;
      if (!src) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "CMS_VERSION_NOT_FOUND" }, { status: 404 });
      }

      const prevRes = await client.query(
        `SELECT version FROM cms_versions
          WHERE entity_type = $1 AND entity_id = $2 AND status = 'published'`,
        [CMS_SETTINGS_ENTITY_TYPE, CMS_SETTINGS_ENTITY_ID]
      );
      const previousVersion =
        prevRes.rows.length > 0 ? Number((prevRes.rows[0] as { version: number }).version) : null;

      if (previousVersion !== null) {
        await client.query(
          `UPDATE cms_versions SET status = 'superseded'
            WHERE entity_type = $1 AND entity_id = $2 AND status = 'published'`,
          [CMS_SETTINGS_ENTITY_TYPE, CMS_SETTINGS_ENTITY_ID]
        );
      }

      const maxRes = await client.query(
        `SELECT COALESCE(MAX(version), 0) AS maxv FROM cms_versions
          WHERE entity_type = $1 AND entity_id = $2`,
        [CMS_SETTINGS_ENTITY_TYPE, CMS_SETTINGS_ENTITY_ID]
      );
      const newVersion = Number((maxRes.rows[0] as { maxv: number | string }).maxv) + 1;

      await client.query(
        `INSERT INTO cms_versions (entity_type, entity_id, version, data, status, comment, created_by)
         VALUES ($1, $2, $3, $4::jsonb, 'published', $5, $6)`,
        [
          CMS_SETTINGS_ENTITY_TYPE,
          CMS_SETTINGS_ENTITY_ID,
          newVersion,
          JSON.stringify(src.data),
          `Откат к версии ${toVersion}`,
          user.id,
        ]
      );

      let syncedKeys = 0;
      try {
        syncedKeys = await syncSiteSettingsFromDoc(client, src.data);
      } catch (error) {
        console.warn("[cms/settings/rollback] site_settings sync failed:", (error as Error).message);
      }

      await cmsAudit(
        {
          entityType: CMS_SETTINGS_ENTITY_TYPE,
          entityId: CMS_SETTINGS_ENTITY_ID,
          action: "rollback",
          actorId: user.id,
          details: { from: previousVersion, to: newVersion, rolledBackTo: toVersion },
        },
        client
      );

      await client.query("COMMIT");
      return NextResponse.json({
        ok: true,
        version: newVersion,
        rolledBackTo: toVersion,
        previousVersion,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json({ error: "CMS_CONFLICT" }, { status: 409 });
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.warn("[cms/settings/rollback] error:", (error as Error).message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
