#!/usr/bin/env node
/**
 * verify-process-env-sync.mjs — REGRESSION TEST для TZ v4.0 §7 (DEV-04).
 *
 * Проверяет managed process lifecycle (scripts/lib/dev-process-manager.mjs)
 * на ИЗОЛИРОВАННЫХ тестовых портах (13030/13032/13033; 13031 зарезервирован
 * под next) и изолированном state-файле. Реальные 3000/3030 и реальный
 * .run/ensure-dev.state.json НЕ затрагиваются.
 *
 * Сценарии:
 *  1. ensureChat с секретом A на 13030 → action=started, health 200 (PID_A).
 *  2. ensureChat с секретом B (B_j != A_j) → action=restarted, PID_A мёртв,
 *     новый PID жив, health 200.
 *  3. JWT, подписанный B_j → socket.io handshake УСПЕШЕН.
 *  4. JWT, подписанный A_j (старый секрет) → handshake ОТКЛОНЁН "auth: unauthorized".
 *  5. Unmanaged-aligned: manual chat-server на 13032 (без state) + ensureChat
 *     с тем же секретом → ok-unmanaged-aligned, процесс жив после проверки.
 *  6. Unmanaged-desync: manual chat-server на 13033 с секретом A + ensureChat
 *     с секретом B (без state) → exit 2, actionable stderr с PID, ручной
 *     процесс ОСТАЁТСЯ ЖИВ (менеджер не убивает unmanaged).
 *  7. Гигиена секретов: ни в захвате stdout/stderr менеджера, ни в state-файле,
 *     ни в /tmp-логах теста нет полных значений A_j/B_j/A_b/B_b и их 16-символьных
 *     подстрок; state-файл хранит fingerprints (12 hex), не секреты.
 *  8. Итог: PASS <n>/<n>; exit 0 только если все проверки прошли.
 *
 * Запуск: bun scripts/verify-process-env-sync.mjs   (или node)
 */
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANAGER = path.join(ROOT, "scripts/lib/dev-process-manager.mjs");
const CHAT_CWD = path.join(ROOT, "mini-services/chat-server");

const PORT_MAIN = 13030; // управляемый lifecycle (сценарии 1-4)
const PORT_ALIGNED = 13032; // unmanaged-aligned (сценарий 5)
const PORT_DESYNC = 13033; // unmanaged-desync (сценарий 6)
const STATE = path.join(ROOT, ".run/test-env-sync-state.json");

const LOG_MAIN = "/tmp/conditera-envsync-chat-13030.log";
const LOG_ALIGNED = "/tmp/conditera-envsync-chat-13032.log";
const LOG_DESYNC = "/tmp/conditera-envsync-chat-13033.log";

// ===== Секреты ТОЛЬКО в памяти теста (не печатаются, проверяются подстроками) =====
const A_j = randomBytes(32).toString("hex");
const A_b = randomBytes(32).toString("hex");
const B_j = randomBytes(32).toString("hex");
const B_b = randomBytes(32).toString("hex");
const SECRET_VALUES = [A_j, A_b, B_j, B_b];
// Все 16-символьные подстроки JWT-секретов (скользящее окно) — для шага 7
const SECRET_16_SUBSTRINGS = [A_j, B_j].flatMap((s) =>
  Array.from({ length: s.length - 16 + 1 }, (_, i) => s.slice(i, i + 16))
);

let managerCapture = ""; // весь combined stdout/stderr менеджера (шаг 7)

const results = [];
let failures = 0;
function record(name, ok, detail = "") {
  results.push({ name, ok });
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== helpers =====
function secretEnv(j, b) {
  return { ...process.env, JWT_SECRET: j, BOT_SECRET: b };
}

function pidAlive(pid) {
  try {
    return fs.existsSync(`/proc/${pid}`);
  } catch {
    return false;
  }
}

function pgidAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

function killGroup(pgid, signal = "SIGTERM") {
  try {
    process.kill(-pgid, signal);
  } catch {
    /* уже мертв */
  }
}

async function healthOk(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function waitHealth(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthOk(port)) return true;
    await sleep(400);
  }
  return false;
}

function assertPortFree(port, label) {
  const r = spawnSync("/bin/bash", ["-c", `(echo > /dev/tcp/127.0.0.1/${port}) 2>/dev/null`], { timeout: 3000 });
  if (r.status === 0) {
    throw new Error(`порт ${port} (${label}) занят перед тестом — выбери другой изолированный порт`);
  }
}

/** Вызов менеджера CLI: возвращает {status, stdout, stderr}. Секреты — через env. */
function runManager(args, envSecrets) {
  const r = spawnSync("node", [MANAGER, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...envSecrets },
    timeout: 180_000,
  });
  managerCapture += `[cmd] node scripts/lib/dev-process-manager.mjs ${args.join(" ")}\n[exit] ${r.status}\n[stdout] ${r.stdout || ""}\n[stderr] ${r.stderr || ""}\n`;
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/** Ручной (unmanaged) старт chat-server: detached, свой pgid. */
function manualSpawnChat(port, j, b, logFile) {
  const out = fs.openSync(logFile, "a");
  const child = spawn("bun", ["run", "dev"], {
    cwd: CHAT_CWD,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, JWT_SECRET: j, BOT_SECRET: b, CHAT_PORT: String(port) },
  });
  child.unref();
  try {
    fs.closeSync(out);
  } catch {
    /* ignore */
  }
  return child.pid; // = pgid (detached ⇒ group leader)
}

/** HS256 JWT (как в менеджере): {sub, userId, iat, exp:+60s}. */
function signJwt(secret, userId = "rt-env-sync") {
  const b64url = (buf) => Buffer.from(buf).toString("base64url");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: userId, userId, iat: now, exp: now + 60 }));
  const sig = createHmac("sha256", String(secret)).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${b64url(sig)}`;
}

/** socket.io handshake: resolve {connected:true, socket} | {connected:false, error}. */
function handshake(port, token) {
  return new Promise((resolve) => {
    const socket = io(`http://127.0.0.1:${port}`, {
      path: "/socket.io",
      auth: { token },
      transports: ["polling", "websocket"],
      reconnection: false,
      timeout: 8000,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      resolve({ connected: false, error: "connect timeout" });
    }, 8000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve({ connected: true, socket });
    });
    socket.on("connect_error", (err) => {
      clearTimeout(timer);
      socket.disconnect();
      resolve({ connected: false, error: err?.message || "connect_error" });
    });
  });
}

// ===== test process registry for finally-cleanup =====
const spawnedGroups = []; // {pgid, label}

function cleanup() {
  for (const g of spawnedGroups) {
    killGroup(g.pgid, "SIGTERM");
  }
  // дать SIGTERM сработать, потом добить выживших (синхронная пауза через Atomics.wait)
  const sab = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && spawnedGroups.some((g) => pgidAlive(g.pgid))) {
    Atomics.wait(sab, 0, 0, 300);
  }
  for (const g of spawnedGroups) {
    if (pgidAlive(g.pgid)) killGroup(g.pgid, "SIGKILL");
  }
  for (const f of [STATE, LOG_MAIN, LOG_ALIGNED, LOG_DESYNC]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* ignore */
    }
  }
}

// ============================================================
async function run() {
  // Предусловия: изолированные порты свободны
  assertPortFree(PORT_MAIN, "PORT_MAIN");
  assertPortFree(PORT_ALIGNED, "PORT_ALIGNED");
  assertPortFree(PORT_DESYNC, "PORT_DESYNC");

  // --- Шаг 1: managed start с секретом A ---
  let r = runManager(
    ["ensure-chat", "--port", String(PORT_MAIN), "--cwd", CHAT_CWD, "--log", LOG_MAIN, "--state", STATE],
    secretEnv(A_j, A_b)
  );
  let parsed = {};
  try {
    parsed = JSON.parse(r.stdout.trim().split("\n").pop() || "{}");
  } catch {
    /* parse fail → assertions ниже поймают */
  }
  const pidA = parsed.pid;
  record(
    "1. ensureChat(A) → started",
    r.status === 0 && parsed.action === "started" && typeof pidA === "number",
    `exit=${r.status} action=${parsed.action} pid=${pidA}`
  );
  spawnedGroups.push({ pgid: pidA, label: "managed-13030-A" });
  const h1 = await waitHealth(PORT_MAIN, 30_000);
  record("1a. health 200 после старта (порт 13030)", h1 && pidAlive(pidA), `health=${h1}`);

  // --- Шаг 2: рестарт по смене отпечатка секрета A → B ---
  r = runManager(
    ["ensure-chat", "--port", String(PORT_MAIN), "--cwd", CHAT_CWD, "--log", LOG_MAIN, "--state", STATE],
    secretEnv(B_j, B_b)
  );
  parsed = {};
  try {
    parsed = JSON.parse(r.stdout.trim().split("\n").pop() || "{}");
  } catch {
    /* ignore */
  }
  const pidB = parsed.newPid;
  if (typeof pidB === "number") spawnedGroups.push({ pgid: pidB, label: "managed-13030-B" });
  const restartOk =
    r.status === 0 &&
    parsed.action === "restarted" &&
    typeof pidB === "number" &&
    parsed.oldPid === pidA;
  record(
    "2. ensureChat(B) → restarted (A→B)",
    restartOk,
    `exit=${r.status} action=${parsed.action} old=${parsed.oldPid} new=${pidB}`
  );
  const oldDead = !pidAlive(pidA);
  const newAlive = pidAlive(pidB);
  record("2a. PID_A мёртв, новый PID жив", oldDead && newAlive, `oldDead=${oldDead} newAlive=${newAlive}`);
  const h2 = await waitHealth(PORT_MAIN, 30_000);
  record("2b. health 200 после рестарта", h2, `health=${h2}`);

  // --- Шаг 3: handshake с JWT (B_j) — успех ---
  const hsB = await handshake(PORT_MAIN, signJwt(B_j, "rt-sync-b"));
  record("3. handshake c токеном B_j УСПЕШЕН", hsB.connected, `err=${hsB.error || "none"}`);
  hsB.socket?.disconnect();

  // --- Шаг 4: handshake с JWT (A_j — старый секрет) — отклонён ---
  const hsA = await handshake(PORT_MAIN, signJwt(A_j, "rt-sync-a"));
  record(
    "4. handshake c токеном A_j ОТКЛОНЁН (auth: unauthorized)",
    !hsA.connected && /auth: unauthorized/.test(hsA.error || ""),
    `err=${hsA.error}`
  );

  // --- Шаг 5: unmanaged-aligned на 13032 ---
  const manualAlignedPid = manualSpawnChat(PORT_ALIGNED, A_j, A_b, LOG_ALIGNED);
  spawnedGroups.push({ pgid: manualAlignedPid, label: "manual-13032" });
  const h5 = await waitHealth(PORT_ALIGNED, 30_000);
  if (!h5) throw new Error(`manual chat-server на ${PORT_ALIGNED} не поднялся (см. ${LOG_ALIGNED})`);
  r = runManager(
    ["ensure-chat", "--port", String(PORT_ALIGNED), "--cwd", CHAT_CWD, "--log", LOG_ALIGNED, "--state", STATE],
    secretEnv(A_j, A_b)
  );
  parsed = {};
  try {
    parsed = JSON.parse(r.stdout.trim().split("\n").pop() || "{}");
  } catch {
    /* ignore */
  }
  record(
    "5. ensureChat(A) на unmanaged → ok-unmanaged-aligned",
    r.status === 0 && parsed.action === "ok-unmanaged-aligned" && pidAlive(manualAlignedPid),
    `exit=${r.status} action=${parsed.action} alignedPid=${parsed.pid} manualAlive=${pidAlive(manualAlignedPid)}`
  );
  const h5after = await healthOk(PORT_ALIGNED);
  record("5a. ручной процесс жив и health 200 после проверки", h5after && pidAlive(manualAlignedPid));

  // --- Шаг 6: unmanaged-desync на 13033 ---
  const manualDesyncPid = manualSpawnChat(PORT_DESYNC, A_j, A_b, LOG_DESYNC);
  spawnedGroups.push({ pgid: manualDesyncPid, label: "manual-13033" });
  const h6 = await waitHealth(PORT_DESYNC, 30_000);
  if (!h6) throw new Error(`manual chat-server на ${PORT_DESYNC} не поднялся (см. ${LOG_DESYNC})`);
  r = runManager(
    ["ensure-chat", "--port", String(PORT_DESYNC), "--cwd", CHAT_CWD, "--log", LOG_DESYNC, "--state", STATE],
    secretEnv(B_j, B_b)
  );
  const desyncOk = r.status === 2 && r.stderr.includes("DESYNC") && /PID \d+/.test(r.stderr);
  record(
    "6. ensureChat(B) на unmanaged(A) → exit 2 + actionable stderr",
    desyncOk,
    `exit=${r.status} stderr=${(r.stderr || "").trim().slice(0, 120)}`
  );
  const stillAlive = pidAlive(manualDesyncPid) && (await healthOk(PORT_DESYNC));
  record("6a. ручной процесс НЕ убит менеджером (жив, health 200)", stillAlive);

  // --- Шаг 7: гигиена секретов ---
  const stateContent = fs.existsSync(STATE) ? fs.readFileSync(STATE, "utf8") : "";
  const logsContent = [LOG_MAIN, LOG_ALIGNED, LOG_DESYNC]
    .map((f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""))
    .join("");
  const surfaces = [
    ["manager-output", managerCapture],
    ["state-file", stateContent],
    ["test-logs", logsContent],
  ];
  let leaks = [];
  for (const [name, text] of surfaces) {
    for (const [idx, secret] of SECRET_VALUES.entries()) {
      const tag = `#${idx}`;
      if (text.includes(secret)) leaks.push(`${name} full-value ${tag}`);
      for (const sub of SECRET_16_SUBSTRINGS.filter((s) => secret.includes(s))) {
        if (text.includes(sub)) leaks.push(`${name} 16-char-substring ${tag}`);
      }
    }
  }
  record("7. секреты (значения + 16-char подстроки) отсутствуют во всех захватах", leaks.length === 0, leaks.join("; ").slice(0, 200));

  const fpPattern = /"fingerprint":\s*"[0-9a-f]{12}"/;
  const fpCount = (stateContent.match(fpPattern) || []).length;
  record(
    "7a. state-файл хранит fingerprints (12 hex), не секреты",
    fpCount >= 1 && !/[0-9a-f]{64}/.test(stateContent.replace(fpPattern, "").replace(/"[0-9a-f]{12}"/g, "")),
    `fingerprints=${fpCount}`
  );

  // --- Итог ---
  const total = results.length;
  const passed = total - failures;
  console.log(`\nPASS ${passed}/${total}`);
  if (failures > 0) {
    for (const f of results.filter((x) => !x.ok)) {
      console.error(`FAIL: ${f.name}`);
    }
    return false; // cleanup выполняется в finally наверху
  }
  return true;
}

let ok = false;
try {
  ok = await run();
} catch (e) {
  console.error(`❌ FATAL: ${e?.message || e}`);
  ok = false;
} finally {
  cleanup(); // ВАЖНО: без process.exit() внутри run() — иначе finally не выполнится
}
process.exit(ok ? 0 : 1);
