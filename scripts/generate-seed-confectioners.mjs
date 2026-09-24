/**
 * generate-seed-confectioners.mjs — генерирует supabase/seed_confectioners.sql
 * из MOCK_CONFECTIONERS (src/lib/mock-data.ts).
 *
 * Задача 10 (v3 ТЗ): вынести mock-кондитеров из runtime в seed-скрипт,
 * чтобы прод-БД наполнялась теми же демо-данными через SQL.
 *
 * Запуск: bun scripts/generate-seed-confectioners.mjs
 * Применение: psql "$DATABASE_URL" -f supabase/seed_confectioners.sql
 *
 * Маппинг legacy-значений mock → DB enums (миграция 0016b/0017):
 *   trustLevel: TRUSTED → VERIFIED
 *   tariff:     PROFI   → PREMIUM
 *   taxMode:    IP → USN, OOO → OSNO
 */
import { MOCK_CONFECTIONERS } from "../src/lib/mock-data.ts";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "supabase", "seed_confectioners.sql");

const mapTrust = (t) => (t === "TRUSTED" ? "VERIFIED" : t || "NEW");
const mapTariff = (t) => (t === "PROFI" ? "PREMIUM" : t || "START");
const mapTax = (t) => (t === "IP" ? "USN" : t === "OOO" ? "OSNO" : t || "NPD");

function q(v) {
  if (v === null || v === undefined) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}
function qjson(v) {
  if (v === null || v === undefined) return "NULL";
  return `${q(JSON.stringify(v))}::jsonb`;
}
function qarr(arr) {
  if (!arr || arr.length === 0) return "ARRAY[]::TEXT[]";
  return `ARRAY[${arr.map(q).join(",")}]::TEXT[]`;
}

let sql = `-- ============================================================
-- seed_confectioners.sql — демо-кондитеры для публичной бегущей строки.
-- АВТОГЕНЕРИРОВАНО: bun scripts/generate-seed-confectioners.mjs
-- (источник: src/lib/mock-data.ts MOCK_CONFECTIONERS)
--
-- Идемпотентно: ON CONFLICT (id) DO UPDATE.
-- Legacy-значения замаплены в DB enums:
--   trustLevel TRUSTED→VERIFIED, tariff PROFI→PREMIUM,
--   taxMode IP→USN, OOO→OSNO.
-- ============================================================

-- userId-стабы (кондитеры-демо не привязаны к auth.users — TEXT без FK)
INSERT INTO public.confectioners (
  id, "userId", "businessName", slug, description, avatar, cover, city,
  location, rating, "reviewsCount", "ordersCount", verified,
  "verificationStatus", "trustLevel", tariff, "legalInfo", "taxMode",
  specialization, "portfolioImages", "followersCount", "responseTime",
  "joinedAt", "selfPickup", "deliveryOptions", "paymentSettings", "ecoBadges",
  balance, "totalEarnings", "monthlyEarnings", "createdAt", "updatedAt"
) VALUES
`;

const rows = MOCK_CONFECTIONERS.map((c, i) => {
  const now = "now()";
  const values = [
    q(c.id),
    q(c.userId || `seed-${c.id}`),
    q(c.businessName),
    q(c.slug),
    q(c.description),
    q(c.avatar),
    q(c.cover ?? null),
    q(c.city),
    qjson(c.location),
    c.rating ?? 0,
    c.reviewsCount ?? 0,
    c.ordersCount ?? 0,
    c.verified === true,
    q(c.verificationStatus || "approved"),
    q(mapTrust(c.trustLevel)),
    q(mapTariff(c.tariff)),
    qjson(c.legalInfo || {}),
    q(mapTax(c.taxMode)),
    qarr(c.specialization),
    qarr(c.portfolioImages),
    c.followersCount ?? 0,
    q(c.responseTime || ""),
    c.joinedAt ? `'${c.joinedAt}'::timestamptz` : now,
    c.selfPickup === true,
    qarr(c.deliveryOptions),
    qjson(c.paymentSettings || {}),
    qarr(c.ecoBadges),
    c.balance ?? 0,
    c.totalEarnings ?? 0,
    c.monthlyEarnings ?? 0,
    now,
    now,
  ];
  return `(${values.join(", ")})` + (i < MOCK_CONFECTIONERS.length - 1 ? "," : "");
});

sql += rows.join("\n") + `

ON CONFLICT (id) DO UPDATE SET
  "businessName" = EXCLUDED."businessName",
  slug = EXCLUDED.slug,
  description = EXCLUDED.description,
  avatar = EXCLUDED.avatar,
  cover = EXCLUDED.cover,
  city = EXCLUDED.city,
  location = EXCLUDED.location,
  rating = EXCLUDED.rating,
  "reviewsCount" = EXCLUDED."reviewsCount",
  "ordersCount" = EXCLUDED."ordersCount",
  verified = EXCLUDED.verified,
  "verificationStatus" = EXCLUDED."verificationStatus",
  "trustLevel" = EXCLUDED."trustLevel",
  tariff = EXCLUDED.tariff,
  "legalInfo" = EXCLUDED."legalInfo",
  "taxMode" = EXCLUDED."taxMode",
  specialization = EXCLUDED.specialization,
  "portfolioImages" = EXCLUDED."portfolioImages",
  "followersCount" = EXCLUDED."followersCount",
  "responseTime" = EXCLUDED."responseTime",
  "selfPickup" = EXCLUDED."selfPickup",
  "deliveryOptions" = EXCLUDED."deliveryOptions",
  "paymentSettings" = EXCLUDED."paymentSettings",
  "ecoBadges" = EXCLUDED."ecoBadges",
  "updatedAt" = now();

-- Проверка: все seeded-кондитеры verified=true (RLS-политика public SELECT)
DO $$
DECLARE v_count INTEGER; v_verified INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.confectioners WHERE id LIKE 'c_';
  SELECT COUNT(*) INTO v_verified FROM public.confectioners WHERE id LIKE 'c_' AND verified = true;
  IF v_count <> v_verified THEN
    RAISE WARNING 'seed_confectioners: % из % seeded-кондитеров verified', v_verified, v_count;
  END IF;
  RAISE NOTICE 'seed_confectioners: OK, % строк', v_count;
END $$;
`;

writeFileSync(OUT, sql, "utf-8");
console.log(`OK: ${OUT} (${MOCK_CONFECTIONERS.length} confectioners)`);
