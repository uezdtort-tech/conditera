#!/usr/bin/env node
/**
 * Evidence hygiene scanner (TZ_COMPLETION v4.0 §5, DEV-02).
 *
 * Scans tracked evidence files for secrets/PII categories and prints ONLY:
 *   path : line : category : [REDACTED]
 * Never prints the matched value itself.
 *
 * Exit codes: 0 = clean (or only synthetic-test-data findings), 1 = real findings.
 * Usage: node scripts/scan-evidence.mjs [paths...]
 *   (default: all tracked files under docs/evidence/)
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

function listTrackedEvidence() {
  const out = execSync('git ls-files docs/evidence/', { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

// Each rule: [category, regex, severity]
// severity 'real'    -> counts as finding (exit 1)
// severity 'synthetic' -> test-data marker (reported, exit 0)
const RULES = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY( BLOCK)?-----/, 'real'],
  ['bearer-token', /Bearer\s+[A-Za-z0-9\-._~+/]{16,}/i, 'real'],
  ['jwt-like', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/, 'real'],
  ['cookie-header', /(?:Cookie|Set-Cookie)["']?\s*[:=]\s*["']?[^\s"']{8,}/i, 'real'],
  ['supabase-service-role', /SUPABASE_SERVICE_ROLE|service_role[_-]?key|sb_secret_[A-Za-z0-9]+/i, 'real'],
  ['api-key-pattern', /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/, 'real'],
  ['db-conn-with-credentials', /postgres(?:ql)?:\/\/[^\s/:@]+:[^\s/@]+@/i, 'real'],
  ['env-secret-assignment', /^\s*(?:JWT_SECRET|BOT_SECRET|MEILI_MASTER_KEY|POSTGRES_PASSWORD|CRON_SECRET|N8N_ADMIN_PASSWORD|SIMPLEX_BRIDGE_API_KEY|SUPABASE_[A-Z_]*KEY|OPENAI_API_KEY|GOOGLE_[A-Z_]*SECRET)[A-Z_]*\s*=\s*\S/, 'real'],
  ['password-literal', /(?:password|passwd|pwd)["']?\s*[:=]\s*["'][^"'\s]{4,}["']/i, 'real'],
  ['phone-pii', /\+?\d[\d\s\-()]{9,16}\d/, 'synthetic'],
  ['email-pii', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'synthetic'],
];

// Synthetic test-data markers that downgrade a finding to "synthetic" when the
// LINE context clearly indicates generated fixtures.
// The entries extend the C-3 mechanism:
//  - the redaction marker is now task-generic ([REDACTED BY <TASK> HYGIENE],
//    e.g. C-3 / E-1): a line carrying it was already sanitized by a hygiene
//    redaction, so rules that match remaining line structure (variable NAMEs,
//    URL schemes) must not re-fail the gate;
//  - E-1: the documented ABSENCE warning of the auth admin client
//    (src/lib/supabase/admin.ts:31/36) names the env var while stating the
//    key is NOT set — a name-based rule cannot distinguish that message from
//    a real secret, but the line format proves no value exists (a real leak
//    is KEY=<value> and never matches this pattern).
//  NOTE: the broad H-1 presence-only pattern (v4.3) is NOT listed here —
//  it was narrowed in the v4.4 review (see PRESENCE_ONLY_LINE below).
const SYNTHETIC_CONTEXT = [
  /e2e[-_.]/i, /@example\./i, /\.test\b/i, /\.test\./i, /test[-_]?user/i,
  /fixture/i, /synthetic/i, /placeholder/i, /example\.com/i, /conditera\.test/i,
  /e2e_\d+/i, /run[_-]?\d+/i, /\+7999\d{7}/, /79990000000/,
  /\[REDACTED BY [A-Z0-9]+(?:-[A-Z0-9]+)* HYGIENE\]/,
  /\[supabase\/admin\] SUPABASE_SERVICE_ROLE_KEY not set\./,
];

// H-1 (v4.3), NARROWED in the v4.4 release-candidate review — formal basis:
//
// A presence-only inventory line ("env presence-only: VAR SET, VAR ABSENT …",
// no '=' anywhere) carries variable NAMES only. Among the 'real' rules, ONLY
// 'supabase-service-role' can fire on such a line without any value present:
// its alternation SUPABASE_SERVICE_ROLE|… is a substring of the documented
// variable NAME. Every OTHER 'real' rule requires value-shaped content
// (-----BEGIN key, Bearer <16+>, eyJ… JWT, Cookie: <8+>, sk-/ghp_/github_pat_/
// AKIA tokens, postgres://user:pass@, KEY=<value>, quoted password). Those
// value shapes can appear WITHOUT '=' (JWT/base64url, URL creds, quoted
// strings), so the v4.3 invariant "a real leak is KEY=<value> and never
// matches an '='-free line" was provably false: the broad downgrade could
// silently skip a real JWT/bearer/cookie/db-conn/password/api-key riding on
// a presence-only line. Therefore the downgrade is SCOPED to the only
// name-based trigger class ('supabase-service-role'); all value-shaped rules
// stay REAL on any line. Regression proof: scripts/verify/
// scan-evidence-rules-verify.mjs (adversarial cases exit 1, legit inventory
// exits 0).
const PRESENCE_ONLY_LINE = /^env presence-only: [^=\n]*$/;

function classifyLine(line, category, ruleSev) {
  if (ruleSev === 'real') {
    // H-1 (narrowed): downgrade ONLY the name-based trigger class on a
    // presence-only line. Value-shaped rules (jwt-like, bearer-token,
    // cookie-header, db-conn-with-credentials, password-literal,
    // api-key-pattern, private-key, env-secret-assignment) must stay REAL
    // even on an '='-free presence-only line.
    if (category === 'supabase-service-role' && PRESENCE_ONLY_LINE.test(line)) {
      return 'synthetic';
    }
    return SYNTHETIC_CONTEXT.some((re) => re.test(line)) ? 'synthetic' : 'real';
  }
  return 'synthetic';
}

function scanFile(rel) {
  const abs = path.join(REPO, rel);
  const findings = [];
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    return findings;
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const [category, re, sev] of RULES) {
      // For multiline constructs (private key) match on whole text separately below.
      if (re.test(line)) {
        const cls = classifyLine(line, category, sev);
        findings.push({ rel, line: i + 1, category, cls });
      }
    }
  });
  if (/-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY/.test(text)) {
    findings.push({ rel, line: '-', category: 'private-key(whole-file)', cls: 'real' });
  }
  return findings;
}

const args = process.argv.slice(2);
const files = args.length ? args : listTrackedEvidence();
const all = [];
for (const f of files) all.push(...scanFile(f));

// Summary per file/category
const byFile = new Map();
for (const fnd of all) {
  const key = `${fnd.rel} :: ${fnd.category}`;
  if (!byFile.has(key)) byFile.set(key, { real: 0, synthetic: 0, lines: [] });
  const rec = byFile.get(key);
  rec[fnd.cls]++;
  if (rec.lines.length < 8) rec.lines.push(fnd.line);
}

let realTotal = 0, synTotal = 0;
console.log('=== EVIDENCE HYGIENE SCAN (redacted) ===');
console.log(`scan target files: ${files.length}`);
for (const [key, rec] of [...byFile.entries()].sort()) {
  const [rel, category] = key.split(' :: ');
  realTotal += rec.real; synTotal += rec.synthetic;
  console.log(
    `${rec.real > 0 ? 'FINDING ' : 'marker  '} ${rel} : ${category} : ` +
    `real=${rec.real} synthetic=${rec.synthetic} : lines=${rec.lines.join(',')}${rec.lines.length ? ' [REDACTED]' : ''}`
  );
}
console.log('=== SUMMARY ===');
console.log(`real findings: ${realTotal}`);
console.log(`synthetic-test-data markers: ${synTotal}`);
if (realTotal > 0) {
  console.log('ACTION REQUIRED: do not publish flagged files; prepare redacted copies; flag owner for credential rotation review.');
  process.exit(1);
}
console.log('RESULT: no real secret/PII values detected in tracked evidence (synthetic markers only).');
