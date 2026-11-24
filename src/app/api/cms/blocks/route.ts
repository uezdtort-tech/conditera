/**
 * /api/cms/blocks — CRUD контент-блоков секций главной (CMS).
 *
 * GET    — публичный: видимые секции + активные блоки (сгруппировано);
 *          ?include_inactive=true — всё, только ADMIN/SUPER_ADMIN.
 * POST   — создать блок (ADMIN/SUPER_ADMIN). Секция создаётся по slug
 *          автоматически (cms_sections.slug UNIQUE → ON CONFLICT DO NOTHING).
 * PATCH  — обновить блок по body.id (ADMIN/SUPER_ADMIN).
 * DELETE — удалить блок (?id=) (ADMIN/SUPER_ADMIN). Секции не удаляются.
 *
 * Таблицы (миграция 0017, camelCase-колонки в кавычках):
 *   cms_sections       { id TEXT, slug UNIQUE, title, visible, "sortOrder", metadata, ... }
 *   cms_section_blocks { id TEXT, "sectionId", type, content, "order", "isActive", metadata JSONB, ... }
 *
 * Модель блока (metadata JSONB): { title, subtitle, image, link, linkText } —
 * текстовые поля формы админки; content — основной текст. Читатели —
 * публичная главная (секции advantages/steps/cta_confectioner), фолбэк —
 * хардкод-разметка (zero-downtime, см. use-published-home-blocks.ts).
 *
 * Доступ к БД — параметризованный SQL через единый pg-пул
 * (src/lib/postgrest/pool.ts), паттерн settings-versioning.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import { cmsAudit } from "@/lib/cms/settings-versioning";

export const runtime = "nodejs";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;

// ==================== Типы ====================

/** Публичный контракт блока (metadata развёрнут в поля формы). */
export interface CmsBlockDto {
  id: string;
  sectionSlug: string;
  type: string;
  content: string | null;
  order: number;
  isActive: boolean;
  title: string | null;
  subtitle: string | null;
  image: string | null;
  link: string | null;
  linkText: string | null;
}

interface CmsSectionDto {
  id: string;
  slug: string;
  title: string;
  visible: boolean;
  sortOrder: number;
  blocks: CmsBlockDto[];
}

interface BlockJoinRow {
  section_id: string;
  section_slug: string;
  section_title: string;
  section_visible: boolean;
  section_order: number;
  block_id: string | null;
  block_type: string | null;
  block_content: string | null;
  block_order: number | null;
  block_active: boolean | null;
  block_metadata: unknown;
}

// ==================== Хелперы ====================

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function strOrNull(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function mapJoinRow(r: BlockJoinRow): { section: Omit<CmsSectionDto, "blocks">; block: CmsBlockDto | null } {
  const section = {
    id: r.section_id,
    slug: r.section_slug,
    title: r.section_title,
    visible: r.section_visible === true,
    sortOrder: Number(r.section_order) || 0,
  };
  if (r.block_id == null) return { section, block: null };
  const meta = asRecord(r.block_metadata);
  const block: CmsBlockDto = {
    id: r.block_id,
    sectionSlug: r.section_slug,
    type: r.block_type || "text",
    content: r.block_content,
    order: Number(r.block_order) || 0,
    isActive: r.block_active !== false,
    title: strOrNull(meta.title, 200),
    subtitle: strOrNull(meta.subtitle, 400),
    image: strOrNull(meta.image, 2048),
    link: strOrNull(meta.link, 500),
    linkText: strOrNull(meta.linkText, 200),
  };
  return { section, block };
}

function groupRows(rows: BlockJoinRow[]): CmsSectionDto[] {
  const byId = new Map<string, CmsSectionDto>();
  for (const raw of rows) {
    const { section, block } = mapJoinRow(raw);
    let dto = byId.get(section.id);
    if (!dto) {
      dto = { ...section, blocks: [] };
      byId.set(section.id, dto);
    }
    if (block) dto.blocks.push(block);
  }
  return [...byId.values()];
}

/** Аудит блоков: best-effort, details — только нечувствительные поля. */
function auditBlock(
  action: "block_create" | "block_update" | "block_delete",
  blockId: string,
  actorId: string,
  details: Record<string, unknown>
): void {
  void cmsAudit({ entityType: "cms_section_blocks", entityId: blockId, action, actorId, details });
}

const SECTION_ID_PREFIX = "sec_";

// ==================== GET ====================

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("include_inactive") === "true";

    let isAdmin = false;
    if (includeInactive) {
      const user = await getUserFromRequest(request);
      isAdmin =
        !!user && (user.roles || []).some((r: string) => (ADMIN_ROLES as readonly string[]).includes(r));
    }

    const where =
      includeInactive && isAdmin
        ? ""
        : `WHERE s."visible" = true AND (b.id IS NULL OR b."isActive" = true)`;
    const res = await getPool().query(
      `SELECT s.id AS section_id, s.slug AS section_slug, s.title AS section_title,
              s."visible" AS section_visible, s."sortOrder" AS section_order,
              b.id AS block_id, b.type AS block_type, b.content AS block_content,
              b."order" AS block_order, b."isActive" AS block_active, b.metadata AS block_metadata
         FROM cms_sections s
         LEFT JOIN cms_section_blocks b ON b."sectionId" = s.id
         ${where}
        ORDER BY s."sortOrder" ASC, s.slug ASC, b."order" ASC, b.id ASC`
    );
    return NextResponse.json({
      sections: groupRows(res.rows as unknown as BlockJoinRow[]),
    });
  } catch (error) {
    // Fail-safe: публичный рендер никогда не падает из-за CMS.
    console.warn("[cms/blocks] GET error:", (error as Error).message);
    return NextResponse.json({ sections: [] });
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
    const sectionSlug = strOrNull((body as Record<string, unknown> | null)?.section, 60);
    if (!sectionSlug) return NextResponse.json({ error: "section обязателен" }, { status: 400 });

    const b = (body ?? {}) as Record<string, unknown>;
    const db = getPool();

    // 1. Секция: создаём, если ещё нет (slug UNIQUE).
    const sectionId = `${SECTION_ID_PREFIX}${sectionSlug}`;
    await db.query(
      `INSERT INTO cms_sections (id, slug, title, visible, "sortOrder", "updatedAt")
       VALUES ($1, $2, $3, true, 0, CURRENT_TIMESTAMP)
       ON CONFLICT (slug) DO NOTHING`,
      [sectionId, sectionSlug, sectionSlug]
    );

    // 2. Блок.
    const blockId = crypto.randomUUID();
    const metadata = {
      title: strOrNull(b.title, 200),
      subtitle: strOrNull(b.subtitle, 400),
      image: strOrNull(b.image, 2048),
      link: strOrNull(b.link, 500),
      linkText: strOrNull(b.linkText, 200),
    };
    const order = Number(b.order) || 0;
    const isActive = b.isActive !== false;
    const type = strOrNull(b.type, 40) || "text";

    const inserted = await db.query(
      `INSERT INTO cms_section_blocks (id, "sectionId", type, content, "order", "isActive", metadata, "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, CURRENT_TIMESTAMP)
       RETURNING id`,
      [blockId, sectionId, type, strOrNull(b.content, 4000), order, isActive, JSON.stringify(metadata)]
    );

    auditBlock("block_create", blockId, user.id, { section: sectionSlug, isActive });
    return NextResponse.json(
      {
        ok: true,
        block: {
          id: (inserted.rows[0] as { id: string }).id,
          sectionSlug,
          type,
          content: strOrNull(b.content, 4000),
          order,
          isActive,
          ...metadata,
        },
      },
      { status: 201 }
    );
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
    const id = strOrNull((body as Record<string, unknown> | null)?.id, 100);
    if (!id) return NextResponse.json({ error: "id обязателен" }, { status: 400 });

    const b = (body ?? {}) as Record<string, unknown>;
    const db = getPool();

    const existing = await db.query(`SELECT metadata FROM cms_section_blocks WHERE id = $1`, [id]);
    if ((existing.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: "Блок не найден" }, { status: 404 });
    }
    const meta = asRecord((existing.rows[0] as { metadata: unknown }).metadata);

    // metadata-поля мерджим поверх существующих, известные поля — по флагу присутствия.
    if (b.title !== undefined) meta.title = strOrNull(b.title, 200);
    if (b.subtitle !== undefined) meta.subtitle = strOrNull(b.subtitle, 400);
    if (b.image !== undefined) meta.image = strOrNull(b.image, 2048);
    if (b.link !== undefined) meta.link = strOrNull(b.link, 500);
    if (b.linkText !== undefined) meta.linkText = strOrNull(b.linkText, 200);

    const sets: string[] = [`metadata = $2::jsonb`, `"updatedAt" = CURRENT_TIMESTAMP`];
    const vals: unknown[] = [id, JSON.stringify(meta)];
    if (b.content !== undefined) {
      vals.push(strOrNull(b.content, 4000));
      sets.push(`content = $${vals.length}`);
    }
    if (b.isActive !== undefined) {
      vals.push(Boolean(b.isActive));
      sets.push(`"isActive" = $${vals.length}`);
    }
    if (b.order !== undefined) {
      vals.push(Number(b.order) || 0);
      sets.push(`"order" = $${vals.length}`);
    }
    if (b.type !== undefined) {
      vals.push(strOrNull(b.type, 40) || "text");
      sets.push(`type = $${vals.length}`);
    }

    await db.query(`UPDATE cms_section_blocks SET ${sets.join(", ")} WHERE id = $1`, vals);
    auditBlock("block_update", id, user.id, { fields: Object.keys(b).filter((k) => k !== "id") });
    return NextResponse.json({ ok: true });
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

    const res = await getPool().query(`DELETE FROM cms_section_blocks WHERE id = $1`, [id]);
    if ((res.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: "Блок не найден" }, { status: 404 });
    }
    auditBlock("block_delete", id, user.id, {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Ошибка", detail: (error as Error).message },
      { status: 500 }
    );
  }
}
