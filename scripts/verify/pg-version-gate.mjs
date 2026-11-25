#!/usr/bin/env node
/**
 * PostgreSQL topology gate.
 * Transitional state: active Supabase volume is PG15; the isolated migration
 * target and local embedded database are PG17. Never attach the PG15 volume
 * to a PG17 image or treat an empty target volume as production data.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(require.resolve("./pg-version-gate.mjs")), "..", "..");
const ACTIVE_MAJOR = 15;
const TARGET_MAJOR = 17;
const ANCHORS = [
  { file: "docker-compose.supabase.yml", pattern: /supabase\/postgres:(\d+)\./g, expected: ACTIVE_MAJOR, what: "active Supabase DB (existing volume)" },
  { file: "docker-compose.pg17-migration.yml", pattern: /supabase\/postgres:(\d+)\./g, expected: TARGET_MAJOR, what: "isolated PG17 migration target" },
  { file: "package.json", pattern: /"embedded-postgres"\s*:\s*"\^?(\d+)\./g, expected: TARGET_MAJOR, what: "embedded-postgres (local DB)" },
];
let failures = 0;
const fail = (message) => { failures += 1; console.error(`  ✖ ${message}`); };
const ok = (message) => console.log(`  ✔ ${message}`);
console.log("\n─── PostgreSQL topology gate (active PG15 → isolated target PG17) ───");
for (const anchor of ANCHORS) {
  const abs = path.join(ROOT, anchor.file);
  if (!existsSync(abs)) { fail(`${anchor.file}: файл не найден`); continue; }
  const source = readFileSync(abs, "utf8");
  const matches = [...source.matchAll(anchor.pattern)];
  if (!matches.length) { fail(`${anchor.file}: не найден якорь «${anchor.what}»`); continue; }
  const majors = matches.map((match) => Number(match[1]));
  if (majors.some((major) => major !== anchor.expected)) {
    fail(`${anchor.file}: ${anchor.what} major=${majors.join(",")} — ожидается PG${anchor.expected}`);
  } else {
    ok(`${anchor.file}: ${anchor.what} = PG${anchor.expected}`);
  }
}
const composeFiles = readdirSync(ROOT).filter((name) => /^docker-compose.*\.ya?ml$/.test(name));
const workflowDir = path.join(ROOT, ".github", "workflows");
const workflowFiles = existsSync(workflowDir)
  ? readdirSync(workflowDir).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml")).map((name) => path.join(workflowDir, name))
  : [];
for (const name of composeFiles) {
  const file = path.join(ROOT, name);
  const expected = name === "docker-compose.supabase.yml" ? ACTIVE_MAJOR : TARGET_MAJOR;
  readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/image:\s*["']?([^"'\n]*(?:postgres|pgvector)[^"'\n]*)/i);
    if (!match) return;
    const version = match[1].trim().match(/:(\d+)(?:\.|-|$|["']?)/);
    if (!version) return;
    const major = Number(version[1]);
    if (major !== expected) fail(`${name}:${index + 1}: ${match[1].trim()} major=${major}, ожидается PG${expected}`);
  });
}
for (const file of workflowFiles) {
  const rel = path.relative(ROOT, file);
  readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/image:\s*["']?([^"'\n]*(?:postgres|pgvector)[^"'\n]*)/i);
    if (!match) return;
    const version = match[1].trim().match(/:(\d+)(?:\.|-|$|["']?)/);
    if (!version) return;
    const major = Number(version[1]);
    if (major !== TARGET_MAJOR) fail(`${rel}:${index + 1}: test image ${match[1].trim()} major=${major}, ожидается PG${TARGET_MAJOR}`);
  });
}
try {
  const pkgPath = path.join(ROOT, "node_modules", "@embedded-postgres", "linux-x64", "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const major = Number(String(pkg.version).split(".")[0]);
    if (major !== TARGET_MAJOR) fail(`embedded binary ${pkg.version} — ожидается PG${TARGET_MAJOR}`);
    else ok(`embedded binary ${pkg.version} = PG${TARGET_MAJOR}`);
  } else ok("embedded binaries не установлены; проверен package.json");
} catch { ok("embedded binaries не установлены; проверен package.json"); }
if (failures) {
  console.error(`\n✖ PostgreSQL topology gate: ${failures} расхождение(й)`);
  process.exit(1);
}
console.log("\n✔ PostgreSQL topology согласована: active PG15 + isolated target PG17.\n");
