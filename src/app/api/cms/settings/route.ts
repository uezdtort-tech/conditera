/**
 * GET /api/cms/settings — все настройки.
 *   • public (без ?version=) — ОПУБЛИКОВАННЫЙ документ cms_versions
 *     (status='published') в прежнем контракте { settings: [...] } +
 *     аддитивное поле version (номер опубликованной версии; null — пока
 *     публикаций нет, читается легаси-таблица site_settings).
 *     Fail-safe: любой сбой публичного чтения → 200 { settings: [], version: null }
 *     (публичный рендер никогда не падает из-за CMS).
 *   • ?version=N — только ADMIN/SUPER_ADMIN: конкретная версия + meta
 *     (status, comment, createdAt) — используется админ-предпросмотром.
 * PUT /api/cms/settings — ADMIN/SUPER_ADMIN: создать/обновить ЧЕРНОВИК
 *     версии. Тело: { settings: [...] } (полный документ) ИЛИ легаси
 *     { key, value } (точечная правка поверх последнего черновика/публикации),
 *     опционально { comment, expectedPublishedVersion }.
 *     Оптимистичная блокировка: если expectedPublishedVersion не совпадает с
 *     текущей опубликованной → 409 { error: 'CMS_CONFLICT', currentVersion }.
 *     Публикация — отдельным POST /api/cms/settings/publish.
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

/** Ровно та же ошибка-форма, что и раньше, но без утечки detail наружу. */
function serverError(): NextResponse {
  return NextResponse.json({ error: "Server error" }, { status: 500 });
}

function parseVersionParam(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const versionParam = searchParams.get("version");

    // --- Админ-предпросмотр конкретной версии ---
    if (versionParam !== null) {
      const user = await getUserFromRequest(request);
      if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

      const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
      if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

      const version = parseVersionParam(versionParam);
      if (!version) {
        return NextResponse.json({ error: "version должна быть целым числом ≥ 1" }, { status: 400 });
      }
      const row = await getVersionRow(version);
      if (!row) {
        return NextResponse.json({ error: "CMS_VERSION_NOT_FOUND" }, { status: 404 });
      }
      return NextResponse.json({
        version: row.version,
        status: row.status,
        comment: row.comment,
        createdAt: row.created_at,
        settings: docRows(row.data),
      });
    }

    // --- Публичное чтение: cms_versions published → фолбэк site_settings ---
    try {
      const published = await getPublishedSettingsVersion();
      if (published) {
        return NextResponse.json({
          settings: docRows(published.data),
          version: published.version,
        });
      }
    } catch (error) {
      console.warn("[cms/settings] published read failed, legacy fallback:", (error as Error).message);
    }

    try {
      const rows = await getLegacySettingsRows();
      return NextResponse.json({ settings: rows, version: null });
    } catch (error) {
      console.warn("[cms/settings] GET error:", (error as Error).message);
      // Fail-safe: пустой успешный ответ вместо 500 (публичные страницы
      // рендерят хардкод-фолбэк; контракт объекта сохранён).
      return NextResponse.json({ settings: [], version: null });
    }
  } catch {
    return NextResponse.json({ settings: [], version: null });
  }
}

/** Строковое/числовое/булево значение настройки → string, иначе null. */
function coerceValue(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return String(v);
  return null;
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error();
    } catch {
      return NextResponse.json({ error: "Ожидается JSON-объект" }, { status: 400 });
    }

    const comment =
      typeof body.comment === "string" && body.comment.trim()
        ? body.comment.trim().slice(0, 500)
        : null;
    const expected =
      body.expectedPublishedVersion === undefined
        ? undefined
        : Number(body.expectedPublishedVersion);
    if (expected !== undefined && (!Number.isInteger(expected) || expected < 0)) {
      return NextResponse.json(
        { error: "expectedPublishedVersion должна быть целым числом ≥ 0" },
        { status: 400 }
      );
    }

    // --- Формируем новый документ черновика ---
    let nextRows: ReturnType<typeof normalizeDocRows>;
    const bodySettings: unknown = body.settings;
    const settingsArr = Array.isArray(bodySettings)
      ? bodySettings
      : bodySettings !== null &&
          typeof bodySettings === "object" &&
          Array.isArray((bodySettings as Record<string, unknown>).settings)
        ? ((bodySettings as Record<string, unknown>).settings as unknown[])
        : null;

    if (settingsArr) {
      nextRows = normalizeDocRows(settingsArr);
      if (nextRows.length === 0) {
        return NextResponse.json(
          { error: "settings: нужен непустой массив строк { key, value }" },
          { status: 400 }
        );
      }
    } else {
      // Легаси-форма: точечная правка одного ключа поверх базы
      const key = typeof body.key === "string" ? body.key.trim() : "";
      const value = coerceValue(body.value);
      if (!key || value === null) {
        return NextResponse.json(
          { error: "Нужны settings (массив) либо key (string) и value (string)" },
          { status: 400 }
        );
      }
      // База: последний черновик → публикация → легаси-таблица
      let base: ReturnType<typeof docRows> = [];
      try {
        const draft = await getLatestDraftVersion();
        if (draft) base = docRows(draft.data);
      } catch (error) {
        console.warn("[cms/settings] draft read failed:", (error as Error).message);
      }
      if (base.length === 0) {
        try {
          const published = await getPublishedSettingsVersion();
          if (published) base = docRows(published.data);
        } catch (error) {
          console.warn("[cms/settings] published read failed:", (error as Error).message);
        }
      }
      if (base.length === 0) {
        try {
          const legacy = await getLegacySettingsRows();
          base = normalizeDocRows(legacy);
        } catch (error) {
          console.warn("[cms/settings] legacy read failed:", (error as Error).message);
        }
      }
      const idx = base.findIndex((r) => r.key === key);
      if (idx >= 0) base[idx] = { ...base[idx], value };
      else base.push({ id: crypto.randomUUID(), key, value, category: "general", description: null });
      nextRows = base;
    }

    // --- Оптимистичная блокировка по опубликованной версии ---
    let publishedVersion: number | null = null;
    try {
      const published = await getPublishedSettingsVersion();
      publishedVersion = published ? published.version : null;
    } catch (error) {
      console.warn("[cms/settings] published read failed:", (error as Error).message);
    }
    if (expected !== undefined && (publishedVersion ?? 0) !== expected) {
      return NextResponse.json(
        { error: "CMS_CONFLICT", currentVersion: publishedVersion },
        { status: 409 }
      );
    }

    // --- Черновик: обновить последний draft ИЛИ создать следующую версию ---
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      let draftVersion: number;
      const draft = await getLatestDraftVersion(client);
      if (draft) {
        const upd = await client.query(
          `UPDATE cms_versions
              SET data = $1::jsonb, comment = COALESCE($2, comment), created_by = $3, created_at = now()
            WHERE id = $4
            RETURNING version`,
          [
            JSON.stringify({ settings: nextRows }),
            comment,
            user.id,
            draft.id,
          ]
        );
        draftVersion = Number((upd.rows[0] as { version: number }).version);
      } else {
        const maxRes = await client.query(
          `SELECT COALESCE(MAX(version), 0) AS maxv FROM cms_versions
            WHERE entity_type = $1 AND entity_id = $2`,
          [CMS_SETTINGS_ENTITY_TYPE, CMS_SETTINGS_ENTITY_ID]
        );
        draftVersion = Number((maxRes.rows[0] as { maxv: number | string }).maxv) + 1;
        await client.query(
          `INSERT INTO cms_versions (entity_type, entity_id, version, data, status, comment, created_by)
           VALUES ($1, $2, $3, $4::jsonb, 'draft', $5, $6)`,
          [
            CMS_SETTINGS_ENTITY_TYPE,
            CMS_SETTINGS_ENTITY_ID,
            draftVersion,
            JSON.stringify({ settings: nextRows }),
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
          details: {
            version: draftVersion,
            keys: nextRows.map((r) => r.key),
            comment,
          },
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
      // 23505 — гонка двух админов на одной версии (UNIQUE entity+version)
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json(
          { error: "CMS_CONFLICT", currentVersion: publishedVersion },
          { status: 409 }
        );
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.warn("[cms/settings] PUT error:", (error as Error).message);
    return serverError();
  }
}
