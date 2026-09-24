/**
 * seed-test-users.ts — создать тестовых пользователей для E2E тестов.
 *
 * Создаёт:
 *  - admin@conditera.ru / AdminPassword123! (role: ADMIN)
 *  - customer@test.ru / TestPassword123! (role: CUSTOMER)
 *  - confectioner@test.ru / TestPassword123! (role: CONFECTIONER, pending)
 *
 * Запуск: npx tsx scripts/seed-test-users.ts
 */

import { PGlite } from "@electric-sql/pglite";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { join } from "node:path";

const DB_PATH = process.env.PGLITE_DB_PATH || join(process.cwd(), "db", "pglite-dev");

async function main() {
  console.info(`[seed] Starting PGlite at ${DB_PATH}`);
  const db = new PGlite(DB_PATH);

  const users = [
    {
      email: "admin@conditera.ru",
      password: "AdminPassword123!",
      name: "Тестовый Админ",
      phone: "+79990000000",
      roles: ["ADMIN"],
      accountType: "individual" as const,
    },
    {
      email: "customer@test.ru",
      password: "TestPassword123!",
      name: "Тестовый Покупатель",
      phone: "+79990000001",
      roles: ["CUSTOMER"],
      accountType: "individual" as const,
    },
    {
      email: "confectioner@test.ru",
      password: "TestPassword123!",
      name: "Тестовый Кондитер",
      phone: "+79990000002",
      roles: ["CONFECTIONER"],
      accountType: "individual" as const,
      legalInfo: { status: "NPD", inn: "770000000000" },
    },
  ];

  for (const user of users) {
    // Проверяем, существует ли уже
    const existing = await db.query(
      `SELECT id FROM users WHERE email = $1`,
      [user.email]
    );
    if ((existing as any).rows?.length > 0) {
      console.info(`[seed] ✓ ${user.email} already exists, skipping`);
      continue;
    }

    const passwordHash = await bcrypt.hash(user.password, 10);
    const id = `user_${randomBytes(6).toString("hex")}`;
    const roles = user.roles;
    const legalInfo = user.legalInfo ? JSON.stringify(user.legalInfo) : null;

    await db.query(
      `INSERT INTO users (id, email, "passwordHash", name, phone, roles, "accountType", "legalInfo", "loyaltyLevel", "bonusBalance", "isBlocked", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'BRONZE', 0, false, NOW(), NOW())`,
      [id, user.email, passwordHash, user.name, user.phone, roles, user.accountType, legalInfo]
    );

    console.info(`[seed] ✓ Created ${user.email} (${user.roles.join(",")})`);

    // Для кондитера — создадим профиль
    if (user.roles.includes("CONFECTIONER")) {
      const confId = `conf_${randomBytes(6).toString("hex")}`;
      const legalInfoJson = user.legalInfo ? JSON.stringify(user.legalInfo) : "{}";
      try {
        await db.query(
          `INSERT INTO confectioners (
            id, "userId", "businessName", slug, description, avatar, city, location,
            rating, "reviewsCount", "ordersCount", verified, "verificationStatus",
            "trustLevel", tariff, "legalInfo", "taxMode",
            specialization, "portfolioImages", "followersCount", "responseTime",
            "joinedAt", "selfPickup", "deliveryOptions", "paymentSettings", "ecoBadges",
            balance, "totalEarnings", "monthlyEarnings", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            0, 0, 0, false, 'pending',
            'NEW', 'START', $9::jsonb, 'NPD',
            $10, $11, 0, '',
            NOW(), true, $12, NULL, $13,
            0, 0, 0, NOW(), NOW()
          )`,
          [
            confId,
            id,
            "Тестовая кондитерская",
            `test-confectioner-${Date.now()}`,
            "Описание тестовой кондитерской для E2E тестов. Минимум 30 символов.",
            "/logo.png",
            "Москва",
            JSON.stringify({ lat: 55.7558, lng: 37.6176, serviceRadiusKm: 20 }),
            legalInfoJson,
            [], // specialization
            [], // portfolioImages
            ["own"], // deliveryOptions
            [], // ecobadges
          ]
        );
        console.info(`[seed] ✓ Created confectioner profile for ${user.email} (pending)`);
      } catch (e) {
        console.error(`[seed] Failed to create confectioner profile:`, (e as Error).message);
      }
    }
  }

  // Проверим созданных пользователей
  const allUsers = await db.query(`SELECT email, roles, "isBlocked" FROM users ORDER BY email`);
  console.info(`\n[seed] Users in database (${(allUsers as any).rows?.length || 0}):`);
  for (const row of (allUsers as any).rows || []) {
    console.info(`  • ${row.email} [${row.roles}] blocked=${row.isBlocked}`);
  }

  // Проверим кондитеров
  const confs = await db.query(`
    SELECT c."businessName", c.city, c."verificationStatus", c.verified, u.email
    FROM confectioners c
    JOIN users u ON c."userId" = u.id
    ORDER BY c."createdAt" DESC
  `);
  console.info(`\n[seed] Confectioners (${(confs as any).rows?.length || 0}):`);
  for (const row of (confs as any).rows || []) {
    console.info(`  • ${row.email} → ${row.businessName} (${row.city}) — ${row.verificationStatus}, verified=${row.verified}`);
  }

  await db.close();
  console.info(`\n[seed] ✓ Done! Test users ready:`);
  console.info(`  Admin:      admin@conditera.ru / AdminPassword123!`);
  console.info(`  Customer:   customer@test.ru / TestPassword123!`);
  console.info(`  Confectioner: confectioner@test.ru / TestPassword123! (pending)`);
}

main().catch((e) => {
  console.error("[seed] Fatal:", e);
  process.exit(1);
});
