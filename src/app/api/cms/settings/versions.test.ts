/**
 * Тесты Z-v32 Пакет E-1: версионирование/публикация/откат/аудит/preview
 * для site_settings (cms_versions + cms_audit, миграция 0082).
 *
 * Проверяется РЕАЛЬНОЕ поведение маршрутов:
 *   GET  /api/cms/settings           — public: опубликованный документ + version
 *                                      (и fail-safe пустой ответ, не 500);
 *   GET  /api/cms/settings?version=N — admin-only (403 не-админу, БД не трогается);
 *   PUT  /api/cms/settings           — черновик (создание/обновление последнего
 *                                      draft), 409 CMS_CONFLICT при устаревшем
 *                                      expectedPublishedVersion;
 *   POST /api/cms/settings/publish   — supersede прежней + publish целевой;
 *   POST /api/cms/settings/rollback  — НОВАЯ версия с данными старой, сразу
 *                                      published;
 *   cms_audit                        — save_draft / publish / rollback пишутся.
 *
 * Моки: только граница БД (@/lib/postgrest/pool → queryMock с SQL-роутером)
 * и auth/role-guards — по образцу src/lib/api-auth-matrix.test.ts и
 * src/app/api/diagnostics/client-errors/route.test.ts. Транзакции
 * (BEGIN/COMMIT/ROLLBACK + один client) прогоняются через тот же queryMock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// --- Моки границ ---
const queryMock = vi.fn();
const releaseMock = vi.fn();
const getUserMock = vi.fn();
const requireAnyRoleMock = vi.fn();

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({
    query: (...a: unknown[]) => queryMock(...a),
    connect: async () => ({ query: (...a: unknown[]) => queryMock(...a), release: releaseMock }),
  }),
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (req: unknown) => getUserMock(req),
}));

// Фейковая user_roles (dbRoles) с семантикой requireAnyRole из role-guards.ts
let dbRoles: string[] = [];

function deny401(): Response {
  return new Response(JSON.stringify({ error: "Необходима аутентификация" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
function deny403(): Response {
  return new Response(
    JSON.stringify({ error: "Требуется одна из ролей: ADMIN, SUPER_ADMIN", required_roles: ["ADMIN", "SUPER_ADMIN"] }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}

vi.mock("@/lib/role-guards", () => ({
  requireAnyRole: (...a: unknown[]) => requireAnyRoleMock(...a),
}));

import { GET, PUT } from "./route";
import { POST as publishPOST } from "./publish/route";
import { POST as rollbackPOST } from "./rollback/route";

const ADMIN_ID = "00000000-0000-0000-0000-00000000a001";
const CUSTOMER_ID = "00000000-0000-0000-0000-00000000c001";

function setUser(userId: string | null, roles: string[] = []) {
  dbRoles = userId && roles.includes("ADMIN") ? ["ADMIN"] : [];
  getUserMock.mockResolvedValue(
    userId ? { userId, id: userId, email: "u@test", roles, accountType: "" } : null
  );
  requireAnyRoleMock.mockImplementation(async (uid: unknown, wanted: string[]) => {
    if (!uid) return deny401();
    return wanted.some((r) => dbRoles.includes(r)) ? null : deny403();
  });
}

// ==================== Фейковая БД (SQL-роутер) ====================

interface DbState {
  publishedRows: unknown[]; // SELECT version, data ... status='published' ... LIMIT 1
  draftRows: unknown[]; // SELECT id, version, data ... status='draft'
  targetRows: unknown[]; // SELECT ... FOR UPDATE (publish target)
  rollbackSrcRows: unknown[]; // SELECT version, data ... version=$3 (rollback src)
  prevPublishedRows: unknown[]; // SELECT version ... status='published' (без data)
  maxVersion: number;
  siteSettingsRowCount: number; // есть ли строка site_settings (UPDATE rowCount)
}

const db: DbState = {
  publishedRows: [],
  draftRows: [],
  targetRows: [],
  rollbackSrcRows: [],
  prevPublishedRows: [],
  maxVersion: 0,
  siteSettingsRowCount: 0,
};

const cmsVersionsInserts: Array<{
  version: number;
  status: string;
  data: unknown;
  comment: string | null;
}> = [];
const cmsVersionsUpdates: Array<Record<string, unknown>> = [];
const auditRows: Array<{ action: string; details: Record<string, unknown>; actorId: string | null }> = [];
let siteSettingsUpserts = 0;
let commits = 0;
let rollbacks = 0;

function resetDb() {
  db.publishedRows = [];
  db.draftRows = [];
  db.targetRows = [];
  db.rollbackSrcRows = [];
  db.prevPublishedRows = [];
  db.maxVersion = 0;
  db.siteSettingsRowCount = 0;
  cmsVersionsInserts.length = 0;
  cmsVersionsUpdates.length = 0;
  auditRows.length = 0;
  siteSettingsUpserts = 0;
  commits = 0;
  rollbacks = 0;
}

function installSqlRouter() {
  queryMock.mockImplementation(async (sql: unknown, params?: unknown[]) => {
    const q = String(sql);
    const p = params ?? [];
    if (/^BEGIN\b/.test(q)) return { rows: [], rowCount: 1 };
    if (/^COMMIT\b/.test(q)) {
      commits += 1;
      return { rows: [], rowCount: 1 };
    }
    if (/^ROLLBACK\b/.test(q)) {
      rollbacks += 1;
      return { rows: [], rowCount: 1 };
    }
    // --- cms_audit ---
    if (q.includes("INSERT INTO cms_audit")) {
      auditRows.push({ action: String(p[2]), details: JSON.parse(String(p[4])), actorId: (p[3] as string) ?? null });
      return { rows: [], rowCount: 1 };
    }
    // --- cms_versions writes ---
    if (q.includes("INSERT INTO cms_versions")) {
      cmsVersionsInserts.push({
        version: Number(p[2]),
        // PUT вставляет статус литералом 'draft'; rollback — литералом 'published'
        status: q.includes("'draft'") ? "draft" : q.includes("'published'") ? "published" : String(p[4]),
        data: JSON.parse(String(p[3])),
        comment: (p[4] as string) ?? null,
      });
      return { rows: [], rowCount: 1 };
    }
    if (q.includes("UPDATE cms_versions") && q.includes("SET status = 'superseded'")) {
      cmsVersionsUpdates.push({ superseded: true });
      return { rows: [], rowCount: 1 };
    }
    if (q.includes("UPDATE cms_versions") && q.includes("SET status = 'published'")) {
      cmsVersionsUpdates.push({ publishedId: p[0] });
      return { rows: [], rowCount: 1 };
    }
    if (q.includes("UPDATE cms_versions") && q.includes("SET data")) {
      cmsVersionsUpdates.push({ draftData: JSON.parse(String(p[0])) }); // $2::jsonb — данные
      return { rows: [{ version: Number(db.draftRows[0] ? (db.draftRows[0] as { version: number }).version : 0) }] };
    }
    // --- site_settings sync ---
    if (q.includes("UPDATE site_settings")) {
      siteSettingsUpserts += 1;
      return { rows: [], rowCount: db.siteSettingsRowCount };
    }
    if (q.includes("INSERT INTO site_settings")) {
      siteSettingsUpserts += 1;
      return { rows: [], rowCount: 1 };
    }
    // --- cms_versions reads ---
    if (q.includes("FOR UPDATE")) return { rows: db.targetRows };
    if (q.includes("version = $3")) return { rows: db.rollbackSrcRows };
    if (q.includes("SELECT version, data FROM cms_versions")) return { rows: db.publishedRows };
    if (q.includes("SELECT id, version, data FROM cms_versions")) return { rows: db.draftRows };
    if (q.includes("SELECT version FROM cms_versions")) return { rows: db.prevPublishedRows };
    if (q.includes("COALESCE(MAX(version)")) return { rows: [{ maxv: db.maxVersion }] };
    if (q.includes("SELECT version, status, comment")) return { rows: [] };
    return { rows: [] };
  });
}

// ==================== Хелперы запросов ====================

function cmsGet(url: string): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, { method: "GET" });
}

function cmsJson(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const DOC = {
  settings: [{ id: "row-1", key: "hero_title", value: "Торты на заказ", category: "general", description: null }],
};

beforeEach(() => {
  resetDb();
  getUserMock.mockReset();
  requireAnyRoleMock.mockReset();
  queryMock.mockReset();
  installSqlRouter();
});

// ==================== Тесты ====================

describe("GET /api/cms/settings — публичный контракт", () => {
  it("возвращает опубликованный документ + version (additive)", async () => {
    db.publishedRows = [{ version: 3, data: DOC }];
    const res = await GET(cmsGet("/api/cms/settings"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: Array<{ key: string; value: string }>; version: number };
    expect(body.version).toBe(3);
    expect(Array.isArray(body.settings)).toBe(true);
    expect(body.settings[0]?.key).toBe("hero_title");
    expect(body.settings[0]?.value).toBe("Торты на заказ");
  });

  it("fail-safe: сбой чтения → 200 { settings: [], version: null }, не 500", async () => {
    queryMock.mockReset();
    queryMock.mockRejectedValue(new Error("db down"));
    const res = await GET(cmsGet("/api/cms/settings"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: unknown[]; version: null };
    expect(body.settings).toEqual([]);
    expect(body.version).toBeNull();
  });
});

describe("GET /api/cms/settings?version=N — админ-предпросмотр", () => {
  it("не-админ → 403, БД не вызывается", async () => {
    setUser(CUSTOMER_ID, ["CUSTOMER"]);
    const res = await GET(cmsGet("/api/cms/settings?version=2"));
    expect(res.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("без токена → 401", async () => {
    setUser(null);
    const res = await GET(cmsGet("/api/cms/settings?version=2"));
    expect(res.status).toBe(401);
  });

  it("админ получает версию + meta; несуществующая → 404", async () => {
    setUser(ADMIN_ID, ["ADMIN"]);
    queryMock.mockImplementation(async (sql: unknown) => {
      const q = String(sql);
      if (/^BEGIN|^COMMIT|^ROLLBACK/.test(q)) return { rows: [] };
      // getVersionRow: SELECT id, version, status, data, comment, created_by, created_at
      if (q.includes("data")) {
        return {
          rows: [
            {
              id: "v2",
              version: 2,
              status: "draft",
              data: DOC,
              comment: "Правка ключа hero_title",
              created_by: ADMIN_ID,
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const ok = await GET(cmsGet("/api/cms/settings?version=2"));
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as {
      version: number;
      status: string;
      comment: string | null;
      settings: unknown[];
    };
    expect(okBody.version).toBe(2);
    expect(okBody.status).toBe("draft");
    expect(okBody.comment).toBe("Правка ключа hero_title");
    expect(okBody.settings).toHaveLength(1);

    queryMock.mockImplementation(async () => ({ rows: [] }));
    const missing = await GET(cmsGet("/api/cms/settings?version=99"));
    expect(missing.status).toBe(404);
  });
});

describe("PUT /api/cms/settings — черновики и оптимистичная блокировка", () => {
  it("не-админ → 403", async () => {
    setUser(CUSTOMER_ID, ["CUSTOMER"]);
    const res = await PUT(cmsJson("/api/cms/settings", "PUT", { settings: [DOC.settings[0]] }));
    expect(res.status).toBe(403);
  });

  it("PUT без expectedPublishedVersion → создаётся draft v(max+1) + audit save_draft", async () => {
    setUser(ADMIN_ID, ["ADMIN"]);
    db.publishedRows = [{ version: 3, data: DOC }];
    db.maxVersion = 3;

    const res = await PUT(
      cmsJson("/api/cms/settings", "PUT", {
        settings: [{ key: "hero_title", value: "Новый заголовок" }],
        comment: "Обновление героя",
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; draft: { version: number; status: string }; publishedVersion: number | null };
    expect(body.ok).toBe(true);
    expect(body.draft.status).toBe("draft");
    expect(body.draft.version).toBe(4); // max 3 + 1
    expect(body.publishedVersion).toBe(3);

    expect(cmsVersionsInserts).toHaveLength(1);
    expect(cmsVersionsInserts[0]?.status).toBe("draft");
    expect(cmsVersionsInserts[0]?.version).toBe(4);
    const data = cmsVersionsInserts[0]?.data as { settings: Array<{ key: string; value: string }> };
    expect(data.settings[0]?.value).toBe("Новый заголовок");

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("save_draft");
    expect(auditRows[0]?.details.version).toBe(4);
    expect(auditRows[0]?.actorId).toBe(ADMIN_ID);
    expect(commits).toBe(1);
    expect(rollbacks).toBe(0);
  });

  it("PUT легаси-формой {key,value} поверх существующего draft обновляет его (версия сохраняется)", async () => {
    setUser(ADMIN_ID, ["ADMIN"]);
    db.draftRows = [{ id: "draft-1", version: 9, data: { settings: [{ id: "r1", key: "hero_title", value: "Старое", category: "general", description: null }] } }];

    const res = await PUT(cmsJson("/api/cms/settings", "PUT", { key: "hero_title", value: "Свежее" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: { version: number } };
    expect(body.draft.version).toBe(9);
    expect(cmsVersionsInserts).toHaveLength(0);
    const upd = cmsVersionsUpdates.find((u) => "draftData" in u) as
      | { draftData: { settings: Array<{ key: string; value: string }> } }
      | undefined;
    expect(upd?.draftData.settings[0]?.value).toBe("Свежее");
    expect(auditRows[0]?.action).toBe("save_draft");
  });

  it("PUT с устаревшим expectedPublishedVersion → 409 CMS_CONFLICT, записи нет", async () => {
    setUser(ADMIN_ID, ["ADMIN"]);
    db.publishedRows = [{ version: 5, data: DOC }];

    const res = await PUT(
      cmsJson("/api/cms/settings", "PUT", {
        settings: [{ key: "hero_title", value: "X" }],
        expectedPublishedVersion: 4,
      })
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; currentVersion: number | null };
    expect(body.error).toBe("CMS_CONFLICT");
    expect(body.currentVersion).toBe(5);
    expect(cmsVersionsInserts).toHaveLength(0);
    expect(auditRows).toHaveLength(0);
    expect(commits).toBe(0);
  });
});

describe("POST /api/cms/settings/publish — supersede + publish в одной транзакции", () => {
  it("публикует draft: прежняя → superseded, цель → published, audit {from,to}", async () => {
    setUser(ADMIN_ID, ["ADMIN"]);
    db.targetRows = [{ id: "target-7", version: 7, status: "draft", data: DOC }];
    db.prevPublishedRows = [{ version: 6 }];
    db.siteSettingsRowCount = 1; // sync пойдёт в UPDATE (строка ключа уже есть)

    const res = await publishPOST(cmsJson("/api/cms/settings/publish", "POST", { version: 7 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; publishedVersion: number; previousVersion: number | null };
    expect(body.ok).toBe(true);
    expect(body.publishedVersion).toBe(7);
    expect(body.previousVersion).toBe(6);

    expect(cmsVersionsUpdates).toEqual([{ superseded: true }, { publishedId: "target-7" }]);
    expect(commits).toBe(1);
    expect(siteSettingsUpserts).toBe(1); // site_settings синхронизирован

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("publish");
    expect(auditRows[0]?.details).toEqual({ from: 6, to: 7, syncedKeys: 1 });
  });

  it("целевая версия не черновик → 409 CMS_NOT_DRAFT; отсутствует → 404", async () => {
    setUser(ADMIN_ID, ["ADMIN"]);
    db.targetRows = [{ id: "t", version: 6, status: "published", data: DOC }];
    const notDraft = await publishPOST(cmsJson("/api/cms/settings/publish", "POST", { version: 6 }));
    expect(notDraft.status).toBe(409);
    const notDraftBody = (await notDraft.json()) as { error: string; currentStatus: string };
    expect(notDraftBody.error).toBe("CMS_NOT_DRAFT");
    expect(notDraftBody.currentStatus).toBe("published");
    expect(commits).toBe(0);
    expect(rollbacks).toBeGreaterThanOrEqual(1);

    db.targetRows = [];
    const missing = await publishPOST(cmsJson("/api/cms/settings/publish", "POST", { version: 42 }));
    expect(missing.status).toBe(404);
    const missingBody = (await missing.json()) as { error: string };
    expect(missingBody.error).toBe("CMS_VERSION_NOT_FOUND");
  });
});

describe("POST /api/cms/settings/rollback — новая версия с данными старой", () => {
  it("создаёт v(max+1) published из документа старой версии + audit rollback", async () => {
    setUser(ADMIN_ID, ["ADMIN"]);
    db.rollbackSrcRows = [{ version: 2, data: DOC }];
    db.prevPublishedRows = [{ version: 6 }];
    db.maxVersion = 6;
    db.siteSettingsRowCount = 1; // sync пойдёт в UPDATE

    const res = await rollbackPOST(cmsJson("/api/cms/settings/rollback", "POST", { toVersion: 2 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: number; rolledBackTo: number; previousVersion: number | null };
    expect(body.ok).toBe(true);
    expect(body.version).toBe(7);
    expect(body.rolledBackTo).toBe(2);
    expect(body.previousVersion).toBe(6);

    // прежняя опубликованная помечена superseded ПОСЛЕ вставки? Нет:
    // supersede идёт до INSERT (частичный UNIQUE-индекс)
    expect(cmsVersionsUpdates[0]).toEqual({ superseded: true });
    expect(cmsVersionsInserts).toHaveLength(1);
    const ins = cmsVersionsInserts[0];
    expect(ins?.status).toBe("published");
    expect(ins?.version).toBe(7);
    expect(ins?.comment).toBe("Откат к версии 2");
    expect((ins?.data as typeof DOC).settings[0]?.key).toBe("hero_title");

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("rollback");
    expect(auditRows[0]?.details).toEqual({ from: 6, to: 7, rolledBackTo: 2 });
    expect(commits).toBe(1);
    expect(siteSettingsUpserts).toBe(1);
  });

  it("несуществующая версия → 404, записи нет", async () => {
    setUser(ADMIN_ID, ["ADMIN"]);
    db.rollbackSrcRows = [];
    const res = await rollbackPOST(cmsJson("/api/cms/settings/rollback", "POST", { toVersion: 99 }));
    expect(res.status).toBe(404);
    expect(cmsVersionsInserts).toHaveLength(0);
    expect(cmsVersionsUpdates).toHaveLength(0);
    expect(commits).toBe(0);
  });
});
