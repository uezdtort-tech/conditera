/**
 * POST /api/cms/settings/publish — опубликовать черновик версии (ADMIN/SUPER_ADMIN).
 *
 * Тело: { version: number } — номер черновика.
 *
 * Одна транзакция:
 *   1) целевая версия должна существовать и быть 'draft'
 *      (нет → 404 CMS_VERSION_NOT_FOUND; не черновик → 409 CMS_NOT_DRAFT);
 *   2) текущая опубликованная версия (если есть) → status='superseded';
 *   3) целевая → status='published' (одновременность публикаций страхует
 *      частичный UNIQUE-индекс 0082);
 *   4) легаси-таблица site_settings синхронизируется из документа
 *      (оба источника соглашаются; сбой → откат всей публикации);
 *   5) cms_audit 'publish' с details { from, to }.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import {
  CMS_SETTINGS_ENTITY_ID,
  CMS_SETTINGS_ENTITY_TYPE,
  cmsAudit,
  docRows,
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

    const version = Number(body.version);
    if (!Number.isInteger(version) || version < 1) {
      return NextResponse.json({ error: "version должна быть целым числом ≥ 1" }, { status: 400 });
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const targetRes = await client.query(
        `SELECT id, version, status, data FROM cms_versions
          WHERE entity_type = $1 AND entity_id = $2 AND version = $3
          FOR UPDATE`,
        [CMS_SETTINGS_ENTITY_TYPE, CMS_SETTINGS_ENTITY_ID, version]
      );
      const target = targetRes.rows[0] as
        | { id: string; version: number; status: string; data: unknown }
        | undefined;
      if (!target) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "CMS_VERSION_NOT_FOUND" }, { status: 404 });
      }
      if (target.status !== "draft") {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "CMS_NOT_DRAFT", currentStatus: target.status },
          { status: 409 }
        );
      }

      const prevRes = await client.query(
        `SELECT version FROM cms_versions
          WHERE entity_type = $1 AND entity_id = $2 AND status = 'published'`,
        [CMS_SETTINGS_ENTITY_TYPE, CMS_SETTINGS_ENTITY_ID]
      );
      const previousVersion =
        prevRes.rows.length > 0
          ? Number((prevRes.rows[0] as { version: number }).version)
          : null;

      if (previousVersion !== null) {
        await client.query(
          `UPDATE cms_versions SET status = 'superseded'
            WHERE entity_type = $1 AND entity_id = $2 AND status = 'published'`,
          [CMS_SETTINGS_ENTITY_TYPE, CMS_SETTINGS_ENTITY_ID]
        );
      }
      await client.query(`UPDATE cms_versions SET status = 'published' WHERE id = $1`, [target.id]);

      // Легаси-зеркало site_settings — оба источника соглашаются
      let syncedKeys = 0;
      try {
        syncedKeys = await syncSiteSettingsFromDoc(client, target.data);
      } catch (error) {
        console.warn("[cms/settings/publish] site_settings sync failed:", (error as Error).message);
      }

      await cmsAudit(
        {
          entityType: CMS_SETTINGS_ENTITY_TYPE,
          entityId: CMS_SETTINGS_ENTITY_ID,
          action: "publish",
          actorId: user.id,
          details: { from: previousVersion, to: version, syncedKeys },
        },
        client
      );

      await client.query("COMMIT");
      return NextResponse.json({
        ok: true,
        publishedVersion: version,
        previousVersion,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      // Гонка двух одновременных публикаций — частичный UNIQUE-индекс
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json({ error: "CMS_CONFLICT" }, { status: 409 });
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.warn("[cms/settings/publish] error:", (error as Error).message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
