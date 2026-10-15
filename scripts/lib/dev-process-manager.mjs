#!/usr/bin/env node
/**
 * dev-process-manager.mjs — MANAGED process lifecycle для dev-стека (TZ v4.0 §7, DEV-04).
 *
 * Дефект, который закрывает модуль: scripts/ensure-dev.sh стартовал chat-server
 * ТОЛЬКО если TCP-порт 3030 свободен. Переживший регенерацию .env.local процесс
 * со СТАРЫМ JWT_SECRET молча оставался жить (health 200, handshake —
 * "auth: unauthorized"). Аналогично next dev грузит .env.local один раз на старте.
 *
 * Принципы:
 *  1. OWNERSHIP: убиваем ТОЛЬКО процессы, записанные в state-файле менеджера.
 *     Никаких kill по имени/голому порту. Чужие (unmanaged) процессы — только
 *     диагностика и actionable-подсказка, НЕ рестарт.
 *  2. НЕ-СЕКРЕТНЫЕ отпечатки: fingerprint = sha256(secret).slice(0,12).
 *     Значения секретов НИКОГДА не логируются, не хранятся и не печатаются —
 *     только отпечатки, булевы "присутствует", PID'ы, порты.
 *  3. env extraction: /proc/<pid>/environ (NUL-separated, same-user readable).
 *  4. ensureNext для unmanaged-процесса использует ФУНКЦИОНАЛЬНЫЙ probe:
 *     JWT нельзя прочитать из /proc у процесса, загрузившего dotenv, поэтому
 *     совпадение секрета доказывается поведенчески (см. probeNextAlignment).
 *
 * CLI:
 *   node scripts/lib/dev-process-manager.mjs ensure-chat --port 3030 [--cwd DIR]
 *        [--log FILE] [--state FILE]
 *   node scripts/lib/dev-process-manager.mjs ensure-next --port 3000
 *        [--env-local FILE] [--start-cmd CMD] [--cwd DIR] [--log FILE]
 *        [--state FILE] [--probe-path PATH]
 *   node scripts/lib/dev-process-manager.mjs status [--state FILE]
 *
 * Секреты передаются менеджеру ЧЕРЕЗ ОКРУЖЕНИЕ (JWT_SECRET/BOT_SECRET) —
 * их сорсит ensure-dev.sh из .env.local. В argv секреты передавать нельзя.
 *
 * Exit codes: 0 = ok (started / ok-managed / ok-unmanaged-aligned / restarted),
 *             2 = desync/error (stderr содержит actionable-сообщение).
 */
import { spawn, execSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ============================================================
// Утилиты без секретов
// ============================================================

/** Несекретный отпечаток секрета: первые 12 hex-символов sha256. */
function fingerprint(secret) {
  if (!secret) return "absent";
  return createHash("sha256").update(String(secret), "utf8").digest("hex").slice(0, 12);
}

/** sha256 контента файла (для сравнения .env.local между рестартами). */
function fileHash(filePath) {
  if (!fs.existsSync(filePath)) return "absent";
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").slice(0, 12);
}

function isPidAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return fs.existsSync(`/proc/${Number(pid)}`);
  } catch {
    return false;
  }
}

/** Жива ли process group (kill(-pgid, 0)). */
function isGroupAlive(pgid) {
  try {
    process.kill(Number(pgid) * -1, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function killGroup(pgid, signal) {
  try {
    process.kill(Number(pgid) * -1, signal);
    return true;
  } catch {
    return false;
  }
}

function cmdline(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ");
  } catch {
    return "";
  }
}

function procCwd(pid) {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return "";
  }
}

/**
 * /proc/<pid>/environ → объект. ЗНАЧЕНИЯ секретов не логируются нигде.
 * Возвращаемое значение — только для внутренней проверки отпечатка.
 */
function readEnviron(pid) {
  const env = {};
  let raw;
  try {
    raw = fs.readFileSync(`/proc/${pid}/environ`);
  } catch {
    return null; // unreadable (rightly or wrongly)
  }
  for (const pair of raw.toString("utf8").split("\0")) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    env[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return env;
}

/** Сигнатура chat-server процесса: bun + cwd = mini-services/chat-server. */
function matchesChatProcess(pid, expectedCwd) {
  if (!isPidAlive(pid)) return false;
  const cl = cmdline(pid);
  const cwd = procCwd(pid);
  return (
    cl.includes("bun") &&
    (cl.includes("index.ts") || cl.includes("run dev") || cl.includes("--hot")) &&
    path.resolve(cwd || "") === path.resolve(expectedCwd)
  );
}

/** Сигнатура next dev процесса: next / dev:local + cwd проекта. */
function matchesNextProcess(pid, expectedCwd) {
  if (!isPidAlive(pid)) return false;
  const cl = cmdline(pid);
  const cwd = procCwd(pid);
  return (
    (cl.includes("next") || cl.includes("dev:local")) &&
    path.resolve(cwd || "") === path.resolve(expectedCwd)
  );
}

/** PID процесса-слушателя порта: ss -ltnp (предпочтительно), fallback /proc/net/tcp. */
function findListenerPid(port) {
  // 1) ss
  try {
    const out = execSync(`ss -ltnp 2>/dev/null`, { encoding: "utf8", shell: "/bin/bash" });
    for (const line of out.split("\n")) {
      if (!line.includes("LISTEN")) continue;
      // local address column: 0.0.0.0:3000 / *:3030 / [::]:3000
      if (!new RegExp(`:${port}\\s`).test(line)) continue;
      const pids = [...line.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
      if (pids.length > 0) return pids[0];
    }
  } catch {
    /* fallback ниже */
  }
  // 2) /proc/net/tcp(6): inode слушающего сокета → скан /proc/*/fd
  try {
    const inodes = [];
    for (const f of ["/proc/net/tcp", "/proc/net/tcp6"]) {
      let text;
      try {
        text = fs.readFileSync(f, "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n").slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 10) continue;
        if (cols[3] !== "0A") continue; // LISTEN
        const localPort = parseInt(cols[1].split(":")[1], 16);
        if (localPort === port) inodes.push(cols[9]);
      }
    }
    if (inodes.length === 0) return null;
    for (const dir of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(dir)) continue;
      const fdDir = `/proc/${dir}/fd`;
      let fds;
      try {
        fds = fs.readdirSync(fdDir);
      } catch {
        continue;
      }
      for (const fd of fds) {
        let link;
        try {
          link = fs.readlinkSync(`${fdDir}/${fd}`);
        } catch {
          continue;
        }
        if (inodes.some((ino) => link === `socket:[${ino}]`)) return Number(dir);
      }
    }
  } catch {
    /* no fallback result */
  }
  return null;
}

// ============================================================
// State file
// ============================================================

function readState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(path.resolve(statePath)), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
}

// ============================================================
// Spawn / health / port release
// ============================================================

function openAppend(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  return fs.openSync(file, "a");
}

/** Detached spawn (new session ⇒ pgid = pid). Не наследует наш stdin. */
function spawnDetached(cmd, args, { cwd, env, logFile }) {
  const out = openAppend(logFile);
  const child = spawn(cmd, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  try {
    fs.closeSync(out);
  } catch {
    /* ignore */
  }
  return child.pid;
}

async function fetchStatus(url, timeoutMs = 4000, init = {}) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    return res.status;
  } catch {
    return null;
  }
}

/** Ждём HTTP 200 от http://127.0.0.1:<port><probePath>. */
async function waitHealth(port, probePath, timeoutMs) {
  const url = `http://127.0.0.1:${port}${probePath}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await fetchStatus(url, 4000);
    if (status === 200) return true;
    await sleep(500);
  }
  return false;
}

function portBusy(port) {
  try {
    execSync(
      `(echo > /dev/tcp/127.0.0.1/${port}) 2>/dev/null`,
      { shell: "/bin/bash", stdio: "ignore", timeout: 3000 }
    );
    return true;
  } catch {
    return false;
  }
}

/** Ждём освобождения порта (после SIGTERM группы). */
async function waitPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!portBusy(port)) return true;
    await sleep(300);
  }
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** process group id процесса (поле pgrp /proc/<pid>/stat). */
function getPgid(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2);
    const tokens = afterComm.split(" ");
    return Number(tokens[2]); // state, ppid, pgrp
  } catch {
    return null;
  }
}

// ============================================================
// ensureChat
// ============================================================

/**
 * Управляемый lifecycle chat-server.
 * Возвращает {action, ...}; action ∈ started | ok-managed | restarted |
 * ok-unmanaged-aligned. При desync — exit 2 c actionable-сообщением.
 */
async function ensureChat({ port, jwtSecret, botSecret, cwd, logFile, statePath }) {
  if (!jwtSecret) {
    fail(2, "ensure-chat: JWT_SECRET не передан в окружение менеджера — ensure-dev.sh должен source'ить .env.local перед вызовом");
  }
  const fp = fingerprint(jwtSecret);
  const state = readState(statePath);

  if (!portBusy(port)) {
    // (1) Порт свободен → управляемый старт
    const pid = spawnDetached("bun", ["run", "dev"], {
      cwd,
      env: { ...process.env, JWT_SECRET: jwtSecret, BOT_SECRET: botSecret || "", CHAT_PORT: String(port) },
      logFile,
    });
    const ok = await waitHealth(port, "/health", 30_000);
    if (!ok) {
      fail(2, `ensure-chat: chat-server (PID ${pid}) поднялся, но /health не ответил 200 за 30s — смотри ${logFile}`);
    }
    state.chat = { pgid: pid, pid, fingerprint: fp, startedAt: new Date().toISOString(), cmd: "bun run dev" };
    writeState(statePath, state);
    return { action: "started", pid, fingerprint: fp };
  }

  // Порт занят: managed? Managed = слушатель порта принадлежит НАШЕЙ записанной группе.
  const chat = state.chat;
  const listenerForManaged = findListenerPid(port);
  const managedOwned =
    chat?.pgid &&
    isGroupAlive(chat.pgid) &&
    matchesChatProcess(chat.pgid, cwd) &&
    listenerForManaged &&
    getPgid(listenerForManaged) === getPgid(chat.pgid);
  if (managedOwned) {
    // (2a) MANAGED
    if (chat.fingerprint === fp) {
      return { action: "ok-managed", pid: chat.pid, fingerprint: fp };
    }
    // (2b) fingerprint разошёлся → безопасный рестарт СОБСТВЕННОЙ группы
    const oldPid = chat.pid;
    logLine(logFile, `chat-server restarted: env fingerprint changed (${chat.fingerprint} -> ${fp})`);
    killGroup(chat.pgid, "SIGTERM");
    const freed = await waitPortFree(port, 10_000);
    if (!freed) {
      killGroup(chat.pgid, "SIGKILL");
      await waitPortFree(port, 5_000);
    }
    if (portBusy(port)) {
      fail(2, `ensure-chat: после рестарта порт ${port} не освободился (старая группа pgid ${chat.pgid}) — проверь вручную: ss -ltnp | grep ${port}`);
    }
    const pid = spawnDetached("bun", ["run", "dev"], {
      cwd,
      env: { ...process.env, JWT_SECRET: jwtSecret, BOT_SECRET: botSecret || "", CHAT_PORT: String(port) },
      logFile,
    });
    const ok = await waitHealth(port, "/health", 30_000);
    if (!ok) {
      fail(2, `ensure-chat: chat-server (PID ${pid}) не ответил /health 200 за 30s после рестарта — смотри ${logFile}`);
    }
    state.chat = { pgid: pid, pid, fingerprint: fp, startedAt: new Date().toISOString(), cmd: "bun run dev" };
    writeState(statePath, state);
    return { action: "restarted", oldPid, newPid: pid, fingerprint: fp };
  }

  // (3) Порт занят НЕуправляемым процессом — только диагностика, НЕ рестарт
  const listener = findListenerPid(port);
  if (!listener) {
    fail(2, `DESYNC: порт ${port} занят, но процесс-слушатель не идентифицирован. Проверь: ss -ltnp | grep ${port}`);
  }
  const env = readEnviron(listener);
  const listenerFp = env && env.JWT_SECRET ? fingerprint(env.JWT_SECRET) : "unreadable";
  const aligned =
    env && env.JWT_SECRET && listenerFp === fp && matchesChatProcess(listener, cwd);

  if (aligned) {
    // Чужой (не наш state) процесс, но env совпадает и это точно chat-server — безопасно продолжить
    return { action: "ok-unmanaged-aligned", pid: listener, fingerprint: fp };
  }

  fail(
    2,
    `DESYNC: port ${port} held by unmanaged PID ${listener} with different/unreadable env. ` +
      `Verify it is yours, then: kill ${listener} — or run: kill ${listener} && node scripts/lib/dev-process-manager.mjs ensure-chat --port ${port}`
  );
}

// ============================================================
// ensureNext
// ============================================================

/**
 * HS256 JWT подпись node:crypto (probe для unmanaged next dev).
 * payload: {sub:"probe-env-sync", userId:"probe-env-sync", iat, exp:+60s}
 */
function signProbeJwt(secret, { garbage = false } = {}) {
  const b64url = (buf) => Buffer.from(buf).toString("base64url");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payloadObj = garbage
    ? { sub: "probe-env-sync-garbage", userId: "probe-env-sync-garbage", iat: now, exp: now + 60 }
    : { sub: "probe-env-sync", userId: "probe-env-sync", iat: now, exp: now + 60 };
  const payload = b64url(JSON.stringify(payloadObj));
  const signingInput = `${header}.${payload}`;
  const hmac = createHmac("sha256", String(secret)).update(signingInput).digest();
  return `${signingInput}.${b64url(hmac)}`;
}

/**
 * Функциональный probe совпадения JWT-секрета у РАБОТАЮЩЕГО next dev.
 * GET /api/profile (jwt-protected, verifyAccessToken → 401 на плохую подпись):
 *   garbage token → ждём 401 (эндпоинт реально валидирует подпись);
 *   токен с ТЕКУЩИМ секретом → НЕ 401 (200/403/404/500 = подпись принята).
 */
async function probeNextAlignment(port, probePath, jwtSecret) {
  const base = `http://127.0.0.1:${port}`;
  const garbageStatus = await fetchStatus(`${base}${probePath}`, 8000, {
    headers: { Authorization: `Bearer ${signProbeJwt(randomBytes(32).toString("hex"), { garbage: true })}` },
  });
  if (garbageStatus !== 401) {
    return { aligned: false, reason: `probe endpoint не валидирует JWT (garbage token → ${garbageStatus ?? "нет ответа"}, ожидался 401) — выбери другой probe-path` };
  }
  const currentStatus = await fetchStatus(`${base}${probePath}`, 8000, {
    headers: { Authorization: `Bearer ${signProbeJwt(jwtSecret)}` },
  });
  if (currentStatus === 401) {
    return { aligned: false, reason: "токен с текущим секретом отклонён (401) — running process загрузил ДРУГОЙ секрет" };
  }
  return { aligned: true, currentStatus };
}

async function ensureNext({ port, envLocalPath, startCmd, cwd, logFile, statePath, probePath }) {
  const hash = fileHash(envLocalPath);
  const state = readState(statePath);

  if (!portBusy(port)) {
    // (1) Порт свободен → управляемый старт
    const [cmd, ...args] = startCmd.split(/\s+/);
    const pid = spawnDetached(cmd, args, { cwd, env: process.env, logFile });
    const ok = await waitHealth(port, "/api/health", 120_000);
    if (!ok) {
      fail(2, `ensure-next: next dev (PID ${pid}) не поднял /api/health за 120s — смотри ${logFile}`);
    }
    state.next = { pid, envLocalHash: hash, startedAt: new Date().toISOString(), cmd: startCmd };
    writeState(statePath, state);
    return { action: "started", pid, envLocalHash: hash };
  }

  const next = state.next;
  const listenerForManaged = findListenerPid(port);
  const managedOwned =
    next?.pid &&
    isPidAlive(next.pid) &&
    matchesNextProcess(next.pid, cwd) &&
    listenerForManaged &&
    getPgid(listenerForManaged) === getPgid(next.pid);
  if (managedOwned) {
    // (2) MANAGED
    if (next.envLocalHash === hash) {
      return { action: "ok-managed", pid: next.pid, envLocalHash: hash };
    }
    // .env.local менялся ПОСЛЕ старта → next держит старые секреты → рестарт
    logLine(logFile, `next dev restarted: .env.local changed since start (${next.envLocalHash} -> ${hash})`);
    killGroup(next.pid, "SIGTERM");
    const freed = await waitPortFree(port, 15_000);
    if (!freed) {
      killGroup(next.pid, "SIGKILL");
      await waitPortFree(port, 10_000);
    }
    if (portBusy(port)) {
      fail(2, `ensure-next: порт ${port} не освободился после рестарта (старый PID ${next.pid}) — проверь: ss -ltnp | grep ${port}`);
    }
    const [cmd, ...args] = startCmd.split(/\s+/);
    const pid = spawnDetached(cmd, args, { cwd, env: process.env, logFile });
    const ok = await waitHealth(port, "/api/health", 120_000);
    if (!ok) {
      fail(2, `ensure-next: next dev (PID ${pid}) не поднял /api/health за 120s после рестарта — смотри ${logFile}`);
    }
    state.next = { pid, envLocalHash: hash, startedAt: new Date().toISOString(), cmd: startCmd };
    writeState(statePath, state);
    return { action: "restarted", oldPid: next.pid, newPid: pid, envLocalHash: hash };
  }

  // (3) UNMANAGED next dev — функциональный probe
  const listener = findListenerPid(port);
  if (!listener) {
    fail(2, `DESYNC: порт ${port} занят, но процесс-слушатель не идентифицирован. Проверь: ss -ltnp | grep ${port}`);
  }
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    fail(2, `DESYNC: порт ${port} занят unmanaged PID ${listener}, а JWT_SECRET недоступен менеджеру для probe — ensure-dev.sh должен source'ить .env.local`);
  }
  const probe = await probeNextAlignment(port, probePath, jwtSecret);
  if (probe.aligned) {
    // Не усыновляем в state и не убиваем — просто подтверждаем функциональную синхронность
    return { action: "ok-unmanaged-aligned-probe", pid: listener, probeStatus: probe.currentStatus };
  }
  fail(
    2,
    `DESYNC: port ${port} held by unmanaged PID ${listener} with different/unreadable env (${probe.reason}). ` +
      `Verify it is yours, then: kill ${listener} — or run: kill ${listener} && node scripts/lib/dev-process-manager.mjs ensure-next --port ${port}`
  );
}

// ============================================================
// CLI plumbing
// ============================================================

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/** Однострочный журнал в logFile (без секретов — только отпечатки/PID). */
function logLine(logFile, line) {
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] [dev-process-manager] ${line}\n`);
  } catch {
    /* ignore */
  }
}

function argValue(args, flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const statePath = path.resolve(argValue(rest, "--state", path.join(ROOT, ".run/ensure-dev.state.json")));

  if (sub === "status") {
    const state = readState(statePath);
    // Печатаем только state (в нём отпечатки/хеши, значений секретов нет по построению)
    process.stdout.write(`state file: ${statePath}\n${JSON.stringify(state, null, 2)}\n`);
    return;
  }

  if (sub === "ensure-chat") {
    const port = Number(argValue(rest, "--port", 3030));
    const cwd = path.resolve(argValue(rest, "--cwd", path.join(ROOT, "mini-services/chat-server")));
    const logFile = path.resolve(argValue(rest, "--log", "/tmp/chat-server.log"));
    const result = await ensureChat({
      port,
      jwtSecret: process.env.JWT_SECRET,
      botSecret: process.env.BOT_SECRET,
      cwd,
      logFile,
      statePath,
    });
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }

  if (sub === "ensure-next") {
    const port = Number(argValue(rest, "--port", 3000));
    const cwd = path.resolve(argValue(rest, "--cwd", ROOT));
    const envLocalPath = path.resolve(argValue(rest, "--env-local", path.join(cwd, ".env.local")));
    const startCmd = argValue(rest, "--start-cmd", "bun run dev:local");
    const logFile = path.resolve(argValue(rest, "--log", path.join(cwd, "dev.log")));
    const probePath = argValue(rest, "--probe-path", "/api/profile");
    const result = await ensureNext({ port, envLocalPath, startCmd, cwd, logFile, statePath, probePath });
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }

  fail(
    2,
    "usage: dev-process-manager.mjs <ensure-chat|ensure-next|status> [--port N] [--state FILE] [--cwd DIR] [--log FILE] [--env-local FILE] [--start-cmd CMD] [--probe-path PATH]"
  );
}

main().catch((e) => fail(2, `dev-process-manager: непредвиденная ошибка: ${e?.message || e}`));
