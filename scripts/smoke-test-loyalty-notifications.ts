/**
 * Smoke test for new loyalty + notification models.
 */
import { db, getDb } from "../src/lib/db";
import { sendNotification } from "../src/lib/notifications";
import { recordLoyaltyTx, recalcUserLevel } from "../src/lib/loyalty";

async function main() {
  console.log("🧪 Loyalty + Notifications smoke test");
  const client = await getDb();

  const user = await client.user.findUnique({
    where: { email: "customer@demo.ru" },
  });
  if (!user) throw new Error("customer user not found");

  // 1. Create a loyalty transaction (earn)
  const { newBalance } = await recordLoyaltyTx({
    userId: user.id,
    type: "EARN",
    points: 50,
    description: "Smoke test: +50 bonus points",
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  });
  console.log(`✓ LoyaltyTransaction created, new balance: ${newBalance}`);

  // 2. Recalc level
  const { level, promoted } = await recalcUserLevel(user.id);
  console.log(`✓ User level: ${level} (promoted: ${promoted})`);

  // 3. Send a test notification (in_app only — no external delivery in dev)
  const { notificationIds } = await sendNotification({
    userId: user.id,
    template: "BONUS_EARNED",
    vars: { points: 50, orderNumber: "TEST-001", balance: newBalance },
  });
  console.log(`✓ Notification sent, IDs: ${notificationIds.length}`);

  // 4. Read back the notification
  const notifs = await client.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  console.log(`✓ Notifications in DB: ${notifs.length}`);
  if (notifs[0]) {
    console.log(`  - latest: template=${notifs[0].template} status=${notifs[0].status}`);
    console.log(`  - title: ${notifs[0].title}`);
  }

  // 5. Create notification preferences
  const prefs = await client.notificationPreferences.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      emailEnabled: true,
      smsEnabled: false,
      pushEnabled: true,
      telegramEnabled: false,
      inAppEnabled: true,
    },
  });
  console.log(`✓ NotificationPreferences created (pushEnabled: ${prefs.pushEnabled})`);

  // 6. Test AR fields on Product
  const product = await client.product.findFirst();
  if (product) {
    console.log(`✓ Product found, modelUrl: ${product.modelUrl || "(null)"}, arEnabled: ${product.arEnabled}`);
  }

  // Cleanup the test transaction (reverse it)
  await recordLoyaltyTx({
    userId: user.id,
    type: "ADJUST",
    points: -50,
    description: "Smoke test cleanup",
  });
  console.log(`✓ Cleanup done`);

  console.log("\n🎉 All smoke tests passed!");
  await client.$disconnect();
}

main().catch((err) => {
  console.error("❌ Smoke test failed:", err);
  process.exit(1);
});
