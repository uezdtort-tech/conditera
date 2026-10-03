#!/usr/bin/env node
/**
 * scripts/db/runtime.mjs — управление встроенным (embedded) PostgreSQL.
 *
 * Цель: ЛОКАЛЬНЫЙ PostgreSQL без Docker и без отдельных сервисов.
 * Бинарники берутся из пакета @embedded-postgres/<platform> (devDependency),
 * данные живут в <project>/.pgdata, сервер стартует как демон (`pg_ctl -w start`),
 * поэтому переживает завершение скрипта. Работает на Windows/macOS/Linux
 * (bun не нужен — plain Node, child_process с shell:false).
 *
 * Команды (CLI-аргумент):
 *   node scripts/db/runtime.mjs start    — инициализировать (если нужно) и запустить
 *   node scripts/db/runtime.mjs stop     — остановить (pg_ctl -m fast + fallback)
 *   node scripts/db/runtime.mjs restart  — stop + start
 *   node scripts/db/runtime.mjs status   — pid-файл + TCP-проверка
 *   node scripts/db/runtime.mjs logs     — хвост .pgdata/server.log
 *
 * Порт по умолчанию: 54329 (специально НЕ 5432, чтобы не конфликтовать
 * с пользовательским PostgreSQL). Переопределяется CONDITERA_PG_PORT.
 *
 * ВАЖНО: команды управляют ТОЛЬКО встроенным экземпляром. Если DATABASE_URL
 * указывает на другой сервер — выводится предупреждение, но embedded
 * всё равно стартует/останавливается.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, openSync, readSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

// ============================================================================
// Пути и константы
// ============================================================================
// <project>/scripts/db/runtime.mjs → <project> (require.resolve — работает
// и на Windows с буквами дисков, в отличие от fileURLToPath(import.meta.url))
const ROOT = path.resolve(path.dirname(require.resolve("./runtime.mjs")), "..", "..");
export const PGDATA = path.join(ROOT, ".pgdata");
export const PG_PORT = Number(process.env.CONDITERA_PG_PORT || 54329);
export const PG_USER = "postgres";
export const PG_DB = "conditera";
export const EMBEDDED_URL = `postgresql://${PG_USER}@127.0.0.1:${PG_PORT}/${PG_DB}`;
const PG_LOG = path.join(PGDATA, "server.log");
const CONF_MARKER = "# conditera-local";

// ============================================================================
// Резолв бинарников платформенного пакета @embedded-postgres/<pkg>
// ============================================================================
function platformPackageShort() {
  const { platform, arch } = process;
  if (platform === "win32") return "win-x64";
  if (platform === "darwin") {
    if (arch === "arm64") return "darwin-arm64";
    if (arch === "x64") return "darwin-x64";
  }
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  return null;
}

function exeName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

/**
 * Найти нативные бинарники PostgreSQL.
 * Возвращаем реальные пути (НЕ через JS-daemon API embedded-postgres — его
 * дочерний процесс умирает вместе с родителем; мы используем initdb + pg_ctl).
 */
export function resolveBinaries() {
  const short = platformPackageShort();
  if (!short) {
    throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);
  }
  const pkg = `@embedded-postgres/${short}`;
  // Пакет экспортирует только "./dist/index.js" (exports-поле), поэтому
  // package.json резолвим прямым путём — node_modules/@embedded-postgres/<pkg>
  const pkgDir = path.join(ROOT, "node_modules", "@embedded-postgres", short);
  if (!existsSync(path.join(pkgDir, "package.json"))) {
    throw new Error(
      `Package ${pkg} is not installed.\n` +
        `Hint: run "npm install" (embedded-postgres is a devDependency of this project).`
    );
  }
  const binDir = path.join(pkgDir, "native", "bin");
  const wanted = {
    initdb: path.join(binDir, exeName("initdb")),
    pg_ctl: path.join(binDir, exeName("pg_ctl")),
    postgres: path.join(binDir, exeName("postgres")),
  };
  for (const [k, p] of Object.entries(wanted)) {
    if (!existsSync(p)) {
      throw new Error(
        `Binary not found: ${p}\n` +
          `Hint: the postinstall of "${pkg}" may not have run. Try "npm install" or\n` +
          `"npm rebuild ${pkg}". (bun users: bun pm trust ${pkg})`
      );
    }
  }
  return { ...wanted, binDir };
}

/** ENV для дочерних процессов: свой bin в PATH (нужен для DLL/so-поиска). */
function childEnv(binDir) {
  const sep = process.platform === "win32" ? ";" : ":";
  const pathVar = process.platform === "win32" ? "Path" : "PATH";
  return {
    ...process.env,
    [pathVar]: `${binDir}${sep}${process.env[pathVar] || ""}`,
    // initdb/pg_ctl локализацию не трогаем
    LC_ALL: "",
    LANG: "",
  };
}

// ============================================================================
// Вспомогательные
// ============================================================================
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    ...opts,
  });
  return {
    status: res.status,
    stdout: (res.stdout || "").toString(),
    stderr: (res.stderr || "").toString(),
  };
}

async function tcpProbe(port, host = "127.0.0.1", timeoutMs = 1500) {
  return new Promise((resolveProbe) => {
    const socket = net.connect({ port, host });
    const done = (ok) => {
      try { socket.destroy(); } catch { /* noop */ }
      resolveProbe(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function readPidFile() {
  const pidFile = path.join(PGDATA, "postmaster.pid");
  if (!existsSync(pidFile)) return null;
  try {
    const first = readFileSync(pidFile, "utf8").split("\n")[0].trim();
    const pid = Number(first);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Живая проверка статуса: pid-файл + процесс + TCP. */
export async function getStatus() {
  const initialized = existsSync(path.join(PGDATA, "PG_VERSION"));
  if (!initialized) return { running: false, initialized: false, pid: null };
  const pid = readPidFile();
  const procAlive = pid ? pidAlive(pid) : false;
  const tcpOk = await tcpProbe(PG_PORT);
  const running = (procAlive && tcpOk) || (!pid && tcpOk);
  return { running, initialized, pid: running ? pid : null };
}

// ============================================================================
// Конфиги: postgresql.conf (блок с маркером) и pg_hba.conf (trust)
// ============================================================================
function upsertConfigBlock(confPath, blockLines) {
  let text = "";
  if (existsSync(confPath)) text = readFileSync(confPath, "utf8");
  const startIdx = text.indexOf(CONF_MARKER);
  const endIdx = text.lastIndexOf(CONF_MARKER);
  let base = text;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // отрезаем СТАРЫЙ блок (от первого маркера до строки после второго)
    const afterEnd = text.indexOf("\n", endIdx);
    base = afterEnd === -1 ? text.slice(0, startIdx) : text.slice(0, startIdx) + text.slice(afterEnd + 1);
  }
  base = base.replace(/\n*$/, "\n");
  const block = `\n${CONF_MARKER} (managed by scripts/db/runtime.mjs — do not edit below)\n${blockLines.join("\n")}\n${CONF_MARKER}\n`;
  writeFileSync(confPath, base + block, "utf8");
}

function writeHba(hbaPath) {
  // trust ТОЛЬКО на 127.0.0.1 и unix-сокете — дев-режим встроенной БД
  const content = [
    "# conditera-local — managed by scripts/db/runtime.mjs",
    "local   all             all                                     trust",
    "host    all             all             127.0.0.1/32            trust",
    "host    all             all             ::1/128                 trust",
    "",
  ].join("\n");
  writeFileSync(hbaPath, content, "utf8");
}

// ============================================================================
// initdb / старт / стоп
// ============================================================================
function initialize() {
  const { initdb, binDir } = resolveBinaries();
  if (!existsSync(PGDATA)) mkdirSync(PGDATA, { recursive: true });
  const entries = readdirSync(PGDATA);
  if (entries.length > 0) {
    throw new Error(`Data dir ${PGDATA} is not empty but has no PG_VERSION. Remove it manually and retry.`);
  }
  console.log(`» initdb: creating cluster at ${PGDATA}`);
  const res = run(
    initdb,
    ["-D", PGDATA, "-U", PG_USER, "--auth=trust", "--encoding=UTF8", "--no-locale"],
    { env: childEnv(binDir) }
  );
  if (res.status !== 0) {
    throw new Error(`initdb failed:\n${res.stdout}\n${res.stderr}`);
  }
}

function applyConfigs() {
  const { binDir } = resolveBinaries();
  const confLines = [
    `listen_addresses = '127.0.0.1'`,
    `port = ${PG_PORT}`,
    `max_connections = 100`,
    `shared_buffers = 128MB`,
  ];
  if (process.platform !== "win32") {
    confLines.push(`unix_socket_directories = '/tmp'`);
  }
  upsertConfigBlock(path.join(PGDATA, "postgresql.conf"), confLines);
  writeHba(path.join(PGDATA, "pg_hba.conf"));
  void binDir;
}

export async function start() {
  const { pg_ctl, binDir } = resolveBinaries();
  const status = await getStatus();
  if (status.running) {
    console.log(`✔ PostgreSQL already running (pid ${status.pid}, port ${PG_PORT})`);
    return { started: false };
  }
  if (!status.initialized) initialize();
  applyConfigs();
  console.log(`» starting PostgreSQL on 127.0.0.1:${PG_PORT} ...`);
  const res = run(
    pg_ctl,
    ["-D", PGDATA, "-l", PG_LOG, "-o", `-p ${PG_PORT}`, "-w", "start"],
    { env: childEnv(binDir), timeout: 120000 }
  );
  if (res.status !== 0) {
    const logTail = existsSync(PG_LOG) ? readFileSync(PG_LOG, "utf8").slice(-2000) : "";
    throw new Error(`pg_ctl start failed:\n${res.stdout}\n${res.stderr}\n--- server.log tail ---\n${logTail}`);
  }
  // Ждём TCP (pg_ctl -w уже должен гарантировать, но проверим сами)
  let up = false;
  for (let i = 0; i < 40; i++) {
    up = await tcpProbe(PG_PORT);
    if (up) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) throw new Error("PostgreSQL started but port is not accepting connections");
  console.log(`✔ PostgreSQL is running (port ${PG_PORT}, data: ${PGDATA})`);
  return { started: true };
}

export async function stop() {
  const { pg_ctl, binDir } = resolveBinaries();
  if (!existsSync(path.join(PGDATA, "PG_VERSION"))) {
    console.log("PostgreSQL: not initialized (nothing to stop)");
    return { stopped: false };
  }
  const res = run(pg_ctl, ["-D", PGDATA, "-m", "fast", "-w", "stop"], {
    env: childEnv(binDir),
    timeout: 60000,
  });
  if (res.status !== 0) {
    // fallback: pid из postmaster.pid
    const pid = readPidFile();
    if (pid && pidAlive(pid)) {
      console.log(`» pg_ctl failed; sending SIGTERM to pid ${pid}`);
      try { process.kill(pid, "SIGTERM"); } catch { /* noop */ }
      for (let i = 0; i < 20 && pidAlive(pid); i++) {
        await new Promise((r) => setTimeout(r, 250));
      }
      if (pidAlive(pid)) {
        try { process.kill(pid, "SIGKILL"); } catch { /* noop */ }
      }
    }
  }
  console.log("✔ PostgreSQL stopped");
  return { stopped: true };
}

// ============================================================================
// Создание базы conditera (через pg-пакет, к базе postgres)
// ============================================================================
export async function ensureDatabase(dbUrl = EMBEDDED_URL) {
  const { Client } = require("pg");
  const url = new URL(dbUrl);
  const adminUrl = `${url.protocol}//${url.username}${url.password ? ":" + url.password : ""}@${url.hostname}:${url.port || "5432"}/postgres`;
  const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 8000 });
  await client.connect();
  try {
    const exists = await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [PG_DB]);
    if (exists.rowCount === 0) {
      console.log(`» creating database "${PG_DB}"`);
      // CREATE DATABASE не идёт в транзакции — обычный query ок
      await client.query(`CREATE DATABASE "${PG_DB}" OWNER "${PG_USER}"`);
    } else {
      console.log(`✔ database "${PG_DB}" exists`);
    }
  } finally {
    await client.end();
  }
}

// ============================================================================
// CLI
// ============================================================================
async function cmdStart() {
  printForeignDatabaseUrlNote();
  await start();
  await ensureDatabase();
}

async function cmdStop() {
  printForeignDatabaseUrlNote();
  await stop();
}

async function cmdStatus() {
  const s = await getStatus();
  if (s.running) {
    console.log(`PostgreSQL: RUNNING (pid ${s.pid}, port ${PG_PORT}, data: ${PGDATA})`);
  } else if (s.initialized) {
    console.log(`PostgreSQL: STOPPED (cluster exists at ${PGDATA}, port ${PG_PORT})`);
  } else {
    console.log(`PostgreSQL: NOT INITIALIZED (no cluster at ${PGDATA})`);
  }
}

async function cmdLogs() {
  if (!existsSync(PG_LOG)) {
    console.log(`(no log file at ${PG_LOG})`);
    return;
  }
  const stat = statSync(PG_LOG);
  const size = Math.min(stat.size, 16 * 1024);
  const fd = openSync(PG_LOG, "r");
  const buf = Buffer.alloc(size);
  readSync(fd, buf, 0, size, stat.size - size);
  const text = buf.toString("utf8");
  const lines = text.split("\n");
  console.log(lines.slice(-80).join("\n"));
}

function printForeignDatabaseUrlNote() {
  const envUrl = process.env.DATABASE_URL;
  if (envUrl && !envUrl.includes(`:${PG_PORT}`) && /^postgres(ql)?:\/\//.test(envUrl)) {
    console.log(
      `! NOTE: DATABASE_URL points to another server (${maskUrl(envUrl)}).\n` +
        `! These commands manage ONLY the embedded instance at ${EMBEDDED_URL}.`
    );
  }
}

function maskUrl(u) {
  return u.replace(/:\/\/([^:@/]+):[^@/]+@/, "://$1:***@");
}

async function main() {
  const command = (process.argv[2] || "").toLowerCase();
  try {
    switch (command) {
      case "start": return await cmdStart();
      case "stop": return await cmdStop();
      case "restart": return await cmdStop(), await cmdStart();
      case "status": return await cmdStatus();
      case "logs": return await cmdLogs();
      default:
        console.log("Usage: node scripts/db/runtime.mjs <start|stop|restart|status|logs>");
        process.exitCode = command ? 1 : 0;
    }
  } catch (err) {
    console.error(`✖ ${err.message || err}`);
    process.exitCode = 1;
  }
}

// main-гвард: выполняем только при прямом запуске (импорт из setup.mjs — нет)
const isMain = (() => {
  try {
    const arg = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
    return import.meta.url.replace(/\/{2,}/g, "/").toLowerCase() === arg.replace(/\/{2,}/g, "/").toLowerCase();
  } catch {
    return false;
  }
})();

if (isMain) {
  main();
}
