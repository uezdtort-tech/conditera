#!/usr/bin/env node
/**
 * e2e-tally-contract.mjs — автоматизированный верификатор tally-контракта (TZ v4.0 §8.1, DEV-07).
 *
 * Что делает:
 *   1. Парсит ВСЕ *.json в docs/evidence/e2e-tally/ (первичные артефакты JSON-репортера
 *      Playwright) и рекурсивно извлекает каждый тест: spec-путь, projectName, статус,
 *      причины skip (annotations), а также stats блока артефакта.
 *   2. Идентичность прогона = (spec, recorded-mode, projectNames, startTime) — НИКОГДА
 *      по догадкам из имени файла. Побайтно идентичные артефакты (равный sha256) в одной
 *      группе — ОДИН логический прогон, сохранённый дважды; разные байты при той же
 *      идентичности — FAIL.
 *   3. Канонический tally: для каждого спека берётся РОВНО ОДИН прогон в его
 *      designed-mode (см. TALLY.md «Режимы»): самый новый по startTime из
 *      канонических; остальные прогоны того же (spec, mode) — корроборация
 *      (обязаны совпадать по статистике). Диагностические артефакты (не-канонический
 *      режим, OOM-свидетельство, дубликаты) исключаются из сумм по ПИСЬМЕННЫМ правилам
 *      EXCLUSION_RULES ниже.
 *   4. Skip-аудит: единственный разрешённый skip в канонических прогонах —
 *      документированное условие E2E_FULL_STACK (onboarding-flow). Любой другой
 *      skip в каноническом прогоне → FAIL.
 *   5. Суммы пересчитываются и сверяются с каноническим утверждением
 *      148 passed / 0 failed / 0 flaky / 1 skipped / 149 слотов, а по-спеково —
 *      с таблицей TALLY.md. Расхождение → exit 1 с точным diff.
 *   6. Машиночитаемый итог: docs/evidence/e2e-tally/tally-contract-<HEADshort>.json
 *      (только пути, хеши, счётчики, режимы; никаких секретов/PII).
 *
 * Про SHA исходников: артефакты JSON-репортера НЕ содержат sha исходников
 * (проверено: ключи config/stats/metadata не содержат hash-полей). Верификатор
 * честно помечает каждый артефакт "sha-absent-in-artifact" и фиксирует
 * происхождение из независимых источников (см. SHA_PROVENANCE ниже).
 *
 * Exit: 0 — контракт выполнен; 1 — найдено расхождение (с распечаткой diff).
 *
 * Запуск: node scripts/verify/e2e-tally-contract.mjs
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const EVIDENCE_DIR = path.join(REPO, 'docs', 'evidence', 'e2e-tally');
const HEAD_SHORT = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();

/** Каноническое утверждение (TALLY.md, спека-агностично). */
const CANONICAL_CLAIM = { passed: 148, failed: 0, flaky: 0, skipped: 1, slots: 149 };

/**
 * Designed-mode каждого спека (TALLY.md, раздел «Режимы», обоснован там же):
 * prod — спеки страниц/публичных API (dev-сервер в песочнице OOM-убивается
 * ядром на page-компиляциях); dev — спеки, чей контракт опирается на
 * dev-поведение рантайма (payment-webhook: IP-гейт verifyWebhook;
 * integration-auth-flow: fail-closed регистрация без GoTrue).
 */
const CANONICAL_MODE = {
  'api-v2': 'prod',
  'auth-flow': 'prod',
  'full-flow': 'prod',
  'integration-auth-flow': 'dev',
  'onboarding-flow': 'prod',
  'payment-webhook-idempotency': 'dev',
  'recipe-purchase-flow': 'prod',
  'regional-pricing': 'prod',
  smoke: 'prod',
};

/** Единственный разрешённый skip (документированное проектное условие). */
const ALLOWED_SKIP_RE = /E2E_FULL_STACK|Требуется полный Supabase-стек/;

/**
 * Письменные правила исключения артефактов из канонических сумм.
 * Каждое правило применимо по ИДЕНТИЧНОСТИ/метаданным артефакта, не «по вкусу».
 */
const EXCLUSION_RULES = [
  {
    id: 'R1-oom-evidence',
    match: (name) => name.includes('OOM-evidence'),
    reason:
      'частичный прерванный dev-прогон, сохранённый как СВИДЕТЕЛЬСТВО OOM песочницы ' +
      '(dmesg SIGKILL next-server); самостоятельной суммарной ценности не несёт, не канонический прогон',
  },
  {
    id: 'R2-duplicate-copy',
    match: (name, group) => group.identicalTo && group.identicalTo !== name,
    reason: (name, group) =>
      `побайтно идентичен (sha256) ${group.identicalTo} — тот же логический прогон ` +
      `(spec+project+startTime совпадают), учёт ОДИН раз по основному имени`,
  },
  {
    id: 'R3-non-canonical-mode-diagnostic',
    match: (name, group) =>
      group.parsed.mode && group.parsed.mode !== CANONICAL_MODE[group.parsed.spec],
    reason: (name, group) =>
      `записанный режим «${group.parsed.mode}» ≠ designed-mode «${CANONICAL_MODE[group.parsed.spec]}» ` +
      `спека — диагностический прогон (см. TALLY.md «Режимы»), в суммы не входит`,
  },
];

/** Происхождение SHA исходников для артефактов, где его нет в самом артефакте. */
const SHA_PROVENANCE = {
  session: {
    head: '89b6708',
    basis:
      'TALLY.md (заголовок сессии release-gate-verify): все артефакты исходной девятки сняты при HEAD 89b6708',
    reverifiedAt: '7a8d878',
    reverifyEvidence: 'docs/evidence/release-gate/e2e-tally-verify-7a8d878.txt',
  },
  runArtifacts: {
    basis:
      'имя артефакта <spec>.<mode>.<HEADshort>-run<N>.json кодирует короткий SHA HEAD, ' +
      'при котором выполнен прогон (конвенция фикс-сессии DEV-05)',
  },
};

// ─── Разбор имени файла ─────────────────────────────────────────────────────
function parseFileName(name) {
  // Свидетельство OOM: частичный прерванный прогон — spec узнаём по префиксу имени
  if (name.includes('OOM-evidence')) {
    return { spec: name.replace(/\.json$/, '').split('.')[0], mode: 'dev', kind: 'oom-evidence' };
  }
  // <spec>.<mode>.<sha>-run<N>.json — новые артефакты (HEAD закодирован в имени)
  let m = name.match(/^(?<spec>.+)\.(?<mode>dev|prod)\.(?<sha>[0-9a-f]{7,12})-run(?<n>\d+)\.json$/);
  if (m) return { spec: m.groups.spec, mode: m.groups.mode, runSha: m.groups.sha, runIndex: Number(m.groups.n), kind: 'primary' };
  // <spec>.early-prod.json — ранний дублирующий снимок prod-прогона
  m = name.match(/^(?<spec>.+)\.early-prod\.json$/);
  if (m) return { spec: m.groups.spec, mode: 'prod', early: true, kind: 'primary' };
  // <spec>.<mode>.json — каноническая конвенция
  m = name.match(/^(?<spec>.+)\.(?<mode>dev|prod)\.json$/);
  if (m) return { spec: m.groups.spec, mode: m.groups.mode, kind: 'primary' };
  // нераспознанное имя — отдельная проблема, а не тихий пропуск
  return { spec: name.replace(/\.json$/, ''), mode: null, kind: 'unrecognized' };
}

// ─── Обход дерева сьютов JSON-репортера ─────────────────────────────────────
function collectTests(suites, out, file) {
  for (const s of suites || []) {
    for (const sp of s.specs || []) {
      for (const t of sp.tests || []) {
        const results = t.results || [];
        const last = results[results.length - 1] || {};
        const annotations = [
          ...(t.annotations || []),
          ...results.flatMap((r) => r.annotations || []),
        ].filter((a) => a && (a.type === 'skip' || a.type === 'notice'));
        out.push({
          artifact: file,
          specFile: s.file || null,
          suiteTitle: s.title || null,
          title: sp.title || t.title || null,
          projectName: t.projectName || null,
          // статус уровня ТЕСТА (expected/unexpected/flaky/skipped) — первичен;
          // статус последней попытки — для диагностики
          status: t.status ?? last.status ?? 'unknown',
          lastAttemptStatus: last.status ?? null,
          skipReasons: annotations.map((a) => a.description || '').filter(Boolean),
          errorSnippet: last.error?.message ? String(last.error.message).slice(0, 200) : null,
        });
      }
    }
    collectTests(s.suites, out, file);
  }
}

// ─── Загрузка артефактов ────────────────────────────────────────────────────
function loadArtifacts() {
  const files = readdirSync(EVIDENCE_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('tally-contract-'))
    .sort();
  const artifacts = [];
  for (const name of files) {
    const abs = path.join(EVIDENCE_DIR, name);
    const raw = readFileSync(abs);
    const sha256 = createHash('sha256').update(raw).digest('hex');
    let json;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      artifacts.push({ name, sha256, parseError: String(e) });
      continue;
    }
    const tests = [];
    collectTests(json.suites, tests, name);
    const recomputed = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
    for (const t of tests) {
      if (t.status === 'expected' || t.status === 'passed') recomputed.expected++;
      else if (t.status === 'unexpected' || t.status === 'failed') recomputed.unexpected++;
      else if (t.status === 'flaky') recomputed.flaky++;
      else if (t.status === 'skipped') recomputed.skipped++;
    }
    // Проверка наличия sha исходников в самом артефакте (metadata/config)
    const metaBlob = JSON.stringify({ m: json.metadata ?? null, c: json.config ?? null });
    const shaInArtifact = /"[^"]*sha[^"]*"\s*:/i.test(metaBlob);
    const command = Array.isArray(json.config?.argv) ? json.config.argv.join(' ') : null;
    artifacts.push({
      name,
      sha256,
      bytes: raw.length,
      parsed: parseFileName(name),
      stats: json.stats ?? null,
      recomputed,
      statsMatch:
        json.stats &&
        recomputed.expected === json.stats.expected &&
        recomputed.unexpected === json.stats.unexpected &&
        recomputed.flaky === json.stats.flaky &&
        recomputed.skipped === json.stats.skipped,
      projects: [...new Set(tests.map((t) => t.projectName).filter(Boolean))].sort(),
      startTime: json.stats?.startTime ?? null,
      duration: json.stats?.duration ?? null,
      errors: json.errors ?? [],
      command,
      sourceShaInArtifact: shaInArtifact ? 'present' : 'sha-absent-in-artifact',
      tests,
    });
  }
  return artifacts;
}

// ─── Группировка по идентичности прогона ────────────────────────────────────
function groupByIdentity(artifacts) {
  const groups = new Map();
  for (const a of artifacts) {
    if (a.parseError) continue;
    const key = JSON.stringify([
      a.parsed.spec,
      a.parsed.mode,
      a.projects,
      a.startTime,
    ]);
    if (!groups.has(key)) groups.set(key, { members: [] });
    groups.get(key).members.push(a);
  }
  const list = [...groups.values()];
  for (const g of list) {
    g.identicalTo = null;
    if (g.members.length > 1) {
      const first = g.members[0];
      if (g.members.every((m) => m.sha256 === first.sha256)) {
        // побайтно идентичны: основной = имя без ".early" (или первое по алфавиту)
        const primary =
          g.members.find((m) => !m.parsed.early) ?? first;
        g.identicalTo = primary.name;
        g.primary = primary.name;
      } else {
        g.conflict = g.members.map((m) => m.name);
      }
    } else {
      g.primary = g.members[0].name;
    }
    g.parsed = g.members[0].parsed;
  }
  return list;
}

// ─── Парсинг таблицы TALLY.md ───────────────────────────────────────────────
function parseTallyTable() {
  const text = readFileSync(path.join(EVIDENCE_DIR, 'TALLY.md'), 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    // | api-v2 | prod | e2e-one.sh api-v2 | 89b6708 | … | api-v2.prod.json | 0 | 37 | 0 | 0 | 0 | — |
    const m = line.match(/^\|\s*([a-z0-9-]+)\s*\|/i);
    if (!m || /^(спек|---|итого)/i.test(m[1])) continue;
    const cells = line.split('|').map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length < 11) continue;
    const spec = cells[0];
    if (!CANONICAL_MODE[spec]) continue; // пропустить служебные строки
    rows.push({
      spec,
      mode: cells[1],
      command: cells[2],
      sha: cells[3],
      db: cells[4],
      artifact: cells[5],
      exit: cells[6],
      passed: Number(cells[7]),
      failed: Number(cells[8]),
      flaky: Number(cells[9]),
      skipped: Number(cells[10]),
      skipReason: cells[11] ?? '',
    });
  }
  return rows;
}

// ─── Основной поток ─────────────────────────────────────────────────────────
const problems = [];
const notes = [];
const artifacts = loadArtifacts();
const groups = groupByIdentity(artifacts);

console.log('=== E2E TALLY CONTRACT VERIFIER (DEV-07 / TZ v4.0 §8.1) ===');
console.log(`HEAD: ${HEAD_SHORT}  |  артефактов: ${artifacts.length}  |  групп по идентичности: ${groups.length}`);

// Конфликты идентичности: та же (spec, mode, projects, startTime), но разные байты
for (const g of groups) {
  if (g.conflict) problems.push(`IDENTITY-CONFLICT: один логический прогон, разные байты: ${g.conflict.join(' + ')}`);
}

// Классификация каждой группы: canonical-run | corroboration | diagnostic
const bySpec = new Map();
for (const spec of Object.keys(CANONICAL_MODE)) bySpec.set(spec, { canonical: null, corroborating: [], diagnostics: [] });

for (const g of groups) {
  const member = g.members.find((m) => m.name === g.primary) ?? g.members[0];
  const { spec, mode } = g.parsed;

  // Правила исключения (R1..R3)
  const excl = [];
  for (const rule of EXCLUSION_RULES) {
    const hit = rule.match(member.name, g);
    if (hit) {
      excl.push({ rule: rule.id, reason: typeof rule.reason === 'function' ? rule.reason(member.name, g) : rule.reason });
      break; // первое сработавшее правило — достаточно
    }
  }
  const rec = {
    artifact: member.name,
    duplicateArtifacts: g.members.filter((m) => m.name !== g.primary).map((m) => m.name),
    spec,
    recordedMode: mode,
    projects: member.projects,
    startTime: member.startTime,
    stats: member.stats,
    recomputed: member.recomputed,
    statsMatch: member.statsMatch,
    sha256: member.sha256,
    sourceSha: member.sourceShaInArtifact,
    command: member.command,
    exitCode: 'not-in-artifact (см. TALLY.md: exit 0 для канонических прогонов)',
    dbMode: 'not-in-artifact (стек: embedded PG :54329, scripts/db/runtime.mjs)',
    shaProvenance: member.parsed.runSha
      ? { source: 'filename', head: member.parsed.runSha, ...SHA_PROVENANCE.runArtifacts }
      : { source: 'session-evidence', ...SHA_PROVENANCE.session },
    exclusions: excl,
  };
  if (member.statsMatch === false) {
    problems.push(`STATS-MISMATCH ${member.name}: stats блока ${JSON.stringify(member.stats)} ≠ пересчитано по тестам ${JSON.stringify(member.recomputed)}`);
  }
  if ((member.errors ?? []).length > 0) {
    notes.push(`${member.name}: reporter errors=${member.errors.length} (см. артефакт)`);
  }

  if (excl.length > 0) {
    if (bySpec.has(spec)) {
      bySpec.get(spec).diagnostics.push(rec);
    } else {
      problems.push(`UNKNOWN-SPEC-ARTIFACT ${member.name}: спек «${spec}» вне канонического списка`);
    }
    continue;
  }
  // канонический режим?
  if (mode !== CANONICAL_MODE[spec]) {
    problems.push(`UNEXPECTED-CANONICAL-MODE ${member.name}: режим «${mode}» не прошёл правила исключения, но ≠ designed-mode`);
    continue;
  }
  const slot = bySpec.get(spec);
  if (!slot) { problems.push(`UNKNOWN-SPEC ${member.name}`); continue; }
  if (!slot.canonical || member.startTime > slot.canonical.startTime) {
    if (slot.canonical) slot.corroborating.push(slot.canonical);
    slot.canonical = rec;
  } else {
    slot.corroborating.push(rec);
  }
}

// Детерминизм: корроборация обязана совпадать со каноном по статистике
for (const [spec, slot] of bySpec) {
  for (const c of slot.corroborating) {
    const same =
      c.stats.expected === slot.canonical.stats.expected &&
      c.stats.unexpected === slot.canonical.stats.unexpected &&
      c.stats.flaky === slot.canonical.stats.flaky &&
      c.stats.skipped === slot.canonical.stats.skipped;
    if (!same) {
      problems.push(
        `DETERMINISM ${spec}: корроборация ${c.artifact} ` +
          `${JSON.stringify({ ...c.stats, startTime: undefined, duration: undefined })} ≠ канон ${slot.canonical.artifact} ` +
          `${JSON.stringify({ ...slot.canonical.stats, startTime: undefined, duration: undefined })}`,
      );
    }
  }
}

// ─── Skip-аудит канонических прогонов ───────────────────────────────────────
let canonicalSkips = 0;
for (const [spec, slot] of bySpec) {
  if (!slot.canonical) continue;
  const artifact = artifacts.find((a) => a.name === slot.canonical.artifact);
  for (const t of artifact.tests) {
    if (t.status !== 'skipped') continue;
    canonicalSkips++;
    const reason = t.skipReasons.join(' | ') || '(причина не записана)';
    if (!ALLOWED_SKIP_RE.test(reason)) {
      problems.push(`FORBIDDEN-SKIP ${spec} «${t.title}»: причина «${reason}» не является документированным условием E2E_FULL_STACK`);
    } else {
      slot.canonical.skipReason = reason;
    }
  }
}

// ─── Полнота: каждый канонический спек имеет ровно один канонический прогон ──
for (const [spec, slot] of bySpec) {
  if (!slot.canonical) problems.push(`MISSING-CANONICAL-RUN: спек «${spec}» (designed-mode ${CANONICAL_MODE[spec]}) не имеет канонического прогона`);
}

// ─── Пересчёт итогов ────────────────────────────────────────────────────────
const totals = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
for (const slot of bySpec.values()) {
  if (!slot.canonical) continue;
  totals.passed += slot.canonical.stats.expected;
  totals.failed += slot.canonical.stats.unexpected;
  totals.flaky += slot.canonical.stats.flaky;
  totals.skipped += slot.canonical.stats.skipped;
}
totals.slots = totals.passed + totals.failed + totals.flaky + totals.skipped;

// ─── Сверка с TALLY.md (по-спеково) ─────────────────────────────────────────
let tallyRows = [];
try {
  tallyRows = parseTallyTable();
  if (tallyRows.length !== Object.keys(CANONICAL_MODE).length) {
    problems.push(
      `TALLY.md: распознано строк таблицы ${tallyRows.length} из ${Object.keys(CANONICAL_MODE).length} ожидаемых — таблица обязана быть полным per-spec контрактом (12 колонок)`,
    );
  }
  for (const row of tallyRows) {
    const slot = bySpec.get(row.spec);
    if (!slot?.canonical) { problems.push(`TALLY-ROW-WITHOUT-RUN ${row.spec}`); continue; }
    if (row.mode !== slot.canonical.recordedMode) problems.push(`TALLY-DRIFT ${row.spec}: режим в TALLY.md «${row.mode}» ≠ «${slot.canonical.recordedMode}»`);
    if (row.artifact !== slot.canonical.artifact) problems.push(`TALLY-DRIFT ${row.spec}: артефакт в TALLY.md «${row.artifact}» ≠ канон «${slot.canonical.artifact}»`);
    if (!/\d/.test(row.sha)) problems.push(`TALLY-DRIFT ${row.spec}: колонка SHA не содержит sha («${row.sha}»)`);
    if (row.passed !== slot.canonical.stats.expected) problems.push(`TALLY-DRIFT ${row.spec}: passed ${row.passed} ≠ ${slot.canonical.stats.expected}`);
    if (row.failed !== slot.canonical.stats.unexpected) problems.push(`TALLY-DRIFT ${row.spec}: failed ${row.failed} ≠ ${slot.canonical.stats.unexpected}`);
    if (row.flaky !== slot.canonical.stats.flaky) problems.push(`TALLY-DRIFT ${row.spec}: flaky ${row.flaky} ≠ ${slot.canonical.stats.flaky}`);
    if (row.skipped !== slot.canonical.stats.skipped) problems.push(`TALLY-DRIFT ${row.spec}: skipped ${row.skipped} ≠ ${slot.canonical.stats.skipped}`);
    if (row.skipped > 0 && !ALLOWED_SKIP_RE.test(row.skipReason)) {
      problems.push(`TALLY-DRIFT ${row.spec}: skipped>0, но skip-причина «${row.skipReason}» не документирует E2E_FULL_STACK`);
    }
  }
} catch (e) {
  problems.push(`TALLY.md не распарсена: ${e.message}`);
}

// ─── Сверка с каноническим утверждением ─────────────────────────────────────
const drift = [];
for (const k of ['passed', 'failed', 'flaky', 'skipped', 'slots']) {
  if (totals[k] !== CANONICAL_CLAIM[k]) {
    drift.push(`  ${k}: утверждение ${CANONICAL_CLAIM[k]} vs пересчитано ${totals[k]}`);
  }
}

// ─── Печать канонической таблицы ────────────────────────────────────────────
console.log('\n--- Канонический (aggregated per-spec) tally ---');
console.log(
  'spec                         mode  projects     passed fail flaky skip  artifact',
);
for (const [spec, slot] of bySpec) {
  if (!slot.canonical) { console.log(`${spec.padEnd(28)} — MISSING`); continue; }
  const st = slot.canonical.stats;
  console.log(
    spec.padEnd(28) +
      String(slot.canonical.recordedMode).padEnd(6) +
      slot.canonical.projects.join('+').padEnd(12) +
      String(st.expected).padStart(6) +
      String(st.unexpected).padStart(5) +
      String(st.flaky).padStart(6) +
      String(st.skipped).padStart(5) +
      '  ' + slot.canonical.artifact,
  );
}
console.log(
  `\nRECOMPUTED TOTALS: passed=${totals.passed} failed=${totals.failed} flaky=${totals.flaky} skipped=${totals.skipped} slots=${totals.slots}`,
);
console.log(
  `CANONICAL CLAIM:   passed=${CANONICAL_CLAIM.passed} failed=${CANONICAL_CLAIM.failed} flaky=${CANONICAL_CLAIM.flaky} skipped=${CANONICAL_CLAIM.skipped} slots=${CANONICAL_CLAIM.slots}`,
);

// Диагностика (исключённые артефакты) и корроборация — информационно
console.log('\n--- Исключённые/диагностические артефакты (правила R1–R3) ---');
for (const [, slot] of bySpec) {
  for (const d of slot.diagnostics) {
    console.log(`${d.artifact}  [${d.exclusions.map((x) => x.rule).join(', ')}]`);
    for (const x of d.exclusions) console.log(`    — ${x.reason}`);
    if (d.duplicateArtifacts.length) console.log(`    дубликаты (побайтно идентичны → один логический прогон): ${d.duplicateArtifacts.join(', ')}`);
    if (d.stats) console.log(`    stats: passed=${d.stats.expected} failed=${d.stats.unexpected} flaky=${d.stats.flaky} skipped=${d.stats.skipped}`);
  }
}
for (const [spec, slot] of bySpec) {
  for (const c of slot.corroborating) {
    console.log(`corroboration: ${spec} — ${c.artifact} (startTime ${c.startTime}) — статистика совпадает с каноном`);
  }
}
for (const n of notes) console.log(`note: ${n}`);

// ─── Вердикт ────────────────────────────────────────────────────────────────
let verdict = 'PASS';
if (problems.length > 0) verdict = 'FAIL';
else if (drift.length > 0) verdict = 'FAIL';
console.log(`\nVERDICT vs CLAIM: ${verdict}`);
if (drift.length > 0) console.log('DIFF vs canonical claim:\n' + drift.join('\n'));
if (problems.length > 0) {
  console.log(`\nPROBLEMS (${problems.length}):`);
  for (const p of problems) console.log('  ✗ ' + p);
} else {
  console.log('problems: 0 (идентичность, дубликаты, skip-аудит, полнота, TALLY.md-сверка — все проверки пройдены)');
}

// ─── Машиночитаемый итог ────────────────────────────────────────────────────
const outPath = path.join(EVIDENCE_DIR, `tally-contract-${HEAD_SHORT}.json`);
const machine = {
  generatedAt: new Date().toISOString(),
  headShort: HEAD_SHORT,
  claim: CANONICAL_CLAIM,
  recomputedTotals: totals,
  verdict,
  drift,
  problems,
  canonicalRuns: [...bySpec.entries()].map(([spec, slot]) => ({
    spec,
    mode: CANONICAL_MODE[spec],
    canonical: slot.canonical,
    corroborating: slot.corroborating.map((c) => ({ artifact: c.artifact, startTime: c.startTime, sha256: c.sha256, stats: c.stats })),
  })),
  diagnostics: [...bySpec.entries()].flatMap(([, slot]) => slot.diagnostics),
  shaProvenance: SHA_PROVENANCE,
  exclusionRules: EXCLUSION_RULES.map((r) => ({ id: r.id })),
};
writeFileSync(outPath, JSON.stringify(machine, null, 2) + '\n');
console.log(`machine-readable contract: ${path.relative(REPO, outPath)}`);

process.exit(verdict === 'PASS' ? 0 : 1);
