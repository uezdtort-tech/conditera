/**
 * introspect.ts — кэшируемая интроспекция information_schema / pg_proc.
 *
 * Нужно translate.ts, чтобы:
 *   • матчить имена колонок без учёта регистра (и помнить точное имя для кавычек);
 *   • знать PK/FK для 1-уровневого resource-embedding;
 *   • знать сигнатуры public-функций для rpc (имена аргументов + типы).
 *
 * Кэш в globalThis, TTL 5 минут; сбрасывается при 42P01 (таблица не найдена).
 */

import type { Pool } from "pg";

export interface IntrospectedColumn {
  name: string; // точное имя (для quoted-идентификатора)
  dataType: string; // information_schema.columns.data_type
  udtName: string; // udt_name (uuid, _text, jsonb, <enum name>…)
  nullable: boolean;
}

export interface IntrospectedTable {
  name: string;
  columns: Map<string, IntrospectedColumn>; // key = name.toLowerCase()
  pks: string[]; // точные имена PK-колонок
}

export interface IntrospectedFk {
  table: string; // referencing table (точное имя)
  column: string; // referencing column
  refTable: string; // referenced table
  refColumn: string; // referenced column
}

export interface IntrospectedFunction {
  name: string;
  argNames: string[]; // может содержать пустые строки для безымянных
  argTypes: string[]; // pg_type.typname (напр. "text", "_uuid", "int4")
  retType: string; // typname возвращаемого типа
  retTypeKind: string; // pg_type.typtype: 'b','c','e','p','d','r','m'
  retSet: boolean; // RETURNS SETOF
  isVoid: boolean;
}

export interface SchemaIntrospection {
  ts: number;
  tables: Map<string, IntrospectedTable>; // key = lower name
  fks: IntrospectedFk[];
  funcs: Map<string, IntrospectedFunction[]>; // key = lower name
}

const TTL_MS = 5 * 60 * 1000;

const globalForIntrospect = globalThis as unknown as {
  __pgrstIntrospection?: SchemaIntrospection;
  __pgrstIntrospectPending?: Promise<SchemaIntrospection>;
};

export function invalidateIntrospection(): void {
  globalForIntrospect.__pgrstIntrospection = undefined;
  globalForIntrospect.__pgrstIntrospectPending = undefined;
}

export async function getIntrospection(pool: Pool): Promise<SchemaIntrospection> {
  const cached = globalForIntrospect.__pgrstIntrospection;
  if (cached && Date.now() - cached.ts < TTL_MS) return cached;
  if (globalForIntrospect.__pgrstIntrospectPending) return globalForIntrospect.__pgrstIntrospectPending;

  const pending = load(pool).finally(() => {
    globalForIntrospect.__pgrstIntrospectPending = undefined;
  });
  globalForIntrospect.__pgrstIntrospectPending = pending;
  return pending;
}

/**
 * Дефенсивный парсер PG array literal: node-pg парсит text[] сам, но
 * в bun-окружении (и некоторых драйверных комбинациях) массивы приходят
 * строкой "{a,b}". Приводим к string[] в обоих случаях.
 */
function parsePgArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v !== "string") return [];
  const t = v.trim().replace(/^\{/, "").replace(/\}$/, "");
  if (!t) return [];
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '"') {
      if (inQuote && cur.endsWith("\\")) cur = cur.slice(0, -1) + '"';
      else inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function load(pool: Pool): Promise<SchemaIntrospection> {
  const client = await pool.connect();
  try {
    const tablesRes = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );

    const columnsRes = await client.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
    }>(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns WHERE table_schema = 'public'`
    );

    const pksRes = await client.query<{ table_name: string; column_name: string }>(
      `SELECT kcu.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
       ORDER BY kcu.ordinal_position`
    );

    const fksRes = await client.query<{
      table_name: string;
      column_name: string;
      ref_table: string;
      ref_column: string;
    }>(
      `SELECT tc.table_name, kcu.column_name,
              ccu.table_name AS ref_table, ccu.column_name AS ref_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`
    );

    const funcsRes = await client.query<{
      proname: string;
      argnames: string[] | null;
      argtypes: unknown;
      rettypname: string;
      rettypekind: string;
      proretset: boolean;
      isvoid: boolean;
    }>(
      `SELECT p.proname,
              p.proargnames AS argnames,
              p.proargtypes,
              rt.typname AS rettypname,
              rt.typtype AS rettypekind,
              p.proretset,
              (rt.typname = 'void') AS isvoid
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_type rt ON rt.oid = p.prorettype
       WHERE n.nspname = 'public'`
    );

    const argTypesRes = await client.query<{ proname: string; types: string[] | null }>(
      `SELECT p.proname,
              (SELECT array_agg(t.typname ORDER BY u.ord)
                 FROM unnest(p.proargtypes) WITH ORDINALITY AS u(oid, ord)
                 JOIN pg_type t ON t.oid = u.oid) AS types
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'`
    );
    const argTypesByName = new Map(argTypesRes.rows.map((r) => [r.proname, r.types]));

    const tables = new Map<string, IntrospectedTable>();
    for (const row of tablesRes.rows) {
      tables.set(row.table_name.toLowerCase(), {
        name: row.table_name,
        columns: new Map(),
        pks: [],
      });
    }
    for (const col of columnsRes.rows) {
      const table = tables.get(col.table_name.toLowerCase());
      if (!table) continue;
      table.columns.set(col.column_name.toLowerCase(), {
        name: col.column_name,
        dataType: col.data_type,
        udtName: col.udt_name,
        nullable: col.is_nullable === "YES",
      });
    }
    for (const pk of pksRes.rows) {
      const table = tables.get(pk.table_name.toLowerCase());
      if (table && !table.pks.includes(pk.column_name)) table.pks.push(pk.column_name);
    }

    const fks: IntrospectedFk[] = fksRes.rows.map((r) => ({
      table: r.table_name,
      column: r.column_name,
      refTable: r.ref_table,
      refColumn: r.ref_column,
    }));

    const funcs = new Map<string, IntrospectedFunction[]>();
    for (const row of funcsRes.rows) {
      const types = parsePgArray(argTypesByName.get(row.proname));
      const names = parsePgArray(row.argnames);
      const fn: IntrospectedFunction = {
        name: row.proname,
        argNames: names,
        argTypes: types,
        retType: row.rettypname,
        retTypeKind: row.rettypekind,
        retSet: row.proretset,
        isVoid: row.isvoid,
      };
      const key = row.proname.toLowerCase();
      const list = funcs.get(key);
      if (list) list.push(fn);
      else funcs.set(key, [fn]);
    }

    const fresh: SchemaIntrospection = { ts: Date.now(), tables, fks, funcs };
    globalForIntrospect.__pgrstIntrospection = fresh;
    return fresh;
  } finally {
    client.release();
  }
}

// ============================================================================
// Хелперы резолва идентификаторов
// ============================================================================

/** Первый гейт безопасности + кавычки для SQL. Имена приходят только из интроспекции. */
export function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe identifier rejected: ${name}`);
  }
  return `"${name}"`;
}

export function resolveTable(
  intro: SchemaIntrospection,
  requested: string
): IntrospectedTable {
  const table = intro.tables.get(requested.toLowerCase());
  if (!table) {
    const e = new Error(`Could not find the table 'public.${requested}' in the schema cache`) as Error & {
      pgrstCode?: string;
      pgrstStatus?: number;
    };
    e.pgrstCode = "PGRST205";
    e.pgrstStatus = 404;
    throw e;
  }
  return table;
}

export function resolveColumn(
  table: IntrospectedTable,
  requested: string
): IntrospectedColumn {
  const col = table.columns.get(requested.toLowerCase());
  if (!col) {
    const e = new Error(`column ${table.name}.${requested} does not exist`) as Error & {
      pgrstCode?: string;
      pgrstStatus?: number;
    };
    e.pgrstCode = "42703";
    e.pgrstStatus = 400;
    throw e;
  }
  return col;
}

/** Pg-тип для явного каста параметра ($1::uuid). Возвращает null если каст не нужен. */
export function pgCastTarget(col: IntrospectedColumn): string | null {
  const { dataType, udtName } = col;
  if (dataType === "ARRAY" || udtName.startsWith("_")) {
    const elem = udtName.startsWith("_") ? udtName.slice(1) : udtName;
    return `${elem}[]`;
  }
  switch (dataType) {
    case "uuid":
    case "json":
    case "jsonb":
    case "date":
    case "time without time zone":
    case "time with time zone":
    case "timestamp without time zone":
    case "timestamp with time zone":
    case "interval":
    case "inet":
    case "cidr":
    case "macaddr":
    case "bytea":
      return udtName;
    case "USER-DEFINED":
      // enum / домены — каст к точному имени типа
      return udtName;
    default:
      return null; // numeric/int/text/bool — PG выведет сам
  }
}
