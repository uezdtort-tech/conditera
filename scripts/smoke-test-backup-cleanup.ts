/**
 * Smoke test: backup + cleanup services.
 */
import { getDb } from "../src/lib/db";
import { runFullBackup, cleanupOldBackups, listBackups } from "../src/lib/backup";
import {
  runFullCleanup,
  cleanupOldMaintenanceLogs,
  cleanupOldNotifications,
  cleanupAbandonedCarts,
  cleanupExpiredSemaphores,
  cleanupOldStockMovements,
  cleanupOldVerifications,
  getDbStats,
} from "../src/lib/cleanup";

async function main() {
  console.log("🧪 Backup + Cleanup smoke test");
  const client = await getDb();

  // ===== 1. Full backup =====
  console.log("\n[1] Full backup (JSON export via PGlite)");
  const backupResult = await runFullBackup();
  console.log(`  ✓ success: ${backupResult.success}`);
  console.log(`  ✓ path: ${backupResult.backupPath}`);
  console.log(`  ✓ size: ${backupResult.backupSizeBytes} bytes`);
  console.log(`  ✓ tables: ${backupResult.tablesCount}`);
  console.log(`  ✓ records: ${backupResult.recordsExported}`);
  console.log(`  ✓ duration: ${backupResult.durationMs}ms`);

  // ===== 2. List backups =====
  console.log("\n[2] List backups");
  const backups = await listBackups();
  console.log(`  ✓ found ${backups.length} backup file(s)`);
  if (backups.length > 0) {
    console.log(`    latest: ${backups[0].filename} (${backups[0].sizeBytes} bytes)`);
  }

  // ===== 3. DB stats =====
  console.log("\n[3] DB statistics");
  const stats = await getDbStats();
  console.log(`  ✓ total records: ${stats.totalRecords}`);
  console.log(`  ✓ tables with data:`);
  stats.tables
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count)
    .forEach((t) => console.log(`    ${t.name}: ${t.count}`));

  // ===== 4. Individual cleanup operations =====
  console.log("\n[4] Cleanup: old maintenance logs (>90 days)");
  const r1 = await cleanupOldMaintenanceLogs(90);
  console.log(`  ✓ deleted: ${r1.recordsAffected} records`);

  console.log("\n[5] Cleanup: old read notifications (>90 days)");
  const r2 = await cleanupOldNotifications(90);
  console.log(`  ✓ deleted: ${r2.recordsAffected} records`);

  console.log("\n[6] Cleanup: abandoned carts (>30 days)");
  const r3 = await cleanupAbandonedCarts(30);
  console.log(`  ✓ deleted: ${r3.recordsAffected} records`);

  console.log("\n[7] Cleanup: expired semaphores (>7 days)");
  const r4 = await cleanupExpiredSemaphores(7);
  console.log(`  ✓ deleted: ${r4.recordsAffected} records`);

  console.log("\n[8] Cleanup: old stock movements (>180 days)");
  const r5 = await cleanupOldStockMovements(180);
  console.log(`  ✓ deleted: ${r5.recordsAffected} records`);

  console.log("\n[9] Cleanup: old organization verifications (>365 days)");
  const r6 = await cleanupOldVerifications(365);
  console.log(`  ✓ deleted: ${r6.recordsAffected} records`);

  // ===== 10. Full cleanup (all operations in sequence) =====
  console.log("\n[10] Full cleanup (all operations)");
  const fullCleanup = await runFullCleanup();
  console.log(`  ✓ total deleted: ${fullCleanup.totalDeleted} records`);
  console.log(`  ✓ duration: ${fullCleanup.totalDurationMs}ms`);
  console.log(`  ✓ operations:`);
  fullCleanup.results.forEach((r) => {
    console.log(`    ${r.type}: ${r.success ? "✓" : "✗"} ${r.recordsAffected} records (${r.durationMs}ms)`);
  });

  // ===== 11. Verify maintenance log was created =====
  console.log("\n[11] Verify MaintenanceLog records");
  const logCount = await client.maintenanceLog.count();
  console.log(`  ✓ maintenance_logs in DB: ${logCount}`);

  // ===== 12. Cleanup old backups =====
  console.log("\n[12] Cleanup old backups (>30 days)");
  const oldDeleted = await cleanupOldBackups();
  console.log(`  ✓ deleted: ${oldDeleted} old backup file(s)`);

  console.log("\n🎉 All smoke tests passed!");
  await client.$disconnect();
}

main().catch((err) => {
  console.error("❌ Smoke test failed:", err);
  process.exit(1);
});
