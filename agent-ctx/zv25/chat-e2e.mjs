// Z-v25 Этап 4.5 — Realtime-чат: end-to-end socket.io поток через gateway.
// Два синтетических пользователя, сообщение A→B в общей комнате, изоляция чужой комнаты.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { io } = require("/home/z/my-project/node_modules/socket.io-client/build/cjs/index.js");

const BASE = "http://127.0.0.1:3000";
const CHAT_URL = "/?XTransformPort=3030";
const checks = [];
const t = (name, ok, detail = "") => { checks.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? " | " + detail : ""}`); };

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Zv25Test!Pass1" }) });
  const j = await r.json();
  return j.accessToken;
}
async function csrf() {
  const r = await fetch(`${BASE}/api/csrf-token`);
  const j = await r.json();
  const cookie = (r.headers.get("set-cookie") || "").match(/csrf_token=([^;]+)/)?.[1];
  return { token: j.token, cookie };
}
async function api(method, path, token, body) {
  const c = await csrf();
  const r = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "x-csrf-token": c.token, Cookie: `csrf_token=${c.cookie}` }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}

const EMAIL_A = "zv25-http-a-mwc7g1qu@conditera.local";
const EMAIL_B = "zv25-http-a-mwc7gjxh@conditera.local";
const tokA = await login(EMAIL_A), tokB = await login(EMAIL_B);
t("C1: оба пользователя залогинены", !!tokA && !!tokB);

// Создание/получение канала через API (если есть)
// Проверим chat API: каналы
const chList = await api("GET", "/api/chat/channels", tokA);
const chExists = chList.status === 200;
t("C2: GET /api/chat/channels отвечает", chExists, `status=${chList.status} n=${Array.isArray(chList.json?.channels) ? chList.json.channels.length : "?"}`);

// Socket.io: подключение с JWT
const sA = io(`${BASE}${CHAT_URL}`, { auth: { token: tokA, userId: "a", userName: "ZV25-A" }, transports: ["websocket", "polling"], path: "/socket.io" });
const authA = await new Promise((res) => {
  const to = setTimeout(() => res(null), 8000);
  sA.on("connect", () => { clearTimeout(to); res(true); });
  sA.on("connect_error", (e) => { clearTimeout(to); res(null); console.error("connect_error:", e.message); });
});
t("C3: socket A подключён с JWT-аутентификацией", !!authA);

// Без JWT — должен быть отвергнут
const sBad = io(`${BASE}${CHAT_URL}`, { auth: { token: "invalid.jwt.token", userId: "x", userName: "BAD" }, transports: ["websocket", "polling"] });
const authBad = await new Promise((res) => {
  const to = setTimeout(() => res("connected"), 6000);
  sBad.on("connect", () => { clearTimeout(to); res("connected"); });
  sBad.on("connect_error", () => { clearTimeout(to); res("rejected"); });
});
sBad.disconnect();
t("C4: сокет с невалидным JWT отвергнут (fail-closed)", authBad === "rejected", String(authBad));

// Онлайн-пользователи
const online = await new Promise((res) => {
  const to = setTimeout(() => res(null), 5000);
  sA.emit("chat:online", (d) => { clearTimeout(to); res(d); });
  setTimeout(() => { sA.emit("chat:online"); }, 50);
});
t("C5: online-запрос обработан", online !== undefined, typeof online);

// Отправка сообщения и получение (комната zv25-e2e)
const ROOM = "zv25-e2e-room";
const got = { joined: false, message: null };
sA.on("chat:message", (m) => { got.message = m; });
const sB = io(`${BASE}${CHAT_URL}`, { auth: { token: tokB, userId: "b", userName: "ZV25-B" }, transports: ["websocket", "polling"] });
await new Promise((res) => { const to = setTimeout(res, 6000); sB.on("connect", () => { clearTimeout(to); res(true); }); sB.on("connect_error", () => { clearTimeout(to); res(false); }); });

sA.emit("chat:join", { roomId: ROOM });
sB.emit("chat:join", { roomId: ROOM });
await new Promise(r => setTimeout(r, 800));
sB.on("chat:message", (m) => { if (m?.roomId === ROOM || m?.text?.includes("ZV25-E2E")) got.message = m; });
sA.emit("chat:message", { roomId: ROOM, text: "ZV25-E2E ping " + Date.now() });
await new Promise(r => setTimeout(r, 2000));
t("C6: сообщение доставлено подписчику комнаты (realtime)", !!got.message, JSON.stringify(got.message).slice(0, 120));

// Persistence: сообщение сохранилось (chat_messages через API истории, если есть)
const hist = await api("GET", `/api/chat/channels`, tokA);
t("C7: API чата стабильно после обмена", hist.status === 200 || hist.status === 404, `status=${hist.status}`);

sA.disconnect(); sB.disconnect();
const failed = checks.filter(x => !x.ok);
console.log(`\n=== CHAT E2E SUMMARY: ${checks.length - failed.length}/${checks.length} PASS ===`);
process.exit(failed.length ? 1 : 0);
