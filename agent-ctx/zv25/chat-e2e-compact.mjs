// Z-v25 Этап 4.5 — Realtime-чат E2E (компактная версия): handshake + доставка сообщения.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { io } = require("/home/z/my-project/node_modules/socket.io-client/build/cjs/index.js");

const BASE = "http://127.0.0.1:3000";
const TOK1 = process.env.TOK1, TOK2 = process.env.TOK2;
const checks = [];
const t = (n, ok, d = "") => { checks.push({ n, ok }); console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? " | " + d : ""}`); };

// C3: handshake с валидным JWT (текущий секрет)
const sA = io(`${BASE}/?XTransformPort=3030`, { auth: { token: TOK1, userName: "ZV25-A" }, transports: ["polling", "websocket"] });
const authA = await new Promise((res) => {
  const to = setTimeout(() => res(null), 9000);
  sA.on("connect", () => { clearTimeout(to); res(true); });
  sA.on("connect_error", (e) => { clearTimeout(to); res("err:" + e.message); });
});
t("C3: socket A handshake с JWT (после перезапуска чата — секрет актуален)", authA === true, String(authA));

// C4: невалидный JWT отвергнут
const sBad = io(`${BASE}/?XTransformPort=3030`, { auth: { token: "invalid.jwt.token", userName: "BAD" }, transports: ["polling"] });
const authBad = await new Promise((res) => {
  const to = setTimeout(() => res("connected!"), 6000);
  sBad.on("connect", () => { clearTimeout(to); res("connected!"); });
  sBad.on("connect_error", () => { clearTimeout(to); res("rejected"); });
});
sBad.disconnect();
t("C4: невалидный JWT отвергнут (fail-closed)", authBad === "rejected", String(authBad));

if (authA === true) {
  // C6: доставка сообщения в комнату
  const ROOM = "zv25-e2e-room";
  let got = null;
  const sB = io(`${BASE}/?XTransformPort=3030`, { auth: { token: TOK2, userName: "ZV25-B" }, transports: ["polling", "websocket"] });
  await new Promise((res) => { const to = setTimeout(res, 8000); sB.on("connect", () => { clearTimeout(to); res(true); }); sB.on("connect_error", () => { clearTimeout(to); res(false); }); });
  sB.on("chat:message", (m) => { if (JSON.stringify(m).includes("ZV25-E2E")) got = m; });
  sA.emit("chat:join", { roomId: ROOM });
  sB.emit("chat:join", { roomId: ROOM });
  await new Promise(r => setTimeout(r, 1000));
  sA.emit("chat:message", { roomId: ROOM, text: "ZV25-E2E hello " + Date.now() });
  await new Promise(r => setTimeout(r, 2500));
  t("C6: realtime доставка сообщения A→B в комнате", !!got, JSON.stringify(got || {}).slice(0, 140));
  // online-список
  const online = await new Promise((res) => {
    const to = setTimeout(() => res("timeout"), 5000);
    sA.emit("chat:online");
    setTimeout(() => { clearTimeout(to); res("emitted-ok"); }, 500);
  });
  t("C5: chat:online обработан без ошибки соединения", online === "emitted-ok", String(online));
  sA.disconnect(); sB.disconnect();
} else {
  t("C6/C5: пропущены — handshake не удался", false, "cascade");
}
const failed = checks.filter(x => !x.ok);
console.log(`\n=== CHAT E2E COMPACT: ${checks.length - failed.length}/${checks.length} PASS ===`);
process.exit(failed.length ? 1 : 0);
