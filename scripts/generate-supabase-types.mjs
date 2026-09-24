#!/usr/bin/env node
/**
 * generate-supabase-types.mjs
 *
 * Генерирует supabase-совместимый `Database` TypeScript-тип из ЖИВОЙ БД,
 * без Docker и без Supabase CLI (интроспекция через information_schema).
 *
 * Использование:
 *   node scripts/generate-supabase-types.mjs postgresql://postgres@localhost:5432/conditera
 *
 * Вывод: src/lib/supabase/types.generated.ts
 *
 * Аналог: supabase gen types typescript --db-url <...>
 * (CLI требует Docker — этот скрипт работает где угодно, где есть psql-доступ).
 */
import pg from "pg";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_URL = process.env.DB_URL || "postgresql://postgres@localhost:5432/conditera";
const dbUrl = process.argv[2] || DEFAULT_URL;
const OUT = join(__dirname, "..", "src", "lib", "supabase", "types.generated.ts");
const SCHEMAS = ["public", "storage"];

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();

// ---------- 1. Enums ----------
const { rows: enumRows } = await client.query(`
  SELECT n.nspname AS schema, t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS labels
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = ANY($1)
  GROUP BY n.nspname, t.typname
  ORDER BY t.typname
`, [SCHEMAS]);
const enums = Object.fromEntries(enumRows.map(r => [r.name, r.labels]));

// ---------- 2. Tables & columns ----------
const { rows: colRows } = await client.query(`
  SELECT
    c.table_schema, c.table_name, c.column_name,
    c.data_type, c.udt_name, c.is_nullable, c.column_default,
    c.character_maximum_length,
    (c.column_default IS NOT NULL) AS has_default,
    EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      WHERE tc.table_schema = c.table_schema
        AND tc.table_name = c.table_name
        AND tc.constraint_type = 'PRIMARY KEY'
        AND kcu.column_name = c.column_name
    ) AS is_primary_key
  FROM information_schema.columns c
  WHERE c.table_schema = ANY($1)
  ORDER BY c.table_schema, c.table_name, c.ordinal_position
`, [SCHEMAS]);

// ---------- 3. Foreign keys ----------
const { rows: fkRows } = await client.query(`
  SELECT
    tc.constraint_name,
    tc.table_schema AS schema,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS referenced_table,
    ccu.column_name AS referenced_column,
    (rc.delete_rule = 'CASCADE') AS on_delete_cascade
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  LEFT JOIN information_schema.referential_constraints rc
    ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = ANY($1)
  ORDER BY tc.table_name, tc.constraint_name
`, [SCHEMAS]);

// ---------- 4. Type mapping ----------
const Json = "Json";

function mapType(udtName, dataType, tableName, columnName) {
  if (udtName && enums[udtName]) return udtName;
  if (dataType === "ARRAY") {
    // udt_name for arrays: _int4, _text ...
    const base = mapType(udtName.replace(/^_/, ""), "BASE", tableName, columnName);
    return `${base}[]`;
  }
  switch (udtName) {
    case "int2": case "int4": case "int8":
    case "float4": case "float8": case "numeric":
    case "oid":
      return "number";
    case "bool": return "boolean";
    case "json": case "jsonb": return Json;
    case "uuid": case "text": case "varchar": case "bpchar":
    case "citext": case "date": case "time": case "timetz":
    case "timestamp": case "timestamptz": case "money":
    case "inet": case "cidr": case "macaddr": case "bytea":
    case "xml": case "interval":
      return "string";
    default:
      return "unknown";
  }
}

// ---------- 5. Emit ----------
const tablesBySchema = {};
for (const r of colRows) {
  (tablesBySchema[r.table_schema] ??= {})[r.table_name] ??= [];
  tablesBySchema[r.table_schema][r.table_name].push(r);
}

const fkByTable = {};
for (const r of fkRows) {
  (fkByTable[r.schema] ??= {});
  (fkByTable[r.schema][r.table_name] ??= []).push(r);
}

function pascalIdent(name) {
  // Identifiers with special chars need quoted access: ["caseSensitive"]
  return /^[""a-zA-Z0-9_]+$/.test(name) ? name : `["${name}"]`;
}

function quoteEnum(label) {
  return `"${label.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

let out = `/* eslint-disable */
/**
 * types.generated.ts — АВТОГЕНЕРИРОВАННЫЙ supabase-совместимый Database тип.
 *
 * НЕ РЕДАКТИРОВАТЬ ВРУЧНУЮ.
 * Генератор: scripts/generate-supabase-types.mjs (работает без Docker/CLI):
 *   node scripts/generate-supabase-types.mjs "postgresql://postgres@localhost:5432/conditera"
 *
 * Схемы: ${SCHEMAS.join(", ")}. Кол-во таблиц: ${Object.values(tablesBySchema.public || {}).length} (public) + ${Object.values(tablesBySchema.storage || {}).length} (storage).
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// ---- Enums (top-level, как в supabase gen types) ----
`;

for (const r of enumRows) {
  out += `export type ${r.name} = ${r.labels.map(quoteEnum).join(" | ")}\n`;
}

out += `\nexport type Database = {\n`;

for (const schema of SCHEMAS) {
  const tables = tablesBySchema[schema] || {};
  out += `  ${schema}: {\n    Tables: {\n`;
  for (const [tName, cols] of Object.entries(tables)) {
    out += `      ${pascalIdent(tName)}: {\n        Row: {\n`;
    for (const c of cols) {
      const ts = mapType(c.udt_name, c.data_type, tName, c.column_name);
      out += `          ${pascalIdent(c.column_name)}: ${ts}${c.is_nullable === "YES" ? " | null" : ""}\n`;
    }
    out += `        }\n        Insert: {\n`;
    for (const c of cols) {
      const ts = mapType(c.udt_name, c.data_type, tName, c.column_name);
      const optional = c.has_default || c.is_nullable === "YES";
      const nullable = c.is_nullable === "YES" ? " | null" : "";
      out += `          ${pascalIdent(c.column_name)}${optional ? "?" : ""}: ${ts}${nullable}\n`;
    }
    out += `        }\n        Update: {\n`;
    for (const c of cols) {
      const ts = mapType(c.udt_name, c.data_type, tName, c.column_name);
      const nullable = c.is_nullable === "YES" ? " | null" : "";
      out += `          ${pascalIdent(c.column_name)}?: ${ts}${nullable}\n`;
    }
    out += `        }\n        Relationships: [\n`;
    const fks = fkByTable[schema]?.[tName] || [];
    fks.forEach((fk, i) => {
      const comma = i < fks.length - 1 ? "," : "";
      out += `          {\n            foreignKeyName: "${fk.constraint_name}"\n            columns: ["${fk.column_name}"]\n            isOneToOne: false\n            referencedRelation: "${fk.referenced_table}"\n            referencedColumns: ["${fk.referenced_column}"]\n          }${comma}\n`;
    });
    out += `        ]\n      }\n`;
  }
  out += `    }\n    Views: {\n`;
  out += `    }\n    Functions: {\n    }\n    Enums: {\n`;
  for (const r of enumRows.filter(e => e.schema === schema)) {
    out += `      ${r.name}: ${r.name}\n`;
  }
  out += `    }\n    CompositeTypes: {\n      [_ in never]: never\n    }\n  }\n`;
}
out += `}\n\n// ---- Convenience row types (часто используемые таблицы) ----\n`;

// Convenience aliases для ключевых таблиц
const convenience = [
  ["public", "confectioners", "ConfectionerRow"],
  ["public", "confectioner_ateliers", "ConfectionerAtelierRow"],
  ["public", "profiles", "ProfileRow"],
  ["public", "user_roles", "UserRoleRow"],
  ["public", "addresses", "AddressRow"],
  ["public", "products", "ProductRow"],
];
for (const [schema, table, alias] of convenience) {
  if (tablesBySchema[schema]?.[table]) {
    out += `export type ${alias} = Database["${schema}"]["Tables"]["${table}"]["Row"]\n`;
  }
}

out += `export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"]\n`;
out += `export default Database\n`;

writeFileSync(OUT, out, "utf-8");
console.log(`OK: ${OUT}`);
console.log(`public tables: ${Object.keys(tablesBySchema.public || {}).length}, storage tables: ${Object.keys(tablesBySchema.storage || {}).length}, enums: ${enumRows.length}, fks: ${fkRows.length}`);

await client.end();
