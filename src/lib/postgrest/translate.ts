/**
 * translate.ts — трансляция PostgREST-запросов (формат supabase-js v2) в SQL.
 *
 * Поддерживаемое подмножество (по фактическому использованию в src/, см. worklog 1-b/1-d):
 *  • GET  /rest/v1/{table}?select=&col=eq.val&order=&limit=&offset=&or=(...)
 *  • POST /rest/v1/{table}                — insert (+upsert через Prefer/on_conflict)
 *  • PATCH /rest/v1/{table}?filters       — update
 *  • DELETE /rest/v1/{table}?filters      — delete
 *  • POST/GET /rest/v1/rpc/{fn}           — вызов public-функции с именованными аргументами
 *  • Prefer: count=exact | return=representation|minimal | resolution=merge-duplicates|ignore-duplicates
 *  • Accept: application/vnd.pgrst.object+json — .single()
 *  • 1-уровневый resource-embedding по FK (select=*,profiles(full_name))
 *
 * Безопасность: значения — только параметризация $n; идентификаторы — только
 * после резолва в information_schema (introspect.ts) + quoteIdent().
 */

import {
  getIntrospection,
  resolveTable,
  resolveColumn,
  quoteIdent,
  pgCastTarget,
  type IntrospectedTable,
  type IntrospectedColumn,
  type SchemaIntrospection,
} from "./introspect";
import { PgrstError } from "./errors";
export interface QueryExecutor {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

// ============================================================================
// Типы
// ============================================================================

export interface PgrstContext {
  pool: QueryExecutor;
  intro: SchemaIntrospection;
  method: string;
  segments: string[];
  searchParams: URLSearchParams;
  body: unknown;
  headers: Headers;
}

export interface PgrstResult {
  status: number;
  /** undefined → ответ без тела (204); null допустим как JSON null */
  json?: unknown;
  headers: Record<string, string>;
}

interface SelectItem {
  alias: string | null;
  column?: { name: string };
  embed?: { rel: string; relTable: IntrospectedTable; select: string };
}

interface WherePart {
  sql: string;
  params: unknown[];
}

// ============================================================================
// Утилиты
// ============================================================================

const RESERVED_PARAMS = new Set([
  "select",
  "order",
  "limit",
  "offset",
  "on_conflict",
  "columns",
  "or",
  "and",
]);

function pgrstErr(status: number, code: string, message: string, hint: string | null = null): PgrstError {
  return new PgrstError(status, code, message, null, hint);
}

/** Разбить строку по запятым верхнего уровня (с учётом скобок). */
function splitTopLevel(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && s[i - 1] !== "\\") inQuote = !inQuote;
    if (!inQuote) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    if (ch === sep && depth === 0 && !inQuote) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Снять кавычки PostgREST-значения. */
function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/""/g, '"').replace(/\\"/g, '"');
  }
  return t;
}

// ============================================================================
// Select-список и embedding
// ============================================================================

function parseSelectList(ctx: PgrstContext, table: IntrospectedTable, raw: string): SelectItem[] {
  const items: SelectItem[] = [];
  for (const part of splitTopLevel(raw)) {
    if (!part) continue;
    // alias:col | alias:rel(...) | col | rel(...)
    let alias: string | null = null;
    let rest = part;
    const aliasIdx = indexOfAliasColon(part);
    if (aliasIdx > 0) {
      alias = part.slice(0, aliasIdx).trim();
      rest = part.slice(aliasIdx + 1).trim();
    }
    const parenIdx = rest.indexOf("(");
    if (parenIdx > 0 && rest.endsWith(")")) {
      const rel = rest.slice(0, parenIdx).trim();
      const inner = rest.slice(parenIdx + 1, -1).trim();
      const relTable = ctx.intro.tables.get(rel.toLowerCase());
      if (!relTable) {
        throw pgrstErr(
          400,
          "PGRST100",
          `Could not parse select parameter: unknown embedded relation '${rel}'`,
          `Known tables: ${[...ctx.intro.tables.values()].slice(0, 40).map((t) => t.name).join(", ")}`
        );
      }
      items.push({ alias: alias ?? relTable.name, embed: { rel, relTable, select: inner || "*" } });
    } else if (rest === "*") {
      items.push({ alias, column: { name: "*" } });
    } else {
      const col = resolveColumn(table, rest);
      items.push({ alias, column: { name: col.name } });
    }
  }
  if (!items.length) items.push({ alias: null, column: { name: "*" } });
  return items;
}

/** Двоеточие-алиас вне скобок (name:col). */
function indexOfAliasColon(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === ":" && depth === 0) return i;
  }
  return -1;
}

interface EmbedPlan {
  alias: string;
  relTable: IntrospectedTable;
  relSelect: string;
  direction: "many-to-one" | "one-to-many";
  thisColumn: string;
  relColumn: string;
}

function planEmbeds(ctx: PgrstContext, table: IntrospectedTable, items: SelectItem[]): EmbedPlan[] {
  const plans: EmbedPlan[] = [];
  for (const item of items) {
    if (!item.embed) continue;
    const relTable = item.embed.relTable;
    // FK от текущей таблицы к целевой → many-to-one (один объект)
    const fkOut = ctx.intro.fks.find(
      (f) => f.table.toLowerCase() === table.name.toLowerCase() && f.refTable.toLowerCase() === relTable.name.toLowerCase()
    );
    // FK от целевой таблицы к текущей → one-to-many (массив)
    const fkIn = ctx.intro.fks.find(
      (f) => f.table.toLowerCase() === relTable.name.toLowerCase() && f.refTable.toLowerCase() === table.name.toLowerCase()
    );
    if (fkOut) {
      plans.push({
        alias: item.alias ?? relTable.name,
        relTable,
        relSelect: item.embed.select,
        direction: "many-to-one",
        thisColumn: fkOut.column,
        relColumn: fkOut.refColumn,
      });
    } else if (fkIn) {
      plans.push({
        alias: item.alias ?? relTable.name,
        relTable,
        relSelect: item.embed.select,
        direction: "one-to-many",
        thisColumn: fkIn.refColumn,
        relColumn: fkIn.column,
      });
    } else {
      throw pgrstErr(
        400,
        "PGRST100",
        `Could not find a relationship between '${table.name}' and '${relTable.name}' in the schema cache`,
        "Only 1-level FK-based embedding is supported by the local PostgREST shim"
      );
    }
  }
  return plans;
}

/** SQL-фрагмент select-списка (без embed'ов). */
function selectFragment(table: IntrospectedTable, items: SelectItem[], allowStar: boolean): string {
  const parts: string[] = [];
  for (const item of items) {
    if (item.embed) continue;
    if (item.column!.name === "*") {
      if (!allowStar) throw pgrstErr(400, "PGRST100", "'*' is not allowed here");
      parts.push("*");
      continue;
    }
    const q = quoteIdent(item.column!.name);
    parts.push(item.alias ? `${q} AS ${quoteIdent(item.alias)}` : q);
  }
  if (!parts.length) parts.push("*");
  return parts.join(", ");
}

// ============================================================================
// Фильтры
// ============================================================================

function castPlaceholder(col: IntrospectedColumn, paramIndex: number, asArray = false): string {
  const cast = pgCastTarget(col);
  if (!cast) return `$${paramIndex}`;
  return asArray
    ? `$${paramIndex}::${cast === "text" ? "text" : cast}[]`
    : `$${paramIndex}::${cast}`;
}

/** col.op.value | not.op.value | op из supabase-js (col=eq.v). Возвращает SQL-атом. */
function buildFilterAtom(
  table: IntrospectedTable,
  colName: string,
  opRaw: string,
  valueRaw: string,
  params: unknown[]
): string {
  let negated = false;
  let op = opRaw;
  if (op === "not") {
    // col=not.eq.v / col=not.v? PostgREST: not.eq.v
    negated = true;
    // дальше обрабатывает вызывающий (opRaw может быть "not.eq")
  }
  if (op.startsWith("not.")) {
    negated = true;
    op = op.slice(4);
  }
  const col = resolveColumn(table, colName);
  const q = quoteIdent(col.name);
  const neg = negated ? "NOT " : "";

  const bind = (val: unknown, asArray = false): string => {
    params.push(val);
    return castPlaceholder(col, params.length, asArray);
  };

  switch (op) {
    case "eq": {
      if (valueRaw === "null" || valueRaw === "NULL") return negated ? `${q} IS NOT NULL` : `${q} IS NULL`;
      const v = valueRaw === "true" ? true : valueRaw === "false" ? false : unquote(valueRaw);
      return `${neg}${q} = ${bind(v)}`;
    }
    case "neq": {
      const v = valueRaw === "true" ? true : valueRaw === "false" ? false : unquote(valueRaw);
      return `${q} ${negated ? "=" : "<>"} ${bind(v)}`;
    }
    case "gt":
      return `${q} ${negated ? "<=" : ">"} ${bind(unquote(valueRaw))}`;
    case "gte":
      return `${q} ${negated ? "<" : ">="} ${bind(unquote(valueRaw))}`;
    case "lt":
      return `${q} ${negated ? ">=" : "<"} ${bind(unquote(valueRaw))}`;
    case "lte":
      return `${q} ${negated ? ">" : "<="} ${bind(unquote(valueRaw))}`;
    case "like":
    case "ilike": {
      const pattern = unquote(valueRaw).replace(/\*/g, "%");
      const fn = op === "like" ? "LIKE" : "ILIKE";
      return `${q} ${negated ? "NOT " : ""}${fn} ${bind(pattern)}`;
    }
    case "in": {
      const inner = valueRaw.trim();
      if (!inner.startsWith("(") || !inner.endsWith(")")) {
        throw pgrstErr(400, "PGRST100", `bad 'in' filter: expected in.(a,b), got ${valueRaw}`);
      }
      const vals = splitTopLevel(inner.slice(1, -1)).filter((v) => v.length > 0);
      if (!vals.length) return negated ? "TRUE" : "FALSE";
      return `${q} ${negated ? "NOT " : ""}= ANY(${bind(vals.map(unquote), true)})`;
    }
    case "is": {
      const v = valueRaw.trim().toLowerCase();
      if (v === "null") return `${q} IS ${negated ? "NOT " : ""}NULL`;
      if (v === "true") return `${q} IS ${negated ? "NOT " : ""}TRUE`;
      if (v === "false") return `${q} IS ${negated ? "NOT " : ""}FALSE`;
      if (v === "unknown") return `${q} IS ${negated ? "NOT " : ""}NULL`;
      throw pgrstErr(400, "PGRST100", `bad 'is' value: ${valueRaw}`);
    }
    case "cs":
      return `${q} ${negated ? "@>" : "@>"} ${bind(valueRaw, true)}`;
    case "cd":
      return `${q} ${negated ? "<@" : "<@"} ${bind(valueRaw, true)}`;
    case "ov":
      return `${q} ${negated ? "&& " : "&& "}${bind(valueRaw, true)}`;
    default:
      throw pgrstErr(
        400,
        "PGRST100",
        `unsupported filter operator '${op}' for column '${colName}'`,
        "Local PostgREST shim supports: eq,neq,gt,gte,lt,lte,like,ilike,in,is,cs,cd,ov"
      );
  }
}

/** Операторы, поддерживаемые шимом (PostgREST-подмножество supabase-js). */
const KNOWN_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is", "cs", "cd", "ov"] as const;

/** Значение фильтра: "eq.5" | "not.eq.5" | "in.(a,b)" → атом. */
function buildFilterValueAtom(table: IntrospectedTable, colName: string, value: string, params: unknown[]): string {
  let v = value;
  let negated = false;
  if (v.startsWith("not.")) {
    negated = true;
    v = v.slice(4);
  }
  const op = KNOWN_OPS.find((o) => v.startsWith(o + "."));
  if (!op) {
    throw pgrstErr(400, "PGRST100", `bad filter syntax for '${colName}': '${value}'`);
  }
  const rest = v.slice(op.length + 1);
  return buildFilterAtom(table, colName, (negated ? "not." : "") + op, rest, params);
}

/** Все фильтры из query (включая or=/and= деревья) → WHERE-фрагмент. */
function buildWhere(ctx: PgrstContext, table: IntrospectedTable, sharedParams?: unknown[]): WherePart {
  const params = sharedParams ?? [];
  const atoms: string[] = [];

  for (const [key, value] of ctx.searchParams.entries()) {
    if (key === "or" || key === "and") {
      atoms.push(buildLogicTree(ctx, table, key, value, params));
      continue;
    }
    if (RESERVED_PARAMS.has(key)) continue;
    // col=eq.v (формат supabase-js: значение параметра — оператор.значение)
    atoms.push(buildFilterValueAtom(table, key, value, params));
  }

  return { sql: atoms.length ? ` WHERE ${atoms.join(" AND ")}` : "", params };
}

/** or=(a.eq.1,b.eq.2) | and=(...) — рекурсивно, поддержка вложенности 1 уровень. */
function buildLogicTree(ctx: PgrstContext, table: IntrospectedTable, kind: "or" | "and", raw: string, params: unknown[]): string {
  let inner = raw.trim();
  if (inner.startsWith("(") && inner.endsWith(")")) inner = inner.slice(1, -1);
  if (!inner.trim()) return kind === "or" ? "FALSE" : "TRUE";
  const parts = splitTopLevel(inner).map((part) => {
    const t = part.trim();
    const treeMatch = t.match(/^(or|and)\s*=/i);
    if (treeMatch) {
      return buildLogicTree(ctx, table, treeMatch[1].toLowerCase() as "or" | "and", t.slice(treeMatch[0].length), params);
    }
    const dotIdx = t.indexOf(".");
    // ключ колонки может содержать точку? нет — колонки простые. "col=eq.v" или "col.op.v"
    const eqIdx = t.indexOf("=");
    if (eqIdx > -1) {
      return buildFilterValueAtom(table, t.slice(0, eqIdx).trim(), t.slice(eqIdx + 1).trim(), params);
    }
    const firstDot = t.indexOf(".");
    if (firstDot > 0) {
      // форма col.op.value без '=': email.eq.customer@x
      return buildFilterValueAtom(table, t.slice(0, firstDot).trim(), t.slice(firstDot + 1), params);
    }
    throw pgrstErr(400, "PGRST100", `bad logic tree element: '${t}'`);
  });
  if (!parts.length) return kind === "or" ? "FALSE" : "TRUE";
  return `(${parts.join(kind === "or" ? " OR " : " AND ")})`;
}

// ============================================================================
// order / limit / offset
// ============================================================================

function buildOrder(table: IntrospectedTable, raw: string): string {
  if (!raw) return "";
  const parts = splitTopLevel(raw).map((part) => {
    const segs = part.trim().split(".");
    const col = resolveColumn(table, segs[0]);
    const dir = segs[1]?.toLowerCase() === "desc" ? "DESC" : "ASC";
    const nulls = segs[2]?.toLowerCase();
    const nullsSql = nulls === "nullsfirst" ? " NULLS FIRST" : nulls === "nullslast" ? " NULLS LAST" : "";
    return `${quoteIdent(col.name)} ${dir}${nullsSql}`;
  });
  return ` ORDER BY ${parts.join(", ")}`;
}

// ============================================================================
// GET (select)
// ============================================================================

export async function handleSelect(ctx: PgrstContext, tableName: string): Promise<PgrstResult> {
  const table = resolveTable(ctx.intro, tableName);
  const prefer = (ctx.headers.get("prefer") || "").toLowerCase();
  const accept = ctx.headers.get("accept") || "";
  const wantsObject = accept.includes("vnd.pgrst.object");
  const countMode = /count=(exact|planned|estimated)/.exec(prefer)?.[1];
  const isHead = ctx.method === "HEAD";
  const headers: Record<string, string> = {};

  const selectRaw = ctx.searchParams.get("select") || "*";
  const items = parseSelectList(ctx, table, selectRaw);
  const embeds = planEmbeds(ctx, table, items);
  const hidden = new Set<string>();

  // скрытые колонки для join'а embed'ов
  for (const e of embeds) {
    const col = resolveColumn(table, e.thisColumn);
    if (!items.some((i) => i.column && i.column.name === col.name)) hidden.add(col.name);
  }

  const colsSql = [...items.filter((i) => !i.embed).map((i) => (i.column!.name === "*" ? "*" : `${quoteIdent(i.column!.name)}${i.alias ? ` AS ${quoteIdent(i.alias)}` : ""}`)), ...[...hidden].map((h) => quoteIdent(h))];
  const selectList = colsSql.length ? colsSql.join(", ") : "*";

  const where = buildWhere(ctx, table);
  const order = buildOrder(table, ctx.searchParams.get("order") || "");

  let limit: number | null = null;
  let offset = 0;
  const limitRaw = ctx.searchParams.get("limit");
  const offsetRaw = ctx.searchParams.get("offset");
  const rangeRaw = ctx.searchParams.get("range");
  if (rangeRaw) {
    const m = rangeRaw.match(/^(\d+)-(\d*)$/);
    if (m) {
      offset = parseInt(m[1], 10);
      limit = m[2] ? parseInt(m[2], 10) - offset + 1 : null;
    }
  }
  if (offsetRaw) offset = parseInt(offsetRaw, 10) || 0;
  if (limitRaw) limit = parseInt(limitRaw, 10);
  if (limit !== null && (!Number.isFinite(limit) || limit < 0)) limit = null;

  const countSql = countMode ? `, count(*) OVER() AS "__pgrst_count__"` : "";
  const limitSql = `${offset ? ` OFFSET ${offset}` : ""}${limit !== null ? ` LIMIT ${limit}` : ""}`;
  const sql = `SELECT ${selectList}${countSql} FROM ${quoteIdent(table.name)}${where.sql}${order}${limitSql}`;

  const res = await ctx.pool.query(sql, where.params);
  let rows = res.rows as Record<string, unknown>[];

  let total: number | null = null;
  if (countMode) {
    const first = rows[0] as Record<string, unknown> | undefined;
    total = first && "__pgrst_count__" in first ? Number(first["__pgrst_count__"]) : 0;
    rows = rows.map((r) => {
      const { ["__pgrst_count__"]: _drop, ...rest } = r;
      return rest;
    });
  }

  // Embedding: подзапросы IN (…)
  for (const plan of embeds) {
    const linkVals = [...new Set(rows.map((r) => r[plan.thisColumn]).filter((v) => v !== null && v !== undefined))];
    const relCols = parseSelectList(ctx, plan.relTable, plan.relSelect);
    const relList = relCols.filter((i) => i.column).map((i) => (i.column!.name === "*" ? `${quoteIdent(plan.relTable.name)}.*` : `${quoteIdent(plan.relTable.name)}.${quoteIdent(i.column!.name)}${i.alias ? ` AS ${quoteIdent(i.alias)}` : ""}`));
    const relListSql = relList.length ? relList.join(", ") : `${quoteIdent(plan.relTable.name)}.*`;
    const map = new Map<unknown, unknown>();
    const grouped = new Map<unknown, unknown[]>();
    if (linkVals.length) {
      const chunkSize = 500;
      const vals = linkVals as unknown[];
      for (let i = 0; i < vals.length; i += chunkSize) {
        const chunk = vals.slice(i, i + chunkSize);
        // = ANY($1) — pg-драйвер сам сериализует JS-массив в массив нужного типа
        const sqlSafe = `SELECT ${relListSql}, ${quoteIdent(plan.relTable.name)}.${quoteIdent(plan.relColumn)} AS "__link__" FROM ${quoteIdent(plan.relTable.name)} WHERE ${quoteIdent(plan.relTable.name)}.${quoteIdent(plan.relColumn)} = ANY($1)`;
        const res2 = await ctx.pool.query(sqlSafe, [chunk]);
        for (const r of res2.rows as Record<string, unknown>[]) {
          const key = r["__link__"];
          const { ["__link__"]: _link, ...rest } = r;
          if (plan.direction === "many-to-one") map.set(String(key), rest);
          else {
            const arr = grouped.get(String(key)) || [];
            arr.push(rest);
            grouped.set(String(key), arr);
          }
        }
      }
    }
    for (const r of rows) {
      const key = r[plan.thisColumn];
      if (plan.direction === "many-to-one") {
        r[plan.alias] = key === null || key === undefined ? null : map.get(String(key)) ?? null;
      } else {
        r[plan.alias] = key === null || key === undefined ? [] : grouped.get(String(key)) ?? [];
      }
    }
  }

  // скрытые связующие колонки — убрать из вывода
  if (hidden.size) {
    rows = rows.map((r) => {
      const copy = { ...r };
      for (const h of hidden) delete copy[h];
      return copy;
    });
  }

  if (countMode) {
    headers["Content-Range"] = rows.length ? `0-${rows.length - 1}/${total}` : `*/${total}`;
    headers["X-Total-Count"] = String(total);
  }

  if (wantsObject) {
    if (rows.length === 1) return { status: 200, json: rows[0], headers };
    throw new PgrstError(406, "PGRST116", `JSON object requested, multiple (or no) rows returned`, null, null);
  }

  if (isHead) return { status: 200, json: undefined, headers };
  return { status: 200, json: rows, headers };
}

// ============================================================================
// INSERT / UPSERT
// ============================================================================

function resolveRowColumns(table: IntrospectedTable, rows: Record<string, unknown>[], columnsParam: string | null): { col: IntrospectedColumn; value: unknown }[][] {
  const names = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row)) names.add(k);
  if (columnsParam) for (const k of splitTopLevel(columnsParam)) names.add(unquote(k));
  const cols: IntrospectedColumn[] = [...names].map((n) => resolveColumn(table, n));
  return rows.map((row) => cols.map((c) => ({ col: c, value: row[c.name] !== undefined ? row[c.name] : row[c.name.toLowerCase()] !== undefined ? row[c.name.toLowerCase()] : null })));
}

export async function handleInsert(ctx: PgrstContext, tableName: string): Promise<PgrstResult> {
  const table = resolveTable(ctx.intro, tableName);
  const prefer = (ctx.headers.get("prefer") || "").toLowerCase();
  const accept = ctx.headers.get("accept") || "";
  const wantsObject = accept.includes("vnd.pgrst.object");
  const returnRepresentation = prefer.includes("return=representation");
  const resolution = /resolution=(merge-duplicates|ignore-duplicates)/.exec(prefer)?.[1];
  const onConflict = ctx.searchParams.get("on_conflict");
  const columnsParam = ctx.searchParams.get("columns");

  let body = ctx.body;
  if (body === null || body === undefined) body = [];
  if (!Array.isArray(body)) body = [body];
  const rows = body as Record<string, unknown>[];
  if (!rows.length) {
    return returnRepresentation ? { status: 201, json: [], headers: {} } : { status: 204, json: undefined, headers: {} };
  }

  const rowsCols = resolveRowColumns(table, rows, columnsParam);
  const cols = rowsCols[0].map((c) => c.col);
  const colNames = cols.map((c) => quoteIdent(c.name)).join(", ");

  const valuesSql: string[] = [];
  const params: unknown[] = [];
  for (const row of rowsCols) {
    const placeholders = row.map(({ col, value }) => {
      params.push(value === undefined ? null : value);
      const cast = pgCastTarget(col);
      return cast ? `$${params.length}::${cast}` : `$${params.length}`;
    });
    valuesSql.push(`(${placeholders.join(", ")})`);
  }

  let conflictSql = "";
  if (onConflict && resolution === "merge-duplicates") {
    const conflictCols = splitTopLevel(onConflict).map((c) => quoteIdent(resolveColumn(table, unquote(c)).name));
    const updateCols = cols.filter((c) => !conflictCols.includes(quoteIdent(c.name)) && !table.pks.includes(c.name));
    const setSql = updateCols.map((c) => `${quoteIdent(c.name)} = EXCLUDED.${quoteIdent(c.name)}`).join(", ");
    conflictSql = ` ON CONFLICT (${conflictCols.join(", ")}) DO UPDATE${setSql ? ` SET ${setSql}` : ""}`;
  } else if (onConflict && resolution === "ignore-duplicates") {
    const conflictCols = splitTopLevel(onConflict).map((c) => quoteIdent(resolveColumn(table, unquote(c)).name));
    conflictSql = ` ON CONFLICT (${conflictCols.join(", ")}) DO NOTHING`;
  }

  const returningSql = returnRepresentation ? ` RETURNING ${selectFragment(table, parseSelectList(ctx, table, ctx.searchParams.get("select") || "*"), true)}` : "";
  const sql = `INSERT INTO ${quoteIdent(table.name)} (${colNames}) VALUES ${valuesSql.join(", ")}${conflictSql}${returningSql}`;

  const res = await ctx.pool.query(sql, params);
  const outRows = res.rows as Record<string, unknown>[];

  if (!returnRepresentation) return { status: 204, json: undefined, headers: {} };
  if (wantsObject) {
    if (outRows.length === 1) return { status: 201, json: outRows[0], headers: {} };
    throw new PgrstError(406, "PGRST116", `JSON object requested, multiple (or no) rows returned`);
  }
  return { status: 201, json: outRows, headers: {} };
}

// ============================================================================
// PATCH / DELETE
// ============================================================================

function requireFilters(where: WherePart, action: string): void {
  if (!where.sql) {
    throw pgrstErr(400, "PGRST100", `${action} requires at least one filter`, "supabase-js always adds .eq(...) filters");
  }
}

export async function handleUpdate(ctx: PgrstContext, tableName: string): Promise<PgrstResult> {
  const table = resolveTable(ctx.intro, tableName);
  const prefer = (ctx.headers.get("prefer") || "").toLowerCase();
  const accept = ctx.headers.get("accept") || "";
  const wantsObject = accept.includes("vnd.pgrst.object");
  const returnRepresentation = prefer.includes("return=representation") || !prefer.includes("return=minimal");

  const body = ctx.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).length) {
    throw pgrstErr(400, "PGRST100", "PATCH requires a non-empty JSON object body");
  }
  const setEntries = Object.entries(body).map(([k, v]) => {
    const col = resolveColumn(table, k);
    return { col, v };
  });
  const params: unknown[] = [];
  const setSql = setEntries
    .map(({ col, v }) => {
      params.push(v);
      const cast = pgCastTarget(col);
      return `${quoteIdent(col.name)} = ${cast ? `$${params.length}::${cast}` : `$${params.length}`}`;
    })
    .join(", ");
  // where-атомы получают индексы, продолжающие params (один общий массив)
  const where = buildWhere(ctx, table, params);
  requireFilters(where, "UPDATE");

  const returningSql = returnRepresentation ? ` RETURNING ${selectFragment(table, parseSelectList(ctx, table, ctx.searchParams.get("select") || "*"), true)}` : "";
  const sql = `UPDATE ${quoteIdent(table.name)} SET ${setSql}${where.sql}${returningSql}`;

  const res = await ctx.pool.query(sql, params);
  const outRows = res.rows as Record<string, unknown>[];

  if (!returnRepresentation) return { status: 204, json: undefined, headers: {} };
  if (wantsObject) {
    if (outRows.length === 1) return { status: 200, json: outRows[0], headers: {} };
    throw new PgrstError(406, "PGRST116", `JSON object requested, multiple (or no) rows returned`);
  }
  return { status: 200, json: outRows, headers: {} };
}

export async function handleDelete(ctx: PgrstContext, tableName: string): Promise<PgrstResult> {
  const table = resolveTable(ctx.intro, tableName);
  const prefer = (ctx.headers.get("prefer") || "").toLowerCase();
  const returnRepresentation = prefer.includes("return=representation");
  const where = buildWhere(ctx, table);
  requireFilters(where, "DELETE");
  const returningSql = returnRepresentation ? ` RETURNING ${selectFragment(table, parseSelectList(ctx, table, ctx.searchParams.get("select") || "*"), true)}` : "";
  const sql = `DELETE FROM ${quoteIdent(table.name)}${where.sql}${returningSql}`;
  const res = await ctx.pool.query(sql, where.params);
  if (!returnRepresentation) return { status: 204, json: undefined, headers: {} };
  return { status: 200, json: res.rows, headers: {} };
}

// ============================================================================
// RPC
// ============================================================================

const TYPE_CAST_MAP: Record<string, string> = {
  int2: "smallint",
  int4: "integer",
  int8: "bigint",
  float4: "real",
  float8: "double precision",
  bool: "boolean",
  bpchar: "char",
  varchar: "character varying",
  timestamptz: "timestamptz",
};

function castForTypname(t: string): string {
  if (t.startsWith("_")) return `${TYPE_CAST_MAP[t.slice(1)] ?? t.slice(1)}[]`;
  return TYPE_CAST_MAP[t] ?? t;
}

function pickFunction(intro: SchemaIntrospection, fnName: string, providedKeys: string[]) {
  const candidates = intro.funcs.get(fnName.toLowerCase());
  if (!candidates?.length) {
    throw pgrstErr(404, "PGRST202", `Could not find the function public.${fnName} in the schema cache`);
  }
  const keys = new Set(providedKeys.map((k) => k.toLowerCase()));
  let best = candidates[0];
  let bestScore = -1;
  for (const cand of candidates) {
    const argNames = cand.argNames.map((a) => a.toLowerCase());
    const allProvided = [...keys].every((k) => argNames.includes(k));
    if (!allProvided) continue;
    const score = cand.argNames.filter(Boolean).length;
    if (score > bestScore) {
      best = cand;
      bestScore = score;
    }
  }
  return best;
}

export async function handleRpc(ctx: PgrstContext, fnName: string): Promise<PgrstResult> {
  let args: Record<string, unknown> = {};
  if (ctx.method === "GET") {
    for (const [k, v] of ctx.searchParams.entries()) {
      if (RESERVED_PARAMS.has(k)) continue;
      let parsed: unknown = v;
      try {
        parsed = JSON.parse(v);
      } catch {
        /* строка как есть */
      }
      args[k] = parsed;
    }
  } else {
    if (ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body)) args = ctx.body as Record<string, unknown>;
    else if (ctx.body !== null && ctx.body !== undefined) {
      // скалярный аргумент без имени
      const fn = pickFunction(ctx.intro, fnName, []);
      if (fn.argTypes.length === 1) {
        args = { [fn.argNames[0] || "arg"]: ctx.body };
      } else {
        throw pgrstErr(400, "PGRST100", `rpc ${fnName} expects named arguments (object body)`);
      }
    }
  }

  const fn = pickFunction(ctx.intro, fnName, Object.keys(args));
  const params: unknown[] = [];
  const callParts: string[] = [];
  fn.argNames.forEach((name, i) => {
    const key = name || Object.keys(args)[i];
    if (key && Object.prototype.hasOwnProperty.call(args, key)) {
      const val = args[key];
      const isJson = fn.argTypes[i] === "json" || fn.argTypes[i] === "jsonb";
      params.push(isJson && val !== null && typeof val === "object" ? JSON.stringify(val) : val);
      const cast = castForTypname(fn.argTypes[i]);
      callParts.push(`"${key}" := $${params.length}${cast ? `::${cast}` : ""}`);
    }
  });

  const callSql = `SELECT public.${quoteIdent(fn.name)}(${callParts.join(", ")})`;
  // Composite-результаты (SETOF table / table) оборачиваем в JSON, как делает
  // PostgREST: скаляры возвращаются как есть, записи — объектами.
  let res;
  if (fn.retTypeKind === "c") {
    const wrapSql = fn.retSet
      ? `SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS out FROM (${callSql}) t`
      : `SELECT to_jsonb(t) AS out FROM (${callSql}) t`;
    res = await ctx.pool.query(wrapSql, params);
    const out = (res.rows[0] as { out: unknown } | undefined)?.out ?? (fn.retSet ? [] : null);
    return { status: 200, json: out, headers: {} };
  }
  res = await ctx.pool.query(callSql, params);
  const rows = res.rows as Record<string, unknown>[];

  if (fn.isVoid) return { status: 204, json: undefined, headers: {} };

  const firstKey = rows[0] ? Object.keys(rows[0])[0] : null;
  if (fn.retSet) {
    if (fn.retTypeKind === "b" || fn.retTypeKind === "e") {
      // SETOF scalar
      return { status: 200, json: rows.map((r) => Object.values(r)[0]), headers: {} };
    }
    return { status: 200, json: rows, headers: {} };
  }
  if (fn.retTypeKind === "b" || fn.retTypeKind === "e") {
    return { status: 200, json: rows[0] ? rows[0][firstKey as string] : null, headers: {} };
  }
  return { status: 200, json: rows[0] ?? null, headers: {} };
}
