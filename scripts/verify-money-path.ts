/**
 * verify-money-path.ts — проверка целостности money-path на ЖИВОЙ БД.
 *
 * Источник: аудит «БД и целостность цепочек» @ 3f4ba40 (§8 — чеклист).
 * Дополняет миграции 0034_money_path_identity.sql и 0036_payout_integrity.sql:
 *   0034/0036 чинят схему, этот скрипт проверяет, что на конкретной БД
 *   цепочка «оплата → escrow → баланс → резерв → выплата» действительно замкнута.
 *
 * Запуск (read-only, без записи):
 *   DATABASE_URL=postgresql://postgres:...@db.xxx.supabase.co:5432/postgres \
 *     npx tsx scripts/verify-money-path.ts
 *
 * Exit codes: 0 — критических находок нет; 1 — есть (см. CRITICAL в выводе).
 */
import { Client } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let critical = 0;

function ok(label: string, detail = "") {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
}

function warn(label: string, detail = "") {
  console.log(`  ⚠ ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label: string, detail = "") {
  critical++;
  console.log(`  ✗ CRITICAL ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log(`verify-money-path → ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}\n`);

  // ------------------------------------------------------------------
  // 0. Применена ли миграция 0034 (без неё остальное неверно трактуется)
  // ------------------------------------------------------------------
  console.log("─── 0. Схема money-path (миграция 0034) ───");
  const orderCols = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='orders'
        AND column_name IN ('payment_status','escrow_released_at','payout_transferred_at','tariff_snapshot','commission_rate_snapshot')`
  );
  if (orderCols.rowCount === 5) {
    ok("orders: money-колонки на месте (payment_status, escrow_released_at, payout_transferred_at, tariff_snapshot, commission_rate_snapshot)");
  } else {
    fail(
      "миграция 0034 не применена",
      `найдено ${orderCols.rowCount}/5 колонок; запустите scripts/apply-migrations.ts`
    );
  }

  // ------------------------------------------------------------------
  // 1. RPC deduct_conference_balance: существует + EXECUTE только service_role
  // ------------------------------------------------------------------
  console.log("\n─── 1. RPC deduct_confectioner_balance (0013 + grants 0034) ───");
  const rpc = await client.query(
    `SELECT p.oid::regprocedure::text AS sig, p.proacl::text AS acl
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='deduct_confectioner_balance'`
  );
  if (rpc.rowCount === 0) {
    fail("RPC deduct_conference_balance отсутствует — списание баланса при выплате упадёт (миграция 0013 не накатана?)");
  } else {
    const acl = String(rpc.rows[0].acl ?? "");
    ok(`RPC на месте: ${rpc.rows[0].sig}`);
    if (acl.includes("service_role") && !acl.includes("PUBLIC") && !acl.includes("anon") && !acl.includes("authenticated")) {
      ok("EXECUTE только у service_role");
    } else {
      warn("EXECUTE шире service_role — примените миграцию 0034 (шаг 4)", acl);
    }
  }

  // ------------------------------------------------------------------
  // 2. confectioners: camelCase-колонки 0017
  // ------------------------------------------------------------------
  console.log("\n─── 2. Схема confectioners (0017, camelCase) ───");
  const confCols = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='confectioners'
        AND column_name IN ('id','userId','businessName','balance','totalEarnings')`
  );
  const colNames = confCols.rows.map((r) => r.column_name);
  for (const c of ["id", "userId", "businessName", "balance", "totalEarnings"]) {
    if (colNames.includes(c)) ok(`колонка «${c}» есть`);
    else fail(`нет колонки «${c}» в confectioners — код money-path (db1-1..3) сломается`);
  }
  const legacy = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='confectioners'
        AND column_name IN ('user_id','business_name','total_earnings','legal_info')`
  );
  if (legacy.rowCount > 0) {
    warn(`обнаружены snake_case-колонки: ${legacy.rows.map((r) => r.column_name).join(", ")} — возможно, кто-то добавил их вручную; код должен использовать camelCase 0017`);
  } else {
    ok("snake_case-дубликатов нет");
  }

  // ------------------------------------------------------------------
  // 3. Сироты: заказы с confectioner_id без профиля кондитера
  // ------------------------------------------------------------------
  console.log("\n─── 3. Сироты: orders.confectioner_id без профиля в confectioners ───");
  const orphans = await client.query(
    `SELECT o.id, o.number, o.confectioner_id, o.created_at
       FROM public.orders o
       LEFT JOIN public.confectioners c ON c."userId" = o.confectioner_id::text
      WHERE o.confectioner_id IS NOT NULL AND c.id IS NULL
      ORDER BY o.created_at DESC
      LIMIT 20`
  );
  if (orphans.rowCount === 0) {
    ok("сирот нет");
  } else {
    fail(
      `${orphans.rowCount} заказов(+) не находят профиль кондитера по «userId» — эскроу для них никогда не релизнется`,
      orphans.rows.map((r) => `${r.number ?? r.id}`).slice(0, 10).join(", ")
    );
  }

  // ------------------------------------------------------------------
  // 4. Эскроу/выплаты: застрявшие состояния
  // ------------------------------------------------------------------
  console.log("\n─── 4. Застрявшие денежные состояния orders ───");
  const stuck = await client.query(
    `SELECT
       count(*) FILTER (WHERE o.payment_status = 'escrow' AND o.escrow_released_at IS NULL)::int AS awaiting_release,
       count(*) FILTER (WHERE o.payment_status = 'released' AND o.payout_transferred_at IS NULL)::int AS awaiting_payout,
       count(*) FILTER (WHERE o.payment_status = 'pending' AND o.status NOT IN ('CANCELLED','REFUNDED')
                         AND EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = o.id AND p.status = 'succeeded'))::int AS paid_but_pending
     FROM public.orders o`
  );
  const s = stuck.rows[0];
  ok(`escrow в холде (ждут cron): ${s.awaiting_release}`);
  ok(`released без выплаты (ждут payout): ${s.awaiting_payout}`);
  if (Number(s.paid_but_pending) > 0) {
    warn(
      `${s.paid_but_pending} оплаченных заказов(+) стоят payment_status='pending'`,
      "webhook падал до миграции 0034; кандидат на ручной бэкфилл (см. хвост 0034) — требуется подтверждение владельца продукта"
    );
  } else {
    ok("оплаченных заказов в pending нет — webhook-цепочка замкнута");
  }

  // ------------------------------------------------------------------
  // 5. Единицы: payments.amount == orders.total (рубли)
  // ------------------------------------------------------------------
  console.log("\n─── 5. Единицы: последние платежи vs суммы заказов ───");
  const units = await client.query(
    `SELECT p.id, p.amount, o.total, p.yookassa_payment_id, p.created_at
       FROM public.payments p JOIN public.orders o ON o.id = p.order_id
      WHERE p.status IN ('succeeded','escrow','released','refunded')
      ORDER BY p.created_at DESC LIMIT 10`
  );
  if (units.rowCount === 0) {
    warn("успешных платежей нет — сверка единиц невозможна (пустая база?)");
  } else {
    let mismatches = 0;
    for (const r of units.rows) {
      if (Number(r.amount) !== Number(r.total)) {
        mismatches++;
        fail(`payments.amount ≠ orders.total: payment ${r.id} amount=${r.amount} vs total=${r.total} (yookassa ${r.yookassa_payment_id ?? "—"})`);
      }
    }
    if (mismatches === 0) {
      ok(`все ${units.rowCount} последних платежей сходятся с orders.total (рубли)`);
    }
    // Классический маркер путаницы единиц: amounts, похожие на копейки
    const kopeckish = await client.query(
      `SELECT count(*)::int AS n FROM public.payments WHERE amount > 100000`
    );
    if (Number(kopeckish.rows[0].n) > 0) {
      warn(`${kopeckish.rows[0].n} платежей(+) с amount > 100 000 ₽ — проверьте, не копейки ли это из легаси`);
    }
  }

  // ------------------------------------------------------------------
  // 6. Дубликаты выплат: payouts (0019, legacy) vs payout_requests (0009)
  // ------------------------------------------------------------------
  console.log("\n─── 6. Контуры выплат ───");
  const pr = await client.query(`SELECT count(*)::int AS n FROM public.payout_requests`);
  const po = await client.query(`SELECT count(*)::int AS n FROM public.payouts`).catch(() => ({ rows: [{ n: null }] }));
  ok(`payout_requests (активный контур): ${pr.rows[0].n} записей`);
  ok(`payouts (legacy 0019): ${po.rows[0].n ?? "таблица отсутствует"} записей`);
  if (Number(po.rows[0].n ?? 0) > 0) {
    warn("в legacy-таблице payouts есть данные — при сверки финансов учитывайте оба источника (merge — PAY-2/PAY-3)");
  }

  // ------------------------------------------------------------------
  // 7. PAY-3: целостность контура выплат (миграция 0036)
  // ------------------------------------------------------------------
  console.log("\n─── 7. PAY-3: контур выплат (0036) ───");

  // 7a. orders.payout_reserved_at — CAS-резерв против двойной выплаты батча
  const reservedCol = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='orders' AND column_name='payout_reserved_at'`
  );
  if (reservedCol.rowCount === 1) {
    ok("orders.payout_reserved_at на месте (CAS-резерв payouts/request)");
  } else {
    fail(
      "нет orders.payout_reserved_at — миграция 0036 не применена: payouts/request будет падать (или, без неё, возможна двойная выплата батча)"
    );
  }

  // 7b. RPC add_confectioner_balance: существует + EXECUTE только service_role
  const addRpc = await client.query(
    `SELECT p.oid::regprocedure::text AS sig, p.proacl::text AS acl
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='add_confectioner_balance'`
  );
  if (addRpc.rowCount === 0) {
    fail("RPC add_confectioner_balance отсутствует — reject/компенсации резервов будут падать (0036 не накатана?)");
  } else {
    const acl = String(addRpc.rows[0].acl ?? "");
    ok(`RPC add_confectioner_balance: ${addRpc.rows[0].sig}`);
    if (acl.includes("service_role") && !acl.includes("PUBLIC") && !acl.includes("anon") && !acl.includes("authenticated")) {
      ok("EXECUTE только у service_role");
    } else {
      warn("EXECUTE шире service_role — примените миграцию 0036 (шаг 3)", acl);
    }
  }

  // 7c. bonus-RPC: PUBLIC EXECUTE позволял anon жечь/накачивать чужие бонусы
  for (const bonusFn of ["add_bonus_balance", "deduct_bonus_balance"]) {
    const b = await client.query(
      `SELECT p.proacl::text AS acl FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname=$1`,
      [bonusFn]
    );
    const acl = String(b.rows[0]?.acl ?? "");
    if (acl.includes("PUBLIC") || acl.includes("anon") || acl.includes("authenticated")) {
      warn(`${bonusFn}: EXECUTE шире service_role — примените 0036 (шаг 3)`, acl);
    } else {
      ok(`${bonusFn}: EXECUTE только service_role`);
    }
  }

  // 7d. RLS payouts_update_admin: без INSPECTOR (разделение полномочий)
  const pol = await client.query(
    `SELECT qual FROM pg_policies
      WHERE schemaname='public' AND tablename='payout_requests' AND policyname='payouts_update_admin'`
  );
  if (pol.rowCount === 0) {
    warn("политика payouts_update_admin не найдена — RLS на payout_requests ослаблен (0036 шаг 4)");
  } else if (String(pol.rows[0].qual).includes("INSPECTOR")) {
    warn("payouts_update_admin всё ещё допускает INSPECTOR — примените 0036 (шаг 4)");
  } else {
    ok("RLS payouts_update_admin: только ADMIN/SUPER_ADMIN");
  }

  // 7e. Санитрия состояний: зарезервированные заказы и неизвестные статусы заявок
  const pay3State = await client.query(
    `SELECT
       (SELECT count(*)::int FROM public.orders
         WHERE payout_reserved_at IS NOT NULL AND payout_transferred_at IS NULL) AS reserved,
       (SELECT count(*)::int FROM public.payout_requests
         WHERE status NOT IN ('pending','approved','rejected','paid')) AS unknown_status`
  );
  ok(`заказов в резерве под открытые заявки: ${pay3State.rows[0].reserved}`);
  if (Number(pay3State.rows[0].unknown_status) > 0) {
    warn(`${pay3State.rows[0].unknown_status} заявок(+) с неизвестным статусом — сверьте со стейт-машиной 0036 (pending|approved|rejected|paid)`);
  }
  // Открытые (pending/approved) заявки без состава — complete для них запрещён
  const orphanReq = await client.query(
    `SELECT count(*)::int AS n FROM public.payout_requests
      WHERE status IN ('pending','approved')
        AND (metadata IS NULL OR NOT (metadata ? 'orders'))`
  );
  if (Number(orphanReq.rows[0].n) > 0) {
    warn(`${orphanReq.rows[0].n} открытых заявок(+) без metadata.orders — complete для них запрещён (созданы вне /api/payouts/request)`);
  }

  // ------------------------------------------------------------------
  // 8. PAY-3b: привязка резерва к заявке + атомарные RPC (миграция 0037)
  // ------------------------------------------------------------------
  console.log("\n─── 8. PAY-3b: привязка резерва / атомарные RPC (0037) ───");

  // 8a. orders.payout_request_id — жёсткая связь «заказ ⇔ заявка»
  const linkCol = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='orders' AND column_name='payout_request_id'`
  );
  if (linkCol.rowCount === 1) {
    ok("orders.payout_request_id на месте (связь резерва с заявкой)");
  } else {
    fail(
      "нет orders.payout_request_id — миграция 0037 не применена: reject/complete фильтруют резерв по этой колонке (чужой резерв/дрейф)"
    );
  }

  // 8b. Резервы без привязки (применены до 0037 / ручные операции)
  if (linkCol.rowCount === 1) {
    const orphanReserve = await client.query(
      `SELECT count(*)::int AS n FROM public.orders
        WHERE payout_reserved_at IS NOT NULL AND payout_request_id IS NULL`
    );
    if (Number(orphanReserve.rows[0].n) > 0) {
      warn(
        `${orphanReserve.rows[0].n} заказов(+) в резерве БЕЗ payout_request_id — снятие/маркировка по привязке их не заденут; разберите вручную (apply 0037 до деплоя кода)`
      );
    } else {
      ok("осиротевших резервов (без привязки к заявке) нет");
    }
  }

  // 8c. CHECK статуса payout_requests
  const statusCheck = await client.query(
    `SELECT 1 FROM pg_constraint
      WHERE conname='payout_requests_status_check'
        AND conrelid='public.payout_requests'::regclass`
  );
  if (statusCheck.rowCount === 1) {
    ok("payout_requests_status_check на месте (pending|approved|paid|rejected)");
  } else {
    warn("нет CHECK-констрейнта payout_requests_status_check — примените 0037 (шаг 2)");
  }

  // 8d. Атомарные RPC 0037: существуют + EXECUTE только service_role
  for (const rpcName of ["release_escrow_order", "consume_tfa_backup_code"]) {
    const r = await client.query(
      `SELECT p.oid::regprocedure::text AS sig, p.proacl::text AS acl
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1`,
      [rpcName]
    );
    if (r.rowCount === 0) {
      if (rpcName === "release_escrow_order") {
        warn("RPC release_escrow_order отсутствует — эскроу работает в fallback CAS-цикле (0037 не применена)");
      } else {
        warn("RPC consume_tfa_backup_code отсутствует — 2FA backup-коды в fallback read-filter-write (0037 не применена)");
      }
      continue;
    }
    const acl = String(r.rows[0].acl ?? "");
    ok(`RPC ${rpcName}: ${r.rows[0].sig}`);
    if (acl.includes("service_role") && !acl.includes("PUBLIC") && !acl.includes("anon") && !acl.includes("authenticated")) {
      ok(`${rpcName}: EXECUTE только у service_role`);
    } else {
      warn(`${rpcName}: EXECUTE шире service_role — примените 0037 (шаг 5)`, acl);
    }
  }

  console.log(`\n${critical === 0 ? "✅ ИТОГ: критических находок нет" : `❌ ИТОГ: критических находок — ${critical}`}`);
  await client.end();
  process.exit(critical === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verify-money-path failed:", err.message);
  process.exit(1);
});
