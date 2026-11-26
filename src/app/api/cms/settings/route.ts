/**
 * /api/cms/settings — публичные настройки и версионируемый CMS-документ.
 *
 * Источник опубликованного состояния — cms_versions. site_settings остаётся
 * read/write-зеркалом для старых компонентов до завершения миграции.
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
  getLatestDraftVersion,
  getLegacySettingsRows,
  getPublishedSettingsVersion,
  getVersionRow,
  normalizeDocRows,
} from "@/lib/cms/settings-versioning";

export const runtime = "nodejs";
const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;

function adminDenied(guard: Response): NextResponse {
  return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const versionParam = request.nextUrl.searchParams.get("version");

  // Исторические версии доступны только администраторам.
  if (versionParam !== null) {
    const version = Number(versionParam);
    if (!Number.isInteger(version) || version < 1) {
      return NextResponse.json({ error: "Некорректный номер версии" }, { status: 400 });
    }

    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    const guard = await requireAnyRole(user.id, [...ADMIN_ROLES]);
    if (guard) return adminDenied(guard);

    try {
      const row = await getVersionRow(version);
      if (!row) return NextResponse.json({ error: "CMS_VERSION_NOT_FOUND" }, { status: 404 });
      return NextResponse.json(
        {
          version: Number(row.version),
          status: row.status,
          comment: row.comment ?? null,
          createdBy: row.created_by ?? null,
          createdAt: row.created_at ?? null,
          settings: docRows(row.data),
        },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    } catch (error) {
      console.warn("[cms/settings] version preview failed:", (error as Error).message);
      return NextResponse.json({ error: "Не удалось загрузить версию" }, { status: 500 });
    }
  }

  // Публичное чтение не требует сессии. При отсутствии первой публикации
  // используем legacy-таблицу, сохраняя обратную совместимость.
  try {
    const published = await getPublishedSettingsVersion();
    if (published) {
      return NextResponse.json(
        { settings: docRows(published.data), version: published.version },
        { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
      );
    }
    const settings = await getLegacySettingsRows();
    return NextResponse.json(
      { settings, version: null },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (error) {
    // Публичный сайт должен переживать недоступность CMS-БД: безопасный
    // пустой документ лучше 500 на каждой публичной странице.
    console.warn("[cms/settings] public GET failed:", (error as Error).message);
    return NextResponse.json(
      { settings: [], version: null },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const guard = await requireAnyRole(user.id, [...ADMIN_ROLES]);
  if (guard) return adminDenied(guard);

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Ожидается JSON-объект" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const legacyKey = body.key;
  const legacyValue = body.value;
  const legacyUpdate = legacyKey !== undefined || legacyValue !== undefined;
  if (legacyUpdate && (
    typeof legacyKey !== "string" ||
    !/^[a-zA-Z0-9_.-]{1,120}$/.test(legacyKey) ||
    typeof legacyValue !== "string" ||
    legacyValue.length > 20000
  )) {
    return NextResponse.json({ error: "Некорректный ключ или значение настройки" }, { status: 400 });
  }
  if (!legacyUpdate && !Array.isArray(body.settings)) {
    return NextResponse.json({ error: "settings должен быть массивом" }, { status: 400 });
  }
  if (body.expectedPublishedVersion !== undefined &&
      (!Number.isInteger(body.expectedPublishedVersion) || Number(body.expectedPublishedVersion) < 0)) {
    return NextResponse.json({ error: "expectedPublishedVersion должен быть целым числом" }, { status: 400 });
  }

  const comment = typeof body.comment === "string" ? body.comment.slice(0, 500) : null;
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const published = await getPublishedSettingsVersion(client);
    const publishedVersion = published?.version ?? null;

    if (body.expectedPublishedVersion !== undefined &&
        Number(body.expectedPublishedVersion) !== (publishedVersion ?? 0)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "CMS_CONFLICT", currentVersion: publishedVersion },
        { status: 409 }
      );
    }

    const currentDraft = await getLatestDraftVersion(client);
    let settings: ReturnType<typeof normalizeDocRows>;

    if (legacyUpdate) {
      const base = currentDraft?.data ?? published?.data ?? { settings: [] };
      settings = docRows(base);
      const existing = settings.find((row) => row.key === legacyKey);
      if (existing) {
        existing.value = legacyValue as string;
      } else {
        settings.push({
          id: crypto.randomUUID(),
          key: legacyKey as string,
          value: legacyValue as string,
          category: "general",
          description: null,
        });
      }
    } else {
      settings = normalizeDocRows(body.settings as unknown[]);
      if (settings.length !== (body.settings as unknown[]).length) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Одна или несколько настроек имеют неверный формат" }, { status: 400 });
      }
    }

    const document = { settings };
    let draftVersion: number;

    if (currentDraft) {
      const updated = await client.query(
        `UPDATE cms_versions
            SET data = $1::jsonb, comment = COALESCE($2, comment)
          WHERE id = $3
          RETURNING version`,
        [JSON.stringify(document), comment, currentDraft.id]
      );
      draftVersion = Number(updated.rows[0]?.version ?? currentDraft.version);
    } else {
      const maxRes = await client.query(
        `SELECT COALESCE(MAX(version), 0) AS maxv
           FROM cms_versions
          WHERE entity_type = $1 AND entity_id = $2`,
        [CMS_SETTINGS_ENTITY_TYPE, CMS_SETTINGS_ENTITY_ID]
      );
      draftVersion = Number(maxRes.rows[0]?.maxv ?? 0) + 1;
      await client.query(
        `INSERT INTO cms_versions
           (entity_type, entity_id, version, data, status, comment, created_by)
         VALUES ($1, $2, $3, $4::jsonb, 'draft', $5, $6)`,
        [
          CMS_SETTINGS_ENTITY_TYPE,
          CMS_SETTINGS_ENTITY_ID,
          draftVersion,
          JSON.stringify(document),
          comment,
          user.id,
        ]
      );
    }

    await cmsAudit(
      {
        entityType: CMS_SETTINGS_ENTITY_TYPE,
        entityId: CMS_SETTINGS_ENTITY_ID,
        action: "save_draft",
        actorId: user.id,
        details: { version: draftVersion, keys: settings.map((row) => row.key) },
      },
      client
    );

    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      draft: { version: draftVersion, status: "draft" },
      publishedVersion,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "CMS_CONFLICT" }, { status: 409 });
    }
    console.warn("[cms/settings] PUT failed:", (error as Error).message);
    return NextResponse.json({ error: "Не удалось сохранить настройки" }, { status: 500 });
  } finally {
    client.release();
  }
}
