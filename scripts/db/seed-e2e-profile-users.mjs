#!/usr/bin/env node
/**
 * Изолированные учётные записи для E2E-проверки профилей покупателя и кондитера.
 * Создаются только в отдельной CI-БД; не используют общие публичные demo-аккаунты,
 * поэтому защита входа с нового устройства не конфликтует с параллельными спеками.
 */
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const bcrypt = require("bcryptjs");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const runId = String(process.env.GITHUB_RUN_ID || "local").replace(/[^a-zA-Z0-9-]/g, "-");
const password = "Demo123!";
const passwordHash = bcrypt.hashSync(password, 10);

function stableUuid(label) {
  const bytes = crypto.createHash("sha256").update(`conditera-e2e:${runId}:${label}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

const users = [
  { id: stableUuid("profile-customer"), email: `profile-customer-${runId}@e2e.conditera.test`, name: "E2E Покупатель", role: "CUSTOMER" },
  { id: stableUuid("profile-confectioner"), email: `profile-confectioner-${runId}@e2e.conditera.test`, name: "E2E Кондитер", role: "CONFECTIONER" },
];

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  for (const user of users) {
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
         VALUES ($1, $2, '', now(), $3::jsonb, now(), now())
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now()`,
        [user.id, user.email, JSON.stringify({ name: user.name, e2e: true })],
      );
      await client.query(
        `INSERT INTO public.profiles (id, email, name, is_verified, password_hash, is_blocked, loyalty_level, bonus_balance)
         VALUES ($1, $2, $3, true, $4, false, 'BRONZE', 0)
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email, name = EXCLUDED.name, is_verified = true,
           password_hash = EXCLUDED.password_hash, is_blocked = false`,
        [user.id, user.email, user.name, passwordHash],
      );
      await client.query(
        `INSERT INTO public.user_roles (user_id, role, is_active)
         VALUES ($1, $2::user_role, true)
         ON CONFLICT (user_id, role) DO UPDATE SET is_active = true, deactivated_at = NULL`,
        [user.id, user.role],
      );
      if (user.role !== "CUSTOMER") {
        await client.query(
          "UPDATE public.user_roles SET is_active = false WHERE user_id = $1 AND role = 'CUSTOMER'",
          [user.id],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  console.log(`E2E profile accounts ready: ${users.map((u) => u.email).join(", ")}`);
  console.log(`PROFILE_E2E_CUSTOMER_EMAIL=${users[0].email}`);
  console.log(`PROFILE_E2E_CONFECTIONER_EMAIL=${users[1].email}`);
} finally {
  await client.end();
}
