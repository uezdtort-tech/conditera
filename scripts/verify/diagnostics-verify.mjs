#!/usr/bin/env node
/**
 * scripts/verify/diagnostics-verify.mjs — E2E-проверка централизованной
 * регистрации ошибок и реестра инцидентов (DEPLOY-01 §13.A/§13.B).
 *
 * Требует: живой dev-сервер на :3000 + PostgreSQL (DATABASE_URL/PGURL).
 * Проверки:
 *   1. Клиентская ошибка доходит до БД (ingest → app_error_events).
 *   2. Инцидент создаётся с тем же fingerprint (§4 объединение).
 *   3. Повторы агрегируются (occurrence_count растёт).
 *   4. Секреты в payload маскируются (в БД нет сырого токена).
 *   5. Стек от клиента НЕ сохраняется.
 *   6. Rate limit срабатывает (429 при всплеске).
 *   7. Доступ к админ-API без токена → 401 (серверная авторизация).
 *   8. Недопустимый статус-переход → 400/409.
 *   9. Fingerprint стабилен (два payload с разной динамикой → одна группа).
 *
 * Чистка: удаляет только СВОИ тестовые строки (component=diagnostics-selftest).
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

const BASE = process.env.APP_URL || "http://127.0.0.1:3000";

function loadDbUrl() {
  if (process.env.PGURL) return process.env.PGURL;
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("postgresql://")) return process.env.DATABASE_URL;
  for (const f of [".env.local", ".env"]) {
    if (existsSync(f)) {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^DATABASE_URL=(.+)$/);
        if (m) return m[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return "postgresql://postgres@127.0.0.1:54329/conditera";
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// Уникальный маркер прогона → изолированные fingerprint'ы.
// Z-v19 §3: Date.now().toString(36) + суффикс — чтобы нормализация
// fingerprint'а (нормализует числа ≥4 цифр в <num>) НЕ схлопывала
// разные прогоны в один инцидент (иначе rerun ломает проверку NEW/count=1).
const RUN = `diag-verify-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TOKEN = `super-secret-token-${RUN}-0987654321`;

async function postClientError(payload) {
  const res = await fetch(`${BASE}/api/diagnostics/client-errors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res;
}

async function main() {
  const client = new pg.Client({ connectionString: loadDbUrl() });
  await client.connect();
  console.log(`DB connected; BASE=${BASE}; run=${RUN}`);

  try {
    // ── 1+2+9: клиентская ошибка → событие → инцидент; секрет маскируется
    const msg1 = `selftest unique failure ${RUN} payment 123456789`;
    const r1 = await postClientError({
      message: `auth failed with Bearer ${TOKEN} (${RUN}) user 123456789`,
      route: "/selftest/diagnostics",
      errorCode: "SELFTEST_E1",
      severity: "error",
    });
    check("ingest 202", r1.status === 202, `HTTP ${r1.status}`);
    const body1 = await r1.json().catch(() => ({}));
    const fp = body1.fingerprint || "";

    // flush-окно очереди ~0.3s + upsert
    await new Promise((r) => setTimeout(r, 2500));

    const ev = await client.query(
      `SELECT event_id, message, stack_trace, fingerprint, source, component, metadata
         FROM public.app_error_events WHERE source='client' AND message LIKE $1
         ORDER BY occurred_at DESC LIMIT 1`,
      [`%${RUN}%`]
    );
    check(
      "событие записано в app_error_events",
      ev.rows.length > 0,
      ev.rows.length ? `event=${ev.rows[0].event_id.slice(0, 8)}…` : "нет строк"
    );

    const storedMsg = ev.rows[0]?.message || "";
    check("секрет (Bearer-токен) маскирован в message", !storedMsg.includes(TOKEN));
    check("стек от клиента отсутствует", ev.rows[0]?.stack_trace === null);
    // Z-v19 §3 fix: route client-errors ЖЁСТКО пинует component='frontend'
    // (§3.2: клиент не может подменить компонент). Старая проверка требовала
    // 'diagnostics-selftest' — значение, которое клиентский путь не может
    // дать по построению → проверка была сломана с момента появления.
    check("component зафиксирован сервером (frontend)", ev.rows[0]?.component === "frontend");

    // Инцидент по fingerprint из ingest-ответа
    const inc = await client.query(
      `SELECT id, status, occurrence_count, fingerprint FROM public.app_incidents WHERE fingerprint=$1`,
      [fp]
    );
    check("инцидент создан по fingerprint ingest-ответа", inc.rows.length === 1);
    check("начальный статус NEW, occurrence_count=1", inc.rows[0]?.status === "NEW" && inc.rows[0]?.occurrence_count === 1);

    // ── Повторная ошибка с той же динамикой → та же группа (fingerprint стабилен).
    // Z-v19 §3 fix: повтор отличается ТОЛЬКО динамикой (номер пользователя);
    // прежний вариант менял и само значение токена (other-token-value) —
    // слова не нормализуются → другой fingerprint → проверка не могла пройти.
    const r2 = await postClientError({
      message: `auth failed with Bearer ${TOKEN} (${RUN}) user 987654321`,
      route: "/selftest/diagnostics",
      errorCode: "SELFTEST_E1",
    });
    const body2 = await r2.json().catch(() => ({}));
    check("повторная ошибка → тот же fingerprint (объединение)", body2.fingerprint === fp);
    await new Promise((r) => setTimeout(r, 2000));
    const inc2 = await client.query(
      `SELECT occurrence_count, last_seen_at FROM public.app_incidents WHERE fingerprint=$1`,
      [fp]
    );
    check(
      "occurrence_count растёт (агрегация повторов)",
      inc2.rows[0]?.occurrence_count >= 2,
      `count=${inc2.rows[0]?.occurrence_count}`
    );

    // ── 6: rate limit — 30 быстрых уникальных (разные fingerprint'ы)
    let got429 = false;
    for (let i = 0; i < 30; i++) {
      const res = await postClientError({
        message: `rate-limit probe ${RUN} unique ${i} ${Math.random()}`,
        route: "/selftest/rate",
        errorCode: "SELFTEST_RATE",
      });
      if (res.status === 429) {
        got429 = true;
        break;
      }
    }
    check("rate limit 429 при всплеске (20+ в минуту)", got429);

    // ── 7: серверная авторизация админ-API
    const noAuth = await fetch(`${BASE}/api/admin/diagnostics/incidents`);
    check("GET incidents без токена → 401", noAuth.status === 401, `HTTP ${noAuth.status}`);

    const badRole = await fetch(`${BASE}/api/admin/diagnostics/incidents`, {
      headers: { Authorization: `Bearer not-a-real-token-${RUN}` },
    });
    check("GET incidents с невалидным токеном → 401", badRole.status === 401, `HTTP ${badRole.status}`);

    // ── 8: недопустимый переход (без админ-доступа должен быть 401 до логики)
    const patchNoAuth = await fetch(`${BASE}/api/admin/diagnostics/incidents`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentId: inc.rows[0]?.id, toStatus: "SUPER_HACK" }),
    });
    // Z-v19 §3 fix: без auth middleware возвращает 403 (CSRF) ДО auth-проверки
    // — оба кода означают fail-closed (запрос не доходит до логики перехода).
    check(
      "PATCH без авторизации → 401/403 fail-closed (до валидации статуса)",
      patchNoAuth.status === 401 || patchNoAuth.status === 403,
      `HTTP ${patchNoAuth.status}`
    );

    // ── health endpoints
    const live = await fetch(`${BASE}/api/health/live`);
    const liveBody = await live.json().catch(() => ({}));
    check("/api/health/live → 200 alive", live.status === 200 && liveBody.status === "alive");
    const liveStr = JSON.stringify(liveBody);
    check("liveness не раскрывает окружение", !/env|url|key|supabase/i.test(liveStr));

    const ready = await fetch(`${BASE}/api/health/ready`);
    const readyBody = await ready.json().catch(() => ({}));
    check(
      "/api/health/ready → 200 ready (БД жива)",
      ready.status === 200 && readyBody.database === "ok",
      `HTTP ${ready.status}`
    );
  } finally {
    // ── Чистка: только свои тестовые строки.
    // Z-v19 §3 fix: клиентский путь пинует component='frontend', поэтому
    // фильтр component='diagnostics-selftest' никогда не совпадал и строки
    // тестов накапливались. Фильтруем по source='client' + уникальному
    // маркеру прогона в сообщении.
    const del1 = await client.query(
      `DELETE FROM public.app_error_events WHERE source='client' AND (message LIKE $1 OR message LIKE $2)`,
      [`%${RUN}%`, `%rate-limit probe ${RUN}%`]
    );
    await client.query(
      `DELETE FROM public.app_incidents WHERE title LIKE $1 OR title LIKE $2`,
      [`%${RUN}%`, `%rate-limit probe%${RUN}%`]
    );
    console.log(`cleanup: ${del1.rowCount} events deleted (+related incidents)`);
    await client.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.error("FAILED:", failed.map((f) => f.name).join("; "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("verify failed:", e);
  process.exit(1);
});
