/**
 * verify-chat-runtime.mjs — RUNTIME GATE для чата и курьерского трекинга.
 *
 * Покрывает (по ТЗ владельца, этап 03 + 04):
 *  1. Socket.IO handshake: без токена / неверный / валидный JWT.
 *  2. room:join: свой комнат OK, чужая → room:error.
 *  3. message:send → message:receive вторым участником + message:sent.
 *  4. Персистентность: строка в chat_messages + чтение через history API.
 *  5. bot:quick_reply: в своей комнате OK; в чужой → message:error, доставка отсутствует.
 *  6. room:leave: свою OK (+ room:user_left), чужую → room:error,
 *     алиасы (r3 → support), мультикомнатность (выход из одной не ломает другую),
 *     после выхода typing не релеится.
 *  7. typing / read receipts: только верифицированные комнаты.
 *  8. Reconnect: история не дублируется, доставка продолжается.
 *  9. Support-чат: bot-ответ + персистенция через BOT_SECRET.
 * 10. courier:location: назначенный курьер доставляет гео покупателю
 *     (получатель из серверных данных, spoof customerId игнорируется);
 *     неназначенный → courier:error; не-курьер игнорируется;
 *     GET /api/orders/[id]: courier1 200 / courier2 403;
 *     POST /api/courier/assign: courier1 200 / courier2 409;
 *     POST /api/courier/location → courier_locations + order_tracking.
 *
 * Изолированные тестовые записи (courier/customer/order) создаются на время
 * прогона и удаляются в finally. Реальные заказы не затрагиваются.
 *
 * Запуск: bun scripts/verify-chat-runtime.mjs   (exit 0 = все проверки прошли)
 */
import { io } from "socket.io-client";
import pg from "pg";

const BASE = process.env.RT_BASE_URL || "http://127.0.0.1:3000";
const CHAT_URL = process.env.RT_CHAT_URL || "http://127.0.0.1:3030";
const SOCK_PATH = "/socket.io";
const PG = { host: "127.0.0.1", port: 54329, user: "postgres", database: "conditera" };
const DEMO_PASSWORD = "Demo123!";

const results = [];
let failures = 0;
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== HTTP helpers =====
async function api(method, path, { token, body, csrfPair } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (csrfPair) {
    headers["x-csrf-token"] = csrfPair.token;
    headers.Cookie = `csrf_token=${csrfPair.cookie}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* пустой body */ }
  return { status: res.status, json };
}

async function getCsrfPair() {
  const res = await fetch(`${BASE}/api/csrf-token`);
  const json = await res.json();
  const setCookie = res.headers.get("set-cookie") || "";
  const m = setCookie.match(/csrf_token=([^;]+)/);
  return json?.token && m ? { token: json.token, cookie: m[1] } : null;
}

async function login(email) {
  const { status, json } = await api("POST", "/api/auth/login", {
    body: { email, password: DEMO_PASSWORD },
  });
  if (status !== 200 || !json?.accessToken) {
    throw new Error(`login ${email} failed: ${status} ${JSON.stringify(json)?.slice(0, 200)}`);
  }
  return { token: json.accessToken, user: json.user };
}

// ===== Socket helpers =====
function connectSocket(token, extra = {}) {
  return new Promise((resolve, reject) => {
    const socket = io(CHAT_URL, {
      path: SOCK_PATH,
      auth: { token, ...extra },
      transports: ["polling", "websocket"],
      reconnection: false,
      timeout: 8000,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error("connect timeout"));
    }, 8000);
    socket.on("connect", () => { clearTimeout(timer); resolve(socket); });
    socket.on("connect_error", (err) => { clearTimeout(timer); socket.disconnect(); reject(Object.assign(new Error(err?.message || "connect_error"), { code: "CONNECT_ERROR", raw: err })); });
  });
}

function expectEvent(socket, event, { timeoutMs = 6000, predicate = () => true } = {}) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve({ timedOut: true, data: null });
    }, timeoutMs);
    const handler = (data) => {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve({ timedOut: false, data });
    };
    socket.on(event, handler);
  });
}

// ===== Фикстуры (изолированные тестовые записи) =====
async function createFixtures(client, ts) {
  const ids = {
    customer: crypto.randomUUID(),
    courier1: crypto.randomUUID(),
    courier2: crypto.randomUUID(),
    role: [crypto.randomUUID(), crypto.randomUUID()],
    order: crypto.randomUUID(),
  };
  const emails = {
    customer: `rt-customer-${ts}@runtime-test.local`,
    courier1: `rt-courier1-${ts}@runtime-test.local`,
    courier2: `rt-courier2-${ts}@runtime-test.local`,
  };
  // password_hash копируем из demo-пользователей (тот же bcrypt).
  // ВАЖНО: INSERT в auth.users запускает триггер handle_new_user, который сам
  // создаёт profiles + user_roles(CUSTOMER) + notification_preferences —
  // явный INSERT в profiles дал бы duplicate key (profiles_pkey).
  const names = { customer: "RT customer", courier1: "RT courier1", courier2: "RT courier2" };
  for (const key of ["customer", "courier1", "courier2"]) {
    await client.query(
      `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
       VALUES ($1::uuid, $2, (SELECT encrypted_password FROM auth.users WHERE email='customer@demo.ru'), now(), jsonb_build_object('name', $3::text), now(), now())`,
      [ids[key], emails[key], names[key]]
    );
    await client.query(
      `UPDATE profiles SET password_hash = (SELECT password_hash FROM profiles WHERE email='customer@demo.ru'),
              is_verified = true, name = $2 WHERE id = $1::uuid`,
      [ids[key], names[key]]
    );
  }
  await client.query(
    `INSERT INTO user_roles (id, user_id, role, is_active, assigned_at)
     VALUES ($1::uuid, $2::uuid, 'COURIER', true, now()), ($3::uuid, $4::uuid, 'COURIER', true, now())`,
    [ids.role[0], ids.courier1, ids.role[1], ids.courier2]
  );
  const orderNumber = `RT-${ts}`;
  await client.query(
    `INSERT INTO orders (id, number, user_id, confectioner_id, subtotal, total, status,
                         delivery_address, delivery_date, created_at, updated_at)
     VALUES ($1::uuid, $2, $3::uuid, (SELECT id FROM profiles WHERE email='confectioner@demo.ru'),
             1500, 1500, 'READY', 'RT test address', now() + interval '1 day', now(), now())`,
    [ids.order, orderNumber, ids.customer]
  );
  return { ids, emails, orderNumber };
}

async function cleanupFixtures(client, ids) {
  if (!ids) return;
  const statements = [
    ["DELETE FROM order_tracking WHERE \"courierId\" = $1 OR \"courierId\" = $2", [ids.courier1, ids.courier2]],
    ["DELETE FROM courier_locations WHERE \"courierId\" = $1 OR \"courierId\" = $2", [ids.courier1, ids.courier2]],
    ["DELETE FROM deliveries WHERE order_id = $1", [ids.order]],
    ["DELETE FROM chat_messages WHERE channel_id IN (SELECT id FROM chat_channels WHERE (support_ticket_id IS NULL AND id IN (SELECT channel_id FROM chat_channel_members WHERE user_id = ANY($1::uuid[]))))", [[ids.customer, ids.courier1]]],
    ["DELETE FROM chat_channel_members WHERE user_id = ANY($1::uuid[])", [[ids.customer, ids.courier1]]],
    ["DELETE FROM chat_channels WHERE id IN (SELECT channel_id FROM chat_channel_members WHERE user_id = ANY($1::uuid[]))", [[ids.customer, ids.courier1]]],
    ["DELETE FROM support_tickets WHERE user_id = $1", [ids.customer]],
    ["DELETE FROM orders WHERE id = $1", [ids.order]],
    ["DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])", [[ids.courier1, ids.courier2, ids.customer]]],
    ["DELETE FROM notification_preferences WHERE user_id = ANY($1::uuid[])", [[ids.courier1, ids.courier2, ids.customer]]],
    ["DELETE FROM profiles WHERE id = ANY($1::uuid[])", [[ids.customer, ids.courier1, ids.courier2]]],
    ["DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [[ids.customer, ids.courier1, ids.courier2]]],
  ];
  for (const [sql, params] of statements) {
    try { await client.query(sql, params); } catch (e) { console.warn(`cleanup warn: ${e.message}`); }
  }
}

// ===== Основной сценарий =====
async function main() {
  const ts = Date.now();
  const client = new pg.Client(PG);
  await client.connect();
  let fixtureIds = null;
  const sockets = [];

  try {
    // ===== 0. Pre-flight =====
    const health = await api("GET", "/api/health");
    record("preflight: /api/health 200", health.status === 200 && health.json?.status === "ok", `status=${health.status}`);
    const chatHealth = await fetch(`${CHAT_URL}/health`).then((r) => r.json());
    record("preflight: chat-server /health", chatHealth?.status === "ok", JSON.stringify(chatHealth).slice(0, 120));
    const csrf = await getCsrfPair();
    record("preflight: /api/csrf-token", !!csrf);

    // ===== 1. Логины =====
    const A = await login("customer@demo.ru"); // покупатель
    const B = await login("confectioner@demo.ru"); // кондитер
    const C = await login("admin@demo.ru"); // admin (для чужой direct-комнаты)
    record("login: customer/confectioner/admin", !!A.token && !!B.token && !!C.token);

    // ===== 2. Комнаты =====
    const roomRes = await api("POST", "/api/chat/rooms", { token: A.token, csrfPair: await getCsrfPair(), body: { type: "direct", peerId: B.user.id } });
    record("create direct room A↔B", roomRes.status === 200 && !!roomRes.json?.room?.id, `status=${roomRes.status}`);
    const roomId = roomRes.json.room.id;

    const foreignRes = await api("POST", "/api/chat/rooms", { token: A.token, csrfPair: await getCsrfPair(), body: { type: "direct", peerId: C.user.id } });
    const foreignRoomId = foreignRes.json?.room?.id;
    record("create foreign room A↔C (для негативных кейсов)", foreignRes.status === 200 && !!foreignRoomId);

    const supportRes = await api("POST", "/api/chat/rooms", { token: A.token, csrfPair: await getCsrfPair(), body: { type: "support" } });
    const supportRoomId = supportRes.json?.room?.id;
    record("create support room A", supportRes.status === 200 && !!supportRoomId, `type=${supportRes.json?.room?.type}`);

    // ===== 3. Handshake matrix =====
    try {
      await connectSocket(null);
      record("handshake: без токена отклонён", false, "соединение прошло без токена!");
    } catch (e) {
      record("handshake: без токена отклонён", /token required/i.test(e.message), e.message);
    }
    try {
      await connectSocket("garbage.token.value");
      record("handshake: неверный токен отклонён", false, "соединение прошло с мусорным токеном!");
    } catch (e) {
      record("handshake: неверный токен отклонён", /unauthorized/i.test(e.message), e.message);
    }
    const sockA = await connectSocket(A.token); sockets.push(sockA);
    const sockB = await connectSocket(B.token); sockets.push(sockB);
    const sockC = await connectSocket(C.token); sockets.push(sockC);
    record("handshake: валидные токены A/B/C подключены", sockA.connected && sockB.connected && sockC.connected);

    // ===== 4. room:join =====
    const bJoinErr = expectEvent(sockB, "room:error", { timeoutMs: 4000 });
    sockA.emit("room:join", roomId);
    const aOnline = await expectEvent(sockA, "room:online_users", { timeoutMs: 4000 });
    const joinErrA = await bJoinErr; // room:error не должен прийти B на чужой join A
    record("room:join A → online_users", !aOnline.timedOut && Array.isArray(aOnline.data?.users), JSON.stringify(aOnline.data)?.slice(0, 100));
    record("room:join A: нет room:error", joinErrA.timedOut);

    const aUserJoined = expectEvent(sockA, "room:user_joined", { timeoutMs: 4000, predicate: (d) => d?.userId === B.user.id });
    sockB.emit("room:join", roomId);
    const uj = await aUserJoined;
    record("room:join B → room:user_joined у A", !uj.timedOut);

    // чужая комната: B пытается войти в direct A↔C
    const bForeignErr = expectEvent(sockB, "room:error", { timeoutMs: 4000, predicate: (d) => d?.roomId === foreignRoomId });
    sockB.emit("room:join", foreignRoomId);
    const fErr = await bForeignErr;
    record("room:join B в чужую → room:error", !fErr.timedOut && /Нет доступа/.test(fErr.data?.error || ""), JSON.stringify(fErr.data));

    // ===== 5. message:send / receive =====
    const msgText = `RT-GATE-${ts}-hello`;
    const bRecv = expectEvent(sockB, "message:receive", { timeoutMs: 6000, predicate: (d) => d?.roomId === roomId && d?.message?.text === msgText });
    const aSent = expectEvent(sockA, "message:sent", { timeoutMs: 6000 });
    const aRecvOwn = expectEvent(sockA, "message:receive", { timeoutMs: 2500 });
    const msgId = `rt-msg-${ts}-1`;
    sockA.emit("message:send", { roomId, message: { id: msgId, text: msgText, senderId: "SPOOFED-ID", senderName: "SPOOFED" } });
    const sent = await aSent;
    const recv = await bRecv;
    const own = await aRecvOwn;
    record("message:send → message:sent у A", !sent.timedOut && sent.data?.messageId === msgId, JSON.stringify(sent.data)?.slice(0, 80));
    record("message:receive у B, sender из JWT (не payload)", !recv.timedOut && recv.data?.message?.senderId === A.user.id && recv.data?.message?.senderName !== "SPOOFED", `senderId=${recv.data?.message?.senderId}`);
    record("message:send не эхо-рассылается отправителю (socket.to)", own.timedOut);

    // B пытается отправить в чужую комнату — C ничего не получает
    const cForeignRecv = expectEvent(sockC, "message:receive", { timeoutMs: 3000, predicate: (d) => d?.roomId === foreignRoomId });
    const bForeignMsgErr = expectEvent(sockB, "message:error", { timeoutMs: 4000, predicate: (d) => d?.roomId === foreignRoomId });
    sockB.emit("message:send", { roomId: foreignRoomId, message: { id: `rt-spoof-${ts}`, text: "intrusion", senderId: C.user.id, senderName: "admin" } });
    const fmErr = await bForeignMsgErr;
    const fcRecv = await cForeignRecv;
    record("message:send B в чужую → message:error, C ничего не получил", !fmErr.timedOut && fcRecv.timedOut, JSON.stringify(fmErr.data));

    // ===== 6. Персистентность: БД + history API =====
    await sleep(1500);
    const dbMsg = await client.query(
      `SELECT id, text, sender_id, channel_id FROM chat_messages WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [roomId]
    );
    const persisted = dbMsg.rows.find((r) => r.text === msgText && r.sender_id === A.user.id);
    record("message:persist в chat_messages (server-side)", !!persisted, `${dbMsg.rows.length} rows, match=${!!persisted}`);
    const hist = await api("GET", `/api/chat/rooms/${roomId}/messages?limit=50`, { token: B.token });
    const histMsg = hist.json?.messages?.find((m) => m.text === msgText);
    record("history API возвращает сообщение", hist.status === 200 && !!histMsg, `status=${hist.status}, total=${hist.json?.messages?.length}`);

    // ===== 7. bot:quick_reply =====
    // 7a. разрешённая комната: A в своей support-комнате
    const t7a = Date.now();
    const aSupportJoinErr = expectEvent(sockA, "room:error", { timeoutMs: 3000 });
    sockA.emit("room:join", supportRoomId);
    const aSupOnline = await expectEvent(sockA, "room:online_users", { timeoutMs: 6000, predicate: (d) => d?.roomId === supportRoomId });
    const sjErr = await aSupportJoinErr;
    record(
      "room:join A → support room",
      !aSupOnline.timedOut && sjErr.timedOut,
      `online_users=${JSON.stringify(aSupOnline.data)?.slice(0, 100)} timedOut=${aSupOnline.timedOut} (${Date.now() - t7a}ms) roomError=${JSON.stringify(sjErr.data)}`
    );

    const qrText = "Способы оплаты";
    const aQrEcho = expectEvent(sockA, "message:receive", { timeoutMs: 5000, predicate: (d) => d?.roomId === supportRoomId && d?.message?.text === qrText });
    sockA.emit("bot:quick_reply", { roomId: supportRoomId, reply: { label: qrText, action: "faq:payment" } });
    const qrEcho = await aQrEcho;
    record("bot:quick_reply в своей комнате: userMsg получен", !qrEcho.timedOut && qrEcho.data?.message?.senderId === A.user.id);

    const aBotReply = expectEvent(sockA, "message:receive", { timeoutMs: 6000, predicate: (d) => d?.roomId === supportRoomId && d?.message?.isBot === true });
    const botReply = await aBotReply;
    record("support: FAQ bot-ответ получен (real-time)", !botReply.timedOut && !!botReply.data?.message?.text, JSON.stringify(botReply.data?.message)?.slice(0, 80));

    // 7b. запрещённая: B шлёт quick_reply в чужую direct A↔C
    const cForeignQr = expectEvent(sockC, "message:receive", { timeoutMs: 3000, predicate: (d) => d?.roomId === foreignRoomId });
    const bQrErr = expectEvent(sockB, "message:error", { timeoutMs: 4000, predicate: (d) => d?.roomId === foreignRoomId });
    sockB.emit("bot:quick_reply", { roomId: foreignRoomId, reply: { label: "intrude", action: "faq:payment" } });
    const qrErr = await bQrErr;
    const cQr = await cForeignQr;
    record("bot:quick_reply B в чужую → message:error, C ничего не получил", !qrErr.timedOut && cQr.timedOut, JSON.stringify(qrErr.data));

    // ===== 8. room:leave =====
    // 8a. чужая/неприсоединённая: B покидает support-комнату A (никогда не входил)
    const bLeaveErr = expectEvent(sockB, "room:error", { timeoutMs: 4000, predicate: (d) => d?.roomId === supportRoomId });
    sockB.emit("room:leave", supportRoomId);
    const lErr = await bLeaveErr;
    record("room:leave B чужой комнаты → room:error", !lErr.timedOut, JSON.stringify(lErr.data));

    // 8b. алиас r3 → реальная support-комната A: join через алиас, leave через алиас
    sockA.emit("room:join", "r3");
    await sleep(600); // resolveRoomId → find-or-create (та же support-комната)
    const aLeftByOthers = expectEvent(sockB, "room:user_left", { timeoutMs: 4000, predicate: (d) => d?.userId === A.user.id });
    sockA.emit("room:leave", "r3");
    // A вышел из support-комнаты; B не состоит в ней, поэтому проверяем отсутствие ошибки у A
    const aLeaveErr = expectEvent(sockA, "room:error", { timeoutMs: 2000 });
    const leaveErrRes = await aLeaveErr;
    record("room:leave по алиасу r3 — без room:error", leaveErrRes.timedOut);

    // 8c. мультикомнатность: A повторно входит в roomId, покидает support, typing в roomId продолжает работать
    sockA.emit("room:join", roomId);
    await sleep(300);
    sockA.emit("room:leave", supportRoomId);
    await sleep(300);
    const bTyping = expectEvent(sockB, "typing:start", { timeoutMs: 4000, predicate: (d) => d?.roomId === roomId && d?.userId === A.user.id });
    sockA.emit("typing:start", { roomId });
    const typ = await bTyping;
    record("room:leave одной комнаты не ломает другую (typing релеится)", !typ.timedOut);

    // 8d. после выхода typing в покинутой комнате НЕ релеится
    const bTypingLeft = expectEvent(sockB, "typing:start", { timeoutMs: 2500, predicate: (d) => d?.roomId === supportRoomId });
    sockA.emit("typing:start", { roomId: supportRoomId });
    const typLeft = await bTypingLeft;
    record("typing в покинутой комнате не доставляется", typLeft.timedOut);

    // ===== 9. read receipts =====
    const bRead = expectEvent(sockB, "message:read", { timeoutMs: 4000, predicate: (d) => d?.roomId === roomId && d?.userId === A.user.id });
    sockA.emit("message:read", { roomId, messageIds: [msgId] });
    const read = await bRead;
    record("message:read релеится участнику", !read.timedOut && Array.isArray(read.data?.messageIds));

    // B шлёт read в чужую комнату — C ничего не получает
    const cForeignRead = expectEvent(sockC, "message:read", { timeoutMs: 2500, predicate: (d) => d?.roomId === foreignRoomId });
    sockB.emit("message:read", { roomId: foreignRoomId, messageIds: ["x"] });
    const cRead = await cForeignRead;
    record("message:read в чужую комнату не доставляется", cRead.timedOut);

    // ===== 10. Reconnect =====
    sockA.disconnect();
    await sleep(500);
    const sockA2 = await connectSocket(A.token); sockets.push(sockA2);
    sockA2.emit("room:join", roomId);
    await expectEvent(sockA2, "room:online_users", { timeoutMs: 4000, predicate: (d) => d?.roomId === roomId });
    const reconnectText = `RT-GATE-${ts}-reconnect`;
    const a2Recv = expectEvent(sockA2, "message:receive", { timeoutMs: 6000, predicate: (d) => d?.message?.text === reconnectText });
    sockB.emit("message:send", { roomId, message: { id: `rt-msg-${ts}-2`, text: reconnectText, senderId: B.user.id, senderName: B.user.name } });
    const r2 = await a2Recv;
    record("reconnect: доставка сообщений восстановлена", !r2.timedOut);
    await sleep(1500);
    const dupCheck = await client.query(
      `SELECT text, count(*)::int AS n FROM chat_messages WHERE channel_id = $1 AND text LIKE 'RT-GATE-${ts}%' GROUP BY text`,
      [roomId]
    );
    const noDup = dupCheck.rows.every((r) => r.n === 1) && dupCheck.rows.length >= 2;
    record("reconnect: история без дублей (БД)", noDup, JSON.stringify(dupCheck.rows));

    // ===== 11. Support-чат: персистенция бота через BOT_SECRET =====
    await sleep(1000); // дать persistBotMessage завершиться
    const botPersist = await client.query(
      `SELECT text, is_bot, bot_kind FROM chat_messages WHERE channel_id = $1 AND is_bot = true ORDER BY created_at DESC LIMIT 3`,
      [supportRoomId]
    );
    record("support: bot-ответ персистентен (BOT_SECRET работает)", botPersist.rows.length > 0, JSON.stringify(botPersist.rows[0] || null)?.slice(0, 120));

    // ===== 12. Courier =====
    const fixtures = await createFixtures(client, ts);
    fixtureIds = fixtures.ids;
    const { orderNumber } = fixtures;

    const RT_C = await login(fixtures.emails.customer);
    const RT_K1 = await login(fixtures.emails.courier1);
    const RT_K2 = await login(fixtures.emails.courier2);

    // 12a. assign: courier1 берёт заказ; courier2 → 409
    const assign1 = await api("POST", "/api/courier/assign", { token: RT_K1.token, csrfPair: await getCsrfPair(), body: { orderId: fixtureIds.order } });
    record("POST /api/courier/assign courier1 → 200", assign1.status === 200 && assign1.json?.success === true, JSON.stringify(assign1.json).slice(0, 120));
    const assign2 = await api("POST", "/api/courier/assign", { token: RT_K2.token, csrfPair: await getCsrfPair(), body: { orderId: fixtureIds.order } });
    record("POST /api/courier/assign courier2 → 409 (уже занят)", assign2.status === 409, `status=${assign2.status}`);

    // 12b. GET /api/orders/[id] scope: courier1 200, courier2 403
    const ordK1 = await api("GET", `/api/orders/${fixtureIds.order}`, { token: RT_K1.token });
    const ordK2 = await api("GET", `/api/orders/${fixtureIds.order}`, { token: RT_K2.token });
    record("GET /api/orders/[id] courier1 (назначен) → 200", ordK1.status === 200, `status=${ordK1.status}`);
    record("GET /api/orders/[id] courier2 (не назначен) → 403", ordK2.status === 403, `status=${ordK2.status}`);

    // 12c. сокеты курьеров и покупателя
    const sockCust = await connectSocket(RT_C.token); sockets.push(sockCust);
    const sockK1 = await connectSocket(RT_K1.token); sockets.push(sockK1);
    const sockK2 = await connectSocket(RT_K2.token); sockets.push(sockK2);

    // 12d. назначенный курьер: гео доставляется покупателю, spoof customerId игнорируется
    const custUpdate = expectEvent(sockCust, "courier:location_update", { timeoutMs: 8000, predicate: (d) => d?.orderId === fixtureIds.order });
    sockK1.emit("courier:location", { orderId: fixtureIds.order, customerId: "SPOOFED-CUSTOMER-ID", lat: 55.751244, lng: 37.618423, eta: 10 });
    const upd = await custUpdate;
    record(
      "courier:location назначенного → location_update покупателю, spoof customerId игнорирован",
      !upd.timedOut && Math.abs(upd.data?.lat - 55.751244) < 1e-6 && Math.abs(upd.data?.lng - 37.618423) < 1e-6,
      JSON.stringify(upd.data)?.slice(0, 140)
    );

    // 12e. неназначенный курьер → courier:error, покупатель ничего не получает
    const custUpdate2 = expectEvent(sockCust, "courier:location_update", { timeoutMs: 4000, predicate: (d) => d?.orderId === fixtureIds.order });
    const k2Err = expectEvent(sockK2, "courier:error", { timeoutMs: 8000, predicate: (d) => d?.orderId === fixtureIds.order });
    sockK2.emit("courier:location", { orderId: fixtureIds.order, customerId: RT_C.user.id, lat: 1, lng: 2 });
    const k2e = await k2Err;
    const upd2 = await custUpdate2;
    record("courier:location неназначенного → courier:error", !k2e.timedOut, JSON.stringify(k2e.data));
    record("courier:location неназначенного: покупатель НЕ получил гео", upd2.timedOut);

    // 12f. не-курьер вообще игнорируется
    const custUpdate3 = expectEvent(sockCust, "courier:location_update", { timeoutMs: 3000, predicate: (d) => d?.orderId === fixtureIds.order });
    sockA.emit("courier:location", { orderId: fixtureIds.order, customerId: RT_C.user.id, lat: 9, lng: 9 });
    const upd3 = await custUpdate3;
    record("courier:location от не-курьера игнорируется", upd3.timedOut);

    // 12f2. неверные координаты от НАЗНАЧЕННОГО курьера → courier:error, покупателю не доставляется
    const k1CoordErr = expectEvent(sockK1, "courier:error", { timeoutMs: 6000, predicate: (d) => d?.orderId === fixtureIds.order });
    const custNoBadCoord = expectEvent(sockCust, "courier:location_update", { timeoutMs: 3000, predicate: (d) => d?.orderId === fixtureIds.order });
    sockK1.emit("courier:location", { orderId: fixtureIds.order, customerId: RT_C.user.id, lat: 999, lng: 37.6 });
    const coordE = await k1CoordErr;
    const updNoBadCoord = await custNoBadCoord;
    record(
      "courier:location неверные координаты (lat=999) → courier:error",
      !coordE.timedOut && /Некоррект|коорд/i.test(String(coordE.data?.error)),
      JSON.stringify(coordE.data)
    );
    record("courier:location неверные координаты: покупатель НЕ получил гео", updNoBadCoord.timedOut);

    // 12f3. несуществующий заказ → courier:error (GET 404 → !res.ok), покупателю не доставляется
    const ghostOrderId = "00000000-0000-4000-8000-000000000000";
    const k1GhostErr = expectEvent(sockK1, "courier:error", { timeoutMs: 6000, predicate: (d) => d?.orderId === ghostOrderId });
    const custNoGhost = expectEvent(sockCust, "courier:location_update", { timeoutMs: 3000, predicate: (d) => d?.orderId === ghostOrderId });
    sockK1.emit("courier:location", { orderId: ghostOrderId, customerId: RT_C.user.id, lat: 55.75, lng: 37.62 });
    const ghostE = await k1GhostErr;
    const updNoGhost = await custNoGhost;
    record(
      "courier:location несуществующий заказ → courier:error",
      !ghostE.timedOut && /доступ|назнач/i.test(String(ghostE.data?.error)),
      JSON.stringify(ghostE.data)
    );
    record("courier:location несуществующий заказ: покупатель НЕ получил гео", updNoGhost.timedOut);

    // 12g. HTTP POST /api/courier/location: 200 + строки в БД (camelCase фикс)
    const locPost = await api("POST", "/api/courier/location", { token: RT_K1.token, csrfPair: await getCsrfPair(), body: { lat: 55.76, lng: 37.64, heading: 90 } });
    record("POST /api/courier/location → 200", locPost.status === 200, `status=${locPost.status} ${JSON.stringify(locPost.json).slice(0, 120)}`);
    await sleep(300);
    const locRow = await client.query(`SELECT "courierId", lat, lng FROM courier_locations WHERE "courierId" = $1`, [fixtureIds.courier1]);
    const trackRow = await client.query(`SELECT "orderId", "courierId" FROM order_tracking WHERE "courierId" = $1 LIMIT 1`, [fixtureIds.courier1]);
    record("courier_locations: строка записана (camelCase)", locRow.rows.length === 1 && Number(locRow.rows[0]?.lat) === 55.76, JSON.stringify(locRow.rows[0]));
    record("order_tracking: точка трекинга для активного заказа", trackRow.rows.length >= 1 && trackRow.rows[0]?.orderId === fixtureIds.order, JSON.stringify(trackRow.rows[0]));

  } finally {
    for (const s of sockets) { try { s.disconnect(); } catch {} }
    try { await cleanupFixtures(client, fixtureIds); } catch (e) { console.warn("cleanup failed:", e.message); }
    try { await client.end(); } catch {}
  }

  // ===== Summary =====
  console.log("\n===== RUNTIME GATE SUMMARY =====");
  const passed = results.filter((r) => r.ok).length;
  console.log(`PASSED: ${passed}/${results.length}`);
  if (failures > 0) {
    console.log("FAILED CHECKS:");
    for (const r of results.filter((r) => !r.ok)) console.log(`  ❌ ${r.name} — ${r.detail}`);
    process.exit(1);
  }
  console.log("ALL RUNTIME CHECKS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error("RUNTIME GATE CRASHED:", e);
  process.exit(2);
});
