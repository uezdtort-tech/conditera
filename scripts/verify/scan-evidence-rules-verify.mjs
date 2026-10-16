#!/usr/bin/env node
/**
 * Adversarial regression verifier for scripts/scan-evidence.mjs downgrade
 * rules (release-candidate review v4.4, task 2).
 *
 * Proves, against the REAL scanner subprocess (not a re-implementation):
 *
 *  GROUP A — no false skip of real secrets:
 *    'real'-rule matches carrying VALUE-SHAPED content must stay REAL
 *    (scanner exit 1) even when the line is an '='-free
 *    "env presence-only: …" inventory line. Covers jwt-like, bearer-token,
 *    cookie-header, db-conn-with-credentials, password-literal,
 *    api-key-pattern, plus the a9a0672 regressions (prefix + KEY=value
 *    stays real).
 *
 *  GROUP B — legitimate downgrade preserved:
 *    the motivating v4.3 line (name-based 'supabase-service-role' trigger on
 *    a presence-only line) must be downgraded to synthetic (exit 0) — the
 *    narrow H-1 scope keeps the original use-case green.
 *
 *  GROUP C — precedent contexts intact:
 *    E-1 admin-absence warning and hygiene redaction markers still downgrade;
 *    a MIXED file (legit inventory line + real JWT on presence-only line)
 *    must still exit 1 — a real finding is never lost next to a legit one.
 *
 * Exit: 0 = all cases pass; 1 = any case failed. Prints only redacted
 * scanner output categories, never fixture secret values in this file's own
 * stdout beyond the synthetic adversarial fixtures it creates (all fixtures
 * are FAKE values, removed in finally).
 *
 * Usage: node scripts/verify/scan-evidence-rules-verify.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = process.cwd();
let tmpRoot; // repo-relative temp dir (scanner joins REPO + rel)

const cases = [];
function caseDef(name, expectExit, lines, expectCategory) {
  cases.push({ name, expectExit, lines, expectCategory });
}

// ---------- GROUP A: '='-free presence-only lines with real-shaped secrets ----------
caseDef('A1 presence-only + JWT stays real', 1, [
  'env presence-only: JWT_SECRET eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
], 'jwt-like');
caseDef('A2 presence-only + Bearer token stays real', 1, [
  'env presence-only: Authorization Bearer Am4pT0kEnV4lue1234567890',
], 'bearer-token');
caseDef('A3 presence-only + Cookie header stays real', 1, [
  'env presence-only: Cookie: sessT0kEnValue123456',
], 'cookie-header');
caseDef('A4 presence-only + db-conn with creds stays real', 1, [
  'env presence-only: postgres://svc_user:S3cretP4ss@db.internal:5432/conditera',
], 'db-conn-with-credentials');
caseDef('A5 presence-only + quoted password stays real', 1, [
  'env presence-only: password: "Pr0dS3cretValue"',
], 'password-literal');
caseDef('A6 presence-only + api-key stays real', 1, [
  'env presence-only: sk-LiveKeyValue1234567890ABCDEF',
], 'api-key-pattern');
// a9a0672 regressions (must survive the narrowing):
caseDef('A7 prefix + KEY=value stays real', 1, [
  'env presence-only: SUPABASE_SERVICE_ROLE_KEY=real-value-here-123',
], 'supabase-service-role');
caseDef('A8 plain KEY=value leak stays real', 1, [
  'JWT_SECRET=hunter2-value-not-real-but-shape-is',
], 'env-secret-assignment');

// ---------- GROUP B: legitimate downgrade (narrow scope) ----------
caseDef('B1 motivating v4.3 inventory line → synthetic', 0, [
  'env presence-only: NEXT_PUBLIC_SUPABASE_URL SET, NEXT_PUBLIC_SUPABASE_ANON_KEY SET, SUPABASE_SERVICE_ROLE_KEY SET, JWT_SECRET SET, JWT_REFRESH_SECRET SET (len recorded in report, values NOT printed); GOTRUE_PROBE_TIMEOUT_MS ABSENT (optional, default 3s)',
], 'supabase-service-role');
caseDef('B2 generic name-only inventory → synthetic', 0, [
  'env presence-only: SUPABASE_SERVICE_ROLE_KEY SET, JWT_SECRET ABSENT',
], 'supabase-service-role');

// ---------- GROUP C: precedents intact + mixed file ----------
caseDef('C1 E-1 admin-absence warning → synthetic', 0, [
  '[supabase/admin] SUPABASE_SERVICE_ROLE_KEY not set.',
], 'supabase-service-role');
caseDef('C2 hygiene redaction marker (env) → synthetic', 0, [
  'JWT_SECRET=[REDACTED BY F-1 HYGIENE]',
], 'env-secret-assignment');
caseDef('C3 F-1 redacted db-conn line → no db-conn finding', 0, [
  '[route] unhandled error: DB connection string [REDACTED BY F-1 HYGIENE] Error: DB connection string [REDACTED BY F-1 HYGIENE]',
], null); // value fully replaced by marker — rule must NOT fire at all
caseDef('C4 mixed file: legit inventory + real JWT → exit 1', 1, [
  'env presence-only: SUPABASE_SERVICE_ROLE_KEY SET, JWT_SECRET ABSENT',
  'env presence-only: JWT_SECRET eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
], 'jwt-like');

let pass = 0, fail = 0;
const failures = [];

function runCase(c, idx) {
  const rel = path.join(tmpRoot, `case${String(idx + 1).padStart(2, '0')}.log`);
  writeFileSync(path.join(REPO, rel), c.lines.join('\n') + '\n');
  let stdout = '', exit = 0;
  try {
    stdout = execFileSync('node', ['scripts/scan-evidence.mjs', rel], {
      cwd: REPO, encoding: 'utf8',
    });
  } catch (err) {
    exit = err.status ?? 1;
    stdout = err.stdout ?? '';
  }
  const problems = [];
  if (exit !== c.expectExit) {
    problems.push(`exit ${exit} != expected ${c.expectExit}`);
  }
  if (c.expectExit === 1) {
    if (!/real findings: [1-9]/.test(stdout)) {
      problems.push('scanner did not report real findings');
    }
    if (c.expectCategory && !new RegExp(`FINDING\\s+.*:\\s*${c.expectCategory}\\s*:`).test(stdout)) {
      problems.push(`no FINDING row for category ${c.expectCategory}`);
    }
  } else {
    if (!/real findings: 0/.test(stdout)) {
      problems.push('clean case reported real findings');
    }
    if (c.expectCategory && !new RegExp(`marker\\s+.*:\\s*${c.expectCategory}\\s*:.*synthetic=[1-9]`).test(stdout)) {
      problems.push(`no synthetic marker row for category ${c.expectCategory}`);
    }
  }
  if (problems.length === 0) {
    pass++;
    console.log(`PASS ${c.name}`);
  } else {
    fail++;
    failures.push(`${c.name}: ${problems.join('; ')}`);
    console.log(`FAIL ${c.name}: ${problems.join('; ')}`);
  }
}

tmpRoot = mkdtempSync(path.join('.', '.tmp-scan-rules-'));
try {
  cases.forEach(runCase);
} finally {
  rmSync(path.join(REPO, tmpRoot), { recursive: true, force: true });
}

console.log('=== SCAN-RULES VERIFIER SUMMARY ===');
console.log(`SUMMARY pass=${pass}/${cases.length} fail=${fail}`);
if (fail > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('RESULT: no false skip of real-shaped secrets; legit downgrades intact.');
