#!/usr/bin/env node
/**
 * scripts/verify/osv-audit.mjs — проверка безопасности зависимостей
 * (DEPLOY-01 §6 п.17) с baseline-диффом.
 *
 * Логика:
 *   1. Запускает osv-scanner по bun.lock и package-lock.json.
 *   2. Извлекает множество advisory ID (GHSA/OVN).
 *   3. Сравнивает с baseline scripts/security/osv-baseline.json:
 *        • НОВЫЕ advisory (нет в baseline) → exit 1 (CI красный);
 *        • Baseline-элементы → WARN + в отчёте (remediation backlog,
 *          решение владельца D-8 в docs/operations/OWNER_DECISIONS.md).
 *   4. --update-baseline: пересоздаёт baseline (после устранения backlog
 *      или осознанного решения владельца — в коммите с обоснованием).
 *
 * Binary: env OSSV_BIN, иначе ищет osv-scanner в PATH/tmp.
 * Использование:
 *   node scripts/verify/osv-audit.mjs            # дифф против baseline
 *   node scripts/verify/osv-audit.mjs --update-baseline
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCKFILES = ["bun.lock", "package-lock.json"];
const BASELINE_PATH = "scripts/security/osv-baseline.json";
const UPDATE = process.argv.includes("--update-baseline");

function findBinary() {
  if (process.env.OSSV_BIN && existsSync(process.env.OSSV_BIN)) return process.env.OSSV_BIN;
  const candidates = ["/tmp/osv-scanner", "/usr/local/bin/osv-scanner"];
  for (const c of candidates) if (existsSync(c)) return c;
  try {
    execFileSync("which", ["osv-scanner"], { stdio: "pipe" });
    return "osv-scanner";
  } catch {
    return null;
  }
}

function downloadBinary(dest) {
  const url = "https://github.com/google/osv-scanner/releases/latest/download/osv-scanner_linux_amd64";
  console.log(`[osv-audit] downloading scanner binary…`);
  execFileSync("curl", ["-sSfL", "--max-time", "120", url, "-o", dest], { stdio: "inherit" });
  execFileSync("chmod", ["+x", dest]);
}

function collectAdvisories() {
  let bin = findBinary();
  if (!bin) {
    bin = join(tmpdir(), "osv-scanner");
    downloadBinary(bin);
  }

  const combined = new Map();
  for (const lockfile of LOCKFILES) {
    const findings = runScan(bin, lockfile);
    console.log(`[osv-audit] ${lockfile}: ${findings.size} advisory`);
    for (const [id, finding] of findings) {
      if (!combined.has(id)) combined.set(id, finding);
    }
  }
  return combined;
}

function runScan(bin) {
  let out;
  try {
    out = execFileSync(bin, ["scan", "source", "--lockfile", lockfile, "--format", "json"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"], // stderr = логи сканера
    });
  } catch (e) {
    // osv-scanner exit 1 = найдены уязвимости — stdout всё равно содержит JSON
    out = e.stdout;
    if (!out) {
      console.error("[osv-audit] scanner failed:", e.stderr?.slice(0, 300));
      process.exit(2);
    }
  }
  const j = JSON.parse(out);
  const found = new Map();
  for (const r of j.results || []) {
    for (const p of r.packages || []) {
      for (const v of p.vulnerabilities || []) {
        const primary = (v.aliases || []).find((a) => a.startsWith("GHSA")) || v.id;
        if (!found.has(primary)) {
          found.set(primary, {
            id: primary,
            package: p.package.name,
            fixed:
              v.affected?.[0]?.ranges?.[0]?.events?.find((e) => e.fixed)?.fixed || null,
          });
        }
      }
    }
  }
  return found;
}

function main() {
  const missingLockfiles = LOCKFILES.filter((file) => !existsSync(file));
  if (missingLockfiles.length > 0) {
    console.error(`[osv-audit] lockfile(s) не найдены: ${missingLockfiles.join(", ")}`);
    process.exit(2);
  }
  const found = collectAdvisories();

  if (UPDATE) {
    mkdirSync("scripts/security", { recursive: true });
    const entries = [...found.values()].sort((a, b) => a.package.localeCompare(b.package));
    const baseline = {
      _comment:
        "DEPLOY-01 osv-scanner baseline. New advisories FAIL CI; baseline items are a remediation backlog (OWNER_DECISIONS D-8). Regenerate: node scripts/verify/osv-audit.mjs --update-baseline",
      advisories: entries,
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`[osv-audit] baseline updated: ${entries.length} advisories → ${BASELINE_PATH}`);
    return;
  }

  if (!existsSync(BASELINE_PATH)) {
    console.error(
      `[osv-audit] baseline отсутствует (${BASELINE_PATH}). Создайте осознанно: --update-baseline (решение владельца).`
    );
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const known = new Set((baseline.advisories || []).map((a) => a.id));

  const novel = [...found.values()].filter((a) => !known.has(a.id));
  const fixedFromBaseline = (baseline.advisories || []).filter((a) => !found.has(a.id));

  console.log(`[osv-audit] всего advisory: ${found.size}`);
  console.log(`[osv-audit] в baseline: ${known.size}; новых: ${novel.length}; устранённых с baseline: ${fixedFromBaseline.length}`);

  if (fixedFromBaseline.length > 0) {
    console.log("[osv-audit] устранённые (обновите baseline):");
    for (const f of fixedFromBaseline) console.log(`  - ${f.id} (${f.package})`);
  }

  if (novel.length > 0) {
    console.error("[osv-audit] НОВЫЕ УЯЗВИМОСТИ (не в baseline) — CI FAILED:");
    for (const n of novel) console.error(`  ✗ ${n.id} [${n.package}] fixed-in: ${n.fixed || "—"}`);
    process.exit(1);
  }

  if (known.size > 0) {
    console.warn(
      `[osv-audit] ${known.size} известных advisory остаются в baseline (remediation backlog → OWNER_DECISIONS D-8). Это WARN, не FAIL.`
    );
  }
  console.log("[osv-audit] PASS: новых уязвимостей нет");
}

main();
