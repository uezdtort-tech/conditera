#!/usr/bin/env node
/**
 * Read-only inventory of the two legacy Conditera PostgreSQL sources before PG17 cutover.
 *
 * Required environment:
 *   AUDIT_PG15_DATABASE_URL - former Supabase PostgreSQL 15 database
 *   AUDIT_PG18_DATABASE_URL - former Conditera PostgreSQL 18 database
 *
 * The report contains schema metadata, relation sizes/statistics, selected exact
 * metadata-table counts, foreign keys, RLS policies, extensions and role flags.
 * It never selects business/auth/storage row values and never writes to either DB.
 *
 * For an expensive exact row-count inventory of every table:
 *   AUDIT_EXACT_COUNTS=1 node scripts/db/audit-dual-postgres.mjs
 *
 * Save output securely; connection strings and credentials are never included.
 */
import { Client } from "pg";

const sources = [
  { label: "legacy_supabase_pg15", url: process.env.AUDIT_PG15_DATABASE_URL },
  { label: "legacy_conditera_pg18", url: process.env.AUDIT_PG18_DATABASE_URL },
];

const schemaNames = [
  "public", "auth", "storage", "extensions", "graphql_public",
  "cron", "_realtime", "_analytics", "vault",
];

const alwaysExactTables = new Set([
  "public.schema_migrations",
  "auth.schema_migrations",
  "storage.migrations",
  "storage.buckets",
]);

const exactAllTables = process.env.AUDIT_EXACT_COUNTS === "1";
const statementTimeoutMs = Number(process.env.AUDIT_STATEMENT_TIMEOUT_MS || 60000);

function quoteIdent(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

function normalizeList(rows, key) {
  return rows.map((row) => String(row[key])).sort();
}

async function inspectSource(source) {
  if (!source.url) {
    const variableName = source.label === "legacy_supabase_pg15"
      ? "AUDIT_PG15_DATABASE_URL"
      : "AUDIT_PG18_DATABASE_URL";
    throw new Error("Missing required environment variable " + variableName);
  }

  const client = new Client({
    connectionString: source.url,
    connectionTimeoutMillis: 15000,
    statement_timeout: statementTimeoutMs,
    query_timeout: statementTimeoutMs + 5000,
    application_name: "conditera-dual-postgres-readonly-audit",
  });

  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '" + Math.max(1000, statementTimeoutMs) + "ms'");

    const server = await client.query(
      "SELECT current_database() AS database_name, " +
      "current_setting('server_version') AS server_version, " +
      "current_setting('server_version_num')::integer AS server_version_num, " +
      "current_setting('transaction_read_only')::boolean AS read_only, " +
      "current_setting('TimeZone') AS timezone"
    );

    if (server.rows[0].read_only !== true) {
      throw new Error(source.label + ": transaction_read_only is not true");
    }

    const schemas = await client.query(
      "SELECT nspname AS schema_name FROM pg_namespace " +
      "WHERE nspname = ANY($1::text[]) ORDER BY nspname",
      [schemaNames]
    );

    const tablesResult = await client.query(
      "SELECT n.nspname AS schema_name, c.relname AS table_name, " +
      "c.relkind AS relation_kind, GREATEST(c.reltuples::bigint, -1) AS estimated_rows, " +
      "pg_total_relation_size(c.oid)::bigint AS total_bytes, " +
      "c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced " +
      "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r', 'p', 'm') " +
      "ORDER BY n.nspname, c.relname",
      [schemaNames]
    );

    const tables = tablesResult.rows.map((row) => ({
      schema: row.schema_name,
      name: row.table_name,
      relation_kind: row.relation_kind,
      estimated_rows: Number(row.estimated_rows) < 0 ? null : Number(row.estimated_rows),
      total_bytes: Number(row.total_bytes),
      rls_enabled: row.rls_enabled,
      rls_forced: row.rls_forced,
      exact_rows: null,
    }));

    for (const table of tables) {
      const key = table.schema + "." + table.name;
      if (exactAllTables || alwaysExactTables.has(key)) {
        const count = await client.query(
          "SELECT count(*)::text AS row_count FROM " +
          quoteIdent(table.schema) + "." + quoteIdent(table.name)
        );
        table.exact_rows = count.rows[0].row_count;
      }
    }

    const columnsResult = await client.query(
      "SELECT table_schema, table_name, ordinal_position, column_name, data_type, " +
      "udt_schema, udt_name, is_nullable, column_default " +
      "FROM information_schema.columns WHERE table_schema = ANY($1::text[]) " +
      "ORDER BY table_schema, table_name, ordinal_position",
      [schemaNames]
    );

    const constraintsResult = await client.query(
      "SELECT source_ns.nspname AS source_schema, source_rel.relname AS source_table, " +
      "con.conname AS constraint_name, con.contype AS constraint_type, " +
      "target_ns.nspname AS target_schema, target_rel.relname AS target_table, " +
      "pg_get_constraintdef(con.oid, true) AS definition, con.convalidated AS validated " +
      "FROM pg_constraint con " +
      "JOIN pg_class source_rel ON source_rel.oid = con.conrelid " +
      "JOIN pg_namespace source_ns ON source_ns.oid = source_rel.relnamespace " +
      "LEFT JOIN pg_class target_rel ON target_rel.oid = con.confrelid " +
      "LEFT JOIN pg_namespace target_ns ON target_ns.oid = target_rel.relnamespace " +
      "WHERE source_ns.nspname = ANY($1::text[]) AND con.contype IN ('p', 'u', 'f', 'c', 'x') " +
      "ORDER BY source_ns.nspname, source_rel.relname, con.conname",
      [schemaNames]
    );

    const policiesResult = await client.query(
      "SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check " +
      "FROM pg_policies WHERE schemaname = ANY($1::text[]) " +
      "ORDER BY schemaname, tablename, policyname",
      [schemaNames]
    );

    const extensionsResult = await client.query(
      "SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema " +
      "FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY e.extname"
    );

    const rolesResult = await client.query(
      "SELECT rolname AS name, rolsuper AS superuser, rolcreatedb AS createdb, " +
      "rolcreaterole AS createrole, rolreplication AS replication, " +
      "rolbypassrls AS bypassrls, rolcanlogin AS can_login FROM pg_roles " +
      "WHERE rolname IN ('postgres', 'supabase_admin', 'supabase_auth_admin', " +
      "'supabase_storage_admin', 'authenticator', 'anon', 'authenticated', " +
      "'service_role', 'conditera', 'supabase_functions_admin', 'dashboard_user') " +
      "ORDER BY rolname"
    );

    const tableKeys = new Set(tables.map((table) => table.schema + "." + table.name));
    const columnKeys = new Set(columnsResult.rows.map((column) =>
      column.table_schema + "." + column.table_name + "." + column.column_name
    ));

    let profileAuthOrphans = null;
    if (tableKeys.has("public.profiles") && tableKeys.has("auth.users") &&
        columnKeys.has("public.profiles.id") && columnKeys.has("auth.users.id")) {
      const orphanResult = await client.query(
        "SELECT count(*)::text AS orphan_count FROM public.profiles p " +
        "WHERE p.id IS NOT NULL AND NOT EXISTS " +
        "(SELECT 1 FROM auth.users u WHERE u.id::text = p.id::text)"
      );
      profileAuthOrphans = orphanResult.rows[0].orphan_count;
    }

    let storageOwnerNotMatchingAuth = null;
    if (tableKeys.has("storage.objects") && tableKeys.has("auth.users") &&
        columnKeys.has("storage.objects.owner") && columnKeys.has("auth.users.id")) {
      const ownerResult = await client.query(
        "SELECT count(*)::text AS nonmatching_owner_count FROM storage.objects o " +
        "WHERE o.owner IS NOT NULL AND NOT EXISTS " +
        "(SELECT 1 FROM auth.users u WHERE u.id::text = o.owner::text)"
      );
      storageOwnerNotMatchingAuth = ownerResult.rows[0].nonmatching_owner_count;
    }

    await client.query("COMMIT");
    transactionOpen = false;

    return {
      label: source.label,
      server: server.rows[0],
      read_only_verified: true,
      schemas: normalizeList(schemas.rows, "schema_name"),
      table_count: tables.length,
      tables,
      columns: columnsResult.rows,
      constraints: constraintsResult.rows,
      rls_policies: policiesResult.rows,
      extensions: extensionsResult.rows,
      roles: rolesResult.rows,
      key_relationship_checks: {
        public_profiles_without_auth_user: profileAuthOrphans,
        storage_objects_owner_not_matching_auth_user: storageOwnerNotMatchingAuth,
      },
      inventory_mode: exactAllTables
        ? "exact_count_all_relations"
        : "statistics_plus_exact_migration_ledgers_and_storage_buckets",
    };
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

function stableColumns(source) {
  return source.columns.map((column) => [
    column.table_schema, column.table_name, column.ordinal_position, column.column_name,
    column.data_type, column.udt_schema, column.udt_name, column.is_nullable, column.column_default,
  ].join("|")).sort();
}

function stableConstraints(source) {
  return source.constraints.map((constraint) => [
    constraint.source_schema, constraint.source_table, constraint.constraint_name,
    constraint.constraint_type, constraint.target_schema || "", constraint.target_table || "",
    constraint.definition, constraint.validated,
  ].join("|")).sort();
}

function compareSources(pg15, pg18) {
  const keys15 = new Set(pg15.tables.map((table) => table.schema + "." + table.name));
  const keys18 = new Set(pg18.tables.map((table) => table.schema + "." + table.name));
  const onlyPg15 = [...keys15].filter((key) => !keys18.has(key)).sort();
  const onlyPg18 = [...keys18].filter((key) => !keys15.has(key)).sort();
  const columns15 = stableColumns(pg15);
  const columns18 = stableColumns(pg18);
  const constraints15 = stableConstraints(pg15);
  const constraints18 = stableConstraints(pg18);
  const extensions = (source) => source.extensions.map((item) =>
    item.name + "|" + item.version + "|" + item.schema
  ).sort();
  const extensionSet15 = new Set(extensions(pg15));
  const extensionSet18 = new Set(extensions(pg18));

  return {
    table_presence: {
      present_only_in_pg15: onlyPg15,
      present_only_in_pg18: onlyPg18,
    },
    column_definition_differences: {
      only_in_pg15: columns15.filter((item) => !columns18.includes(item)),
      only_in_pg18: columns18.filter((item) => !columns15.includes(item)),
    },
    constraint_definition_differences: {
      only_in_pg15: constraints15.filter((item) => !constraints18.includes(item)),
      only_in_pg18: constraints18.filter((item) => !constraints15.includes(item)),
    },
    extension_differences: {
      only_in_pg15: [...extensionSet15].filter((item) => !extensionSet18.has(item)).sort(),
      only_in_pg18: [...extensionSet18].filter((item) => !extensionSet15.has(item)).sort(),
    },
    warning: "Differences are an inventory, not a migration plan. Resolve every schema and data conflict before PG17 cutover.",
  };
}

try {
  const [pg15, pg18] = await Promise.all(sources.map(inspectSource));
  const report = {
    generated_at: new Date().toISOString(),
    purpose: "read-only dual PostgreSQL inventory before production cutover",
    secrets_or_row_values_exported: false,
    destructive_statements_executed: false,
    sources: { pg15, pg18 },
    comparison: compareSources(pg15, pg18),
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} catch (error) {
  console.error("Dual PostgreSQL read-only audit failed: " + (error.stack || error.message));
  process.exitCode = 1;
}
