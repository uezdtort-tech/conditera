#!/usr/bin/env node
/**
 * Z-v19 §6 verification: классификация ВСЕХ route.ts по механизму
 * обработки ошибок. Read-only, результат — evidence-файл.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const API_DIR = join(ROOT, "src", "app", "api");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

function classify(src) {
  const m = [];
  const stripped = src.replace(/\/\/[^\n]*/g, "");
  const hreCall = /handleRouteError\s*\(/.test(stripped);
  const cseCall = /captureServerError\s*\(/.test(stripped);
  const cdeCall = /captureDependencyError\s*\(/.test(stripped);
  const cronAuth = /verifyCronSecret|cronUnauthorized/.test(src);
  const hasTry = /\btry\s*\{/.test(src);
  const supabaseErr = /if\s*\(\s*\w*\.?error\s*\)/.test(src);
  const exported = /export\s+(async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)/.test(src);

  if (hreCall) m.push("handleRouteError");
  if (cseCall) m.push("captureServerError");
  if (cdeCall) m.push("captureDependencyError");
  if (cronAuth) m.push("cron-auth");
  if (hasTry) m.push("try-catch");
  if (supabaseErr) m.push("supabase-error-check");
  if (!exported) m.push("no-http-export");
  return { mechanisms: m, hasTry, hreCall, cseCall };
}

const files = walk(API_DIR).sort();
const report = [];
const counts = {
  total: files.length,
  handleRouteError: 0,
  captureOnly: 0,
  cron: 0,
  tryCatchNoCapture: 0,
  noCatch: 0,
};

for (const f of files) {
  const rel = relative(ROOT, f);
  let src = "";
  try { src = readFileSync(f, "utf8"); } catch { report.push({ rel, error: "unreadable" }); continue; }
  const c = classify(src);
  let bucket;
  if (c.hreCall) { bucket = "handleRouteError"; counts.handleRouteError++; }
  else if (c.cseCall || c.cdeCall) { bucket = "captureOnly"; counts.captureOnly++; }
  else if (/verifyCronSecret|cronUnauthorized/.test(src)) { bucket = "cron-auth+trycatch"; counts.cron++; }
  else if (c.hasTry) { bucket = "try-catch-no-capture"; counts.tryCatchNoCapture++; }
  else { bucket = "no-try-catch"; counts.noCatch++; }
  report.push({ rel, bucket, mechanisms: c.mechanisms });
}

mkdirSync("agent-ctx/z-v19", { recursive: true });
writeFileSync(
  "agent-ctx/z-v19/route-classification.json",
  JSON.stringify({ counts, report }, null, 2)
);

console.log("=== BUCKETS ===");
console.log(JSON.stringify(counts, null, 2));
const byArea = {};
for (const r of report) {
  const area = r.rel.replace(/^src\/app\/api\//, "").split("/")[0];
  byArea[area] = byArea[area] || {};
  byArea[area][r.bucket] = (byArea[area][r.bucket] || 0) + 1;
}
console.log("=== BY AREA ===");
console.log(JSON.stringify(byArea, null, 2));
console.log("=== no-try-catch routes (danger) ===");
for (const r of report) if (r.bucket === "no-try-catch") console.log("  " + r.rel);
