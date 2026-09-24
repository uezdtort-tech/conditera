/**
 * check-health.ts — быстро проверить что /api/health возвращает,
 * не запуская Next.js dev сервер.
 *
 * Запуск:
 *   npx tsx scripts/check-health.ts
 */
import { GET } from "../src/app/api/health/route";

async function main() {
  console.log("══════════════════════════════════════════════════════");
  console.log("  Проверка /api/health");
  console.log("══════════════════════════════════════════════════════");

  // Установить минимальные env vars чтобы health не был degraded
  process.env.NODE_ENV = process.env.NODE_ENV || "development";

  const response = await GET();
  const json = await response.json();

  console.log(`\nHTTP Status: ${response.status}`);
  console.log(`Service: ${json.service}`);
  console.log(`Version: ${json.version}`);
  console.log(`Status: ${json.status}`);
  console.log(`Environment: ${json.environment}`);
  console.log(`Uptime: ${json.uptime.toFixed(2)}s`);
  console.log(`Timestamp: ${json.timestamp}`);

  console.log("\n── Features v2.0 ──");
  for (const [feature, enabled] of Object.entries(json.features || {})) {
    const icon = enabled ? "✓" : "✗";
    console.log(`  ${icon} ${feature}: ${enabled}`);
  }

  console.log("\n── Dependencies ──");
  for (const dep of json.dependencies || []) {
    const reqIcon = dep.required ? "REQUIRED" : "optional";
    const confIcon = dep.configured ? "✓ configured" : "✗ missing";
    const details = dep.details ? ` (${dep.details})` : "";
    console.log(`  ${dep.name.padEnd(20)} [${reqIcon.padEnd(8)}] ${confIcon}${details}`);
  }

  console.log("\n══════════════════════════════════════════════════════");
  if (json.status === "ok") {
    console.log("✅ Health check PASSED — все required dependencies настроены");
  } else {
    console.log("⚠ Health check DEGRADED — некоторые required env vars не настроены");
    console.log("   Это нормально в dev окружении без .env.local");
  }
  console.log("══════════════════════════════════════════════════════");

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
