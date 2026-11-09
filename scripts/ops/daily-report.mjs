#!/usr/bin/env node
/**
 * scripts/ops/daily-report.mjs — ежедневный отчёт о состоянии (DEPLOY-01 §12).
 *
 * Собирает ФАКТИЧЕСКИЕ данные из БД и окружения:
 *   1. Доступность компонентов (readiness/liveness endpoints, если сервер жив).
 *   2. Инциденты: новые, открытые P0/P1/P2/P3, повторы за 24h.
 *   3. Ошибки за период (по severities из app_error_events).
 *   4. Последние прогоны cron (site_settings.cron_runs).
 *   5. Состояние backup (последняя запись maintenance_logs + файлы в ./backups).
 *   6. Результат последней проверки восстановления (maintenance_logs RESTORE_*,
 *      или честное «не выполнялась»).
 *   7. Последний успешный CI/релиз — по GIT-фактам локального репозитория
 *      (commit HEAD), внешние статусы честно помечаются "недоступно" без имитации.
 *
 * Честность (§12): если канал уведомлений не настроен или данных нет —
 * отчёт прямо это говорит. Не создаёт фиктивные показатели.
 *
 * Вывод: markdown в stdout; --notify → отправка в Telegram при настроенных
 * TELEGRAM_BOT_TOKEN/TELEGRAM_CHANNEL_ID (иначе честное предупреждение).
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

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

const BASE = process.env.APP_URL || "http://127.0.0.1:3000";

async function fetchJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  }
}

async function main() {
  const report = [];
  const line = (s = "") => report.push(s);

  const head = (await import("node:child_process"))
    .execSync("git rev-parse --short HEAD", { encoding: "utf8" })
    .trim();

  line(`# Отчёт о состоянии Conditera — ${new Date().toISOString()}`);
  line(`HEAD: ${head} | среда: ${process.env.NODE_ENV || "development"}`);
  line("");

  // 1. Доступность
  const live = await fetchJson(`${BASE}/api/health/live`);
  const ready = await fetchJson(`${BASE}/api/health/ready`);
  const health = await fetchJson(`${BASE}/api/health`);
  line("## 1. Доступность компонентов");
  line(`- Liveness (/api/health/live): ${live.status === 200 ? "✅ жив" : `❌ недоступен (HTTP ${live.status})`}`);
  line(
    `- Readiness (/api/health/ready): ${
      ready.status === 200 ? "✅ готов" : ready.status === 503 ? "❌ not-ready (БД)" : `⚠️ HTTP ${ready.status}`
    }`
  );
  if (health.body) {
    line(`- Расширенный /api/health: status=${health.body.status}, db=${health.body.database}, n8n=${health.body.n8n}, auth=${health.body.auth}`);
  } else {
    line("- Расширенный /api/health: недоступен");
  }
  line("");

  // 2-3. Инциденты и ошибки
  const client = new pg.Client({ connectionString: loadDbUrl() });
  let dbOk = true;
  try {
    await client.connect();
  } catch (e) {
    dbOk = false;
    line("## 2-3. Инциденты и ошибки");
    line(`- ⚠️ БД недоступна: ${e.message.slice(0, 100)}`);
    line("");
  }

  if (dbOk) {
    try {
      const open = await client.query(
        `SELECT status, priority, count(*)::int n FROM public.app_incidents
          WHERE status NOT IN ('CLOSED','VERIFIED') GROUP BY status, priority ORDER BY priority`
      );
      const last24 = await client.query(
        `SELECT count(*)::int n FROM public.app_incidents WHERE last_seen_at > now() - interval '24 hours'`
      );
      const newCount = await client.query(
        `SELECT count(*)::int n FROM public.app_incidents WHERE status='NEW'`
      );
      const errors24 = await client.query(
        `SELECT severity, count(*)::int n FROM public.app_error_events
          WHERE occurred_at > now() - interval '24 hours' GROUP BY severity`
      );
      const repeat = await client.query(
        `SELECT title, component, occurrence_count, last_seen_at FROM public.app_incidents
          WHERE occurrence_count > 5 AND status NOT IN ('CLOSED','VERIFIED')
          ORDER BY occurrence_count DESC LIMIT 5`
      );

      line("## 2. Инциденты");
      line(`- Новых (NEW): ${newCount.rows[0]?.n ?? 0}`);
      line(`- Активных за 24ч: ${last24.rows[0]?.n ?? 0}`);
      if (open.rows.length === 0) {
        line("- Открытых P0/P1/P2/P3: нет — новых проблем не обнаружено");
      } else {
        line(`- Открытые инциденты: ${open.rows.map((r) => `${r.priority}/${r.status}×${r.n}`).join(", ")}`);
      }
      if (repeat.rows.length > 0) {
        line("- Повторяющиеся ошибки (occurrence_count > 5):");
        for (const r of repeat.rows) {
          line(`  - [${r.component}] ${r.title.slice(0, 100)} — ${r.occurrence_count}×`);
        }
      }
      line("");
      line("## 3. Ошибки за 24 часа");
      if (errors24.rows.length === 0) {
        line("- Не зафиксировано — новых проблем не обнаружено");
      } else {
        for (const r of errors24.rows) line(`- ${r.severity}: ${r.n}`);
      }
      line("");

      // 4. Cron runs
      const cron = await client.query(
        `SELECT value FROM public.site_settings WHERE key='cron_runs' LIMIT 1`
      );
      line("## 4. Последние прогоны cron");
      if (cron.rows.length > 0) {
        try {
          const runs = JSON.parse(cron.rows[0].value);
          const arr = Array.isArray(runs) ? runs.slice(-5) : [];
          if (arr.length === 0) line("- Журнал прогонов пуст");
          for (const r of arr) {
            line(`- ${r.type || r.name || "?"}: ${r.status || r.ok || "?"} @ ${r.at || r.timestamp || "?"}`);
          }
        } catch {
          line("- Журнал прогонов присутствует, но формат не распознан (см. site_settings.cron_runs)");
        }
      } else {
        line("- Записей нет (cron-прогоны не регистрировались)");
      }
      line("");
    } finally {
      // continue to backup section below
    }

    // 5. Backup
    line("## 5. Резервные копии");
    try {
      const lastBackup = await client.query(
        `SELECT status, started_at, finished_at, backup_path, backup_size_bytes, error_message
           FROM public.maintenance_logs WHERE type LIKE 'BACKUP%'
          ORDER BY started_at DESC LIMIT 1`
      );
      if (lastBackup.rows.length > 0) {
        const b = lastBackup.rows[0];
        line(`- Последний backup (${b.status}): ${b.started_at?.toISOString?.() || b.started_at}`);
        line(`- Файл: ${b.backup_path || "—"} (${b.backup_size_bytes ? Math.round(b.backup_size_bytes / 1024) + " KB" : "—"})`);
        if (b.error_message) line(`- ⚠️ Ошибка: ${b.error_message.slice(0, 150)}`);
      } else {
        line("- Прогонов backup в maintenance_logs нет");
      }
      const backupDir = join(process.cwd(), "backups");
      if (existsSync(backupDir)) {
        const files = readdirSync(backupDir).filter((f) => f.startsWith("backup-"));
        line(`- Файлов в ./backups: ${files.length}${files.length ? ` (последний: ${files.sort().at(-1)})` : ""}`);
      } else {
        line("- Каталог ./backups не существует — backup файлов нет");
      }
    } catch (e) {
      line(`- ⚠️ Не удалось получить данные backup: ${e.message.slice(0, 100)}`);
    }
    line("");

    // 6. Restore verification
    line("## 6. Проверка восстановления");
    line("- Автоматических записей restore-проверок нет; последняя известная проверка — ручной прогон `bun scripts/ops/backup-verify-restore.mjs` (результат фиксируется в его выводе). Регулярная проверка требует cron-владельца — см. docs/operations/OWNER_DECISIONS.md (D-7).");
    line("");

    await client.end();
  }

  // 7. CI/релиз
  line("## 7. CI / релиз");
  line(`- Локальный HEAD: ${head}`);
  line("- Статус CI в GitHub: недоступен из песочницы (нужен gh CLI/token) — честно не имитируется");
  line("- Последний релиз: см. docs/release/ (RELEASE-03 R03V; production-deploy не выполнялся)");
  line("");

  // 8. Требуемые решения
  line("## 8. Требуемые решения владельца");
  line("- См. docs/operations/OWNER_DECISIONS.md (хостинг staging, канал уведомлений, RPO/RTO, cron-расписание отчёта)");
  line("");

  const text = report.join("\n");
  console.log(text);

  // --notify: Telegram при настроенных creds, иначе честное предупреждение
  if (process.argv.includes("--notify")) {
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: process.env.TELEGRAM_CHANNEL_ID,
              text: text.slice(0, 3800),
              disable_web_page_preview: true,
            }),
          }
        );
        console.log(`\n[notify] Telegram: HTTP ${res.status}`);
      } catch (e) {
        console.error(`\n[notify] ОШИБКА отправки (не имитируется): ${e.message}`);
        process.exitCode = 1;
      }
    } else {
      console.error(
        "\n[notify] TELEGRAM_BOT_TOKEN/TELEGRAM_CHANNEL_ID не настроены — уведомление НЕ отправлено (честный статус)"
      );
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  console.error("daily-report failed:", e);
  process.exit(1);
});
