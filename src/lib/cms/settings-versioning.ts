/**
 * settings-versioning.ts — Z-v32 Пакет E-1: серверные помощники версионирования
 * site_settings (cms_versions + cms_audit, миграция 0082).
 *
 * Источник истины опубликованных настроек:
 *   1) cms_versions (entity_type='site_settings', entity_id='global',
 *      status='published') — документ { settings: [...] } в формате
 *      публичного контракта GET /api/cms/settings;
 *   2) фолбэк — таблица site_settings (легаси, zero-downtime: пока публикаций
 *      нет, поведение прежнее).
 *
 * Все запросы — параметризованный SQL через единый pg-пул
 * (src/lib/postgrest/pool.ts). RLS-доступ к таблицам — admin-only (0082);
 * серверные записи идут от имени service-контекста (RLS обходится по
 * назначению, паттерн 0079).
 *
 * Приватность: cms_audit.details — только нечувствительные метаданные
 * (номера версий, ключи настроек, id/заголовки баннеров). Значения секретных
 * настроек и полные документы в details НЕ пишутся.
 */

import { getPool } from "@/lib/postgrest/pool";
import type { Pool, PoolClient } from "pg";

/** Всё, что умеет выполнять параметризованный SQL (пул или клиент транзакции). */
type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

// ==================== Константы сущности ====================

export const CMS_SETTINGS_ENTITY_TYPE = "site_settings" as const;
export const CMS_SETTINGS_ENTITY_ID = "global" as const;

// ==================== Типы документов ====================

/** Строка настроек в версионируемом документе (typed JSON, без HTML/JS). */
export interface SiteSettingDocRow {
  id: string;
  key: string;
  value: string;
  category: string;
  description: string | null;
  // Дополнительные поля исходных строк (updatedAt/updatedBy и т.п.)
  // сохраняются как есть — контракт публичного GET остаётся надмножеством.
  [extra: string]: unknown;
}

export interface SiteSettingsDoc {
  settings: SiteSettingDocRow[];
}

// type-alias (не interface): нужен implicit index signature, чтобы тип
// удовлетворял generic-ограничению pg query<R extends QueryResultRow>.
// Для потребителей эквивалентно interface — все поля обязательны, строгость та же.
export type CmsVersionRow = {
  id: string;
  version: number;
  status: "draft" | "published" | "superseded" | string;
  data: unknown;
  comment: string | null;
  created_by: string | null;
  created_at: string | Date;
};

// ==================== Аудит ====================

export type CmsAuditAction =
  | "save_draft"
  | "publish"
  | "rollback"
  | "banner_create"
  | "banner_update"
  | "banner_delete"
  | "block_create"
  | "block_update"
  | "block_delete"
  | "nav_create"
  | "nav_update"
  | "nav_delete";

/**
 * Записать событие cms_audit. Best-effort: сбой журнала НЕ ломает основную
 * операцию (warn в лог), кроме случаев когда вызов идёт в транзакции —
 * тогда бросает наверх и транзакция откатывается целиком (см. publish).
 */
export async function cmsAudit(
  input: {
    entityType: string;
    entityId: string;
    action: CmsAuditAction;
    actorId?: string | null;
    details?: Record<string, unknown>;
  },
  via?: Queryable
): Promise<void> {
  const db = via ?? getPool();
  try {
    await db.query(
      `INSERT INTO cms_audit (entity_type, entity_id, action, actor_id, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        input.entityType,
        input.entityId,
        input.action,
        input.actorId ?? null,
        JSON.stringify(input.details ?? {}),
      ]
    );
  } catch (error) {
    if (via) throw error; // в транзакции — честный rollback
    console.warn("[cms/audit] write failed (non-fatal):", (error as Error).message);
  }
}

// ==================== Нормализация документа ====================

/** plain-object guard без any. */
function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Строковое значение настройки: string | number | boolean → string, иначе null. */
function coerceSettingValue(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return String(v);
  return null;
}

/**
 * Строгая нормализация строк документа: только объекты с непустым строковым
 * key и приводимым value. Произвольный HTML/JS не вводится — значения это
 * простые строки key-value (рендер на публичных страницах текстом/атрибутами,
 * как и раньше).
 */
export function normalizeDocRows(input: unknown[]): SiteSettingDocRow[] {
  const rows: SiteSettingDocRow[] = [];
  for (const raw of input) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const key = typeof rec.key === "string" ? rec.key.trim() : "";
    if (!key) continue;
    const value = coerceSettingValue(rec.value);
    if (value === null) continue;
    const row: SiteSettingDocRow = {
      id: typeof rec.id === "string" && rec.id ? rec.id : crypto.randomUUID(),
      key,
      value,
      category: typeof rec.category === "string" && rec.category ? rec.category : "general",
      description: typeof rec.description === "string" ? rec.description : null,
    };
    // Прочие известные поля строк site_settings (updatedAt/updatedBy) —
    // переносим как есть, если это строки.
    if (typeof rec.updatedAt === "string") row.updatedAt = rec.updatedAt;
    if (typeof rec.updatedBy === "string") row.updatedBy = rec.updatedBy;
    rows.push(row);
  }
  return rows;
}

/** unknown (jsonb data) → строки документа; битый/чужой jsonb → []. */
export function docRows(data: unknown): SiteSettingDocRow[] {
  const rec = asRecord(data);
  const arr = rec && Array.isArray(rec.settings) ? rec.settings : null;
  if (!arr) return [];
  const rows: SiteSettingDocRow[] = [];
  for (const raw of arr) {
    const r = asRecord(raw);
    if (!r || typeof r.key !== "string" || !r.key) continue;
    const value = coerceSettingValue(r.value);
    if (value === null) continue;
    rows.push({
      ...r,
      // id берём из исходной строки; фолбэк — как в normalizeDocRows (для
      // документов, записанных вне этого модуля, поле id обязано быть строкой).
      id: typeof r.id === "string" && r.id ? r.id : crypto.randomUUID(),
      key: r.key,
      value,
      category: typeof r.category === "string" && r.category ? r.category : "general",
      description: typeof r.description === "string" ? r.description : null,
    });
  }
  return rows;
}

// ==================== Чтение версий ====================

/** Опубликованная версия настроек (или null, пока публикаций нет). */
export async function getPublishedSettingsVersion(
  via?: Queryable
): Promise<Pick<CmsVersionRow, "version" | "data"> | null> {
  const db = via ?? getPool();
  const res = await db.query(
    `SELECT version, data FROM cms_versions
      WHERE entity_type = $1 AND entity_id = $2 AND status = 'published'
      ORDER BY version DESC LIMIT 1`,
    [CMS_SETTINGS_ENTITY_TYPE, CMS_SETTINGS_ENTITY_ID]
  );
  const row = res.rows[0] as { version: number; data: unknown } | undefined;
  return row ? { version: Number(row.version), data: row.data } : null;
}

/** Последний черновик (для PUT: «обновить последний draft»). */
export async function getLatestDraftVersion(via?: Queryable): Promise<CmsVersionRow | null> {
  const db = via ?? getPool();
  // Форма строки гарантирована SELECT'ом выше (колонки cms_versions) —
  // типизируем через generic node-pg, без приведения QueryResultRow.
  const res = await db.query<CmsVersionRow>(
    `SELECT id, version, data FROM cms_versions
      WHERE entity_type = $1 AND entity_id = $2 AND status = 'draft'
      ORDER BY version DESC LIMIT 1`,
    [CMS_SETTINGS_ENTITY_TYPE, CMS_SETTINGS_ENTITY_ID]
  );
  return res.rows[0] ?? null;
}

/** Конкретная версия (для ?version=N и отката). */
export async function getVersionRow(version: number, via?: Queryable): Promise<CmsVersionRow | null> {
  const db = via ?? getPool();
  // Форма строки гарантирована SELECT'ом выше — generic node-pg вместо cast.
  const res = await db.query<CmsVersionRow>(
    `SELECT id, version, status, data, comment, created_by, created_at
       FROM cms_versions
      WHERE entity_type = $1 AND entity_id = $2 AND version = $3`,
    [CMS_SETTINGS_ENTITY_TYPE, CMS_SETTINGS_ENTITY_ID, version]
  );
  return res.rows[0] ?? null;
}

/** Легаси-строки site_settings — тот же SELECT, что и до версионирования. */
export async function getLegacySettingsRows(): Promise<Record<string, unknown>[]> {
  const res = await getPool().query(
    `SELECT * FROM site_settings ORDER BY category ASC`
  );
  return res.rows as Record<string, unknown>[];
}

// ==================== Запись ====================

/**
 * Синхронизация легаси-таблицы site_settings из опубликованного документа
 * (UPDATE по key, при отсутствии — INSERT). Вызывается в транзакции publish/
 * rollback, чтобы оба источника соглашались. Сбой — наверх (транзакция
 * откатывается): источники не расходятся.
 */
export async function syncSiteSettingsFromDoc(
  client: Queryable,
  data: unknown
): Promise<number> {
  const rows = docRows(data);
  let n = 0;
  for (const row of rows) {
    const upd = await client.query(`UPDATE site_settings SET value = $2 WHERE key = $1`, [
      row.key,
      row.value,
    ]);
    if ((upd.rowCount ?? 0) === 0) {
      await client.query(
        `INSERT INTO site_settings (id, key, value, category, description, "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          typeof row.id === "string" && row.id ? row.id : crypto.randomUUID(),
          row.key,
          row.value,
          row.category,
          row.description,
          new Date().toISOString(),
        ]
      );
    }
    n += 1;
  }
  return n;
}
