/**
 * agent-ctx/s6b1-socket-probe.ts — socket.io гейт-проба S6B1 (recreate-3).
 *
 * ДВА клиента в ОДНОМ скрипте = server-side real-time proof. Печатает
 * PASS/FAIL-строки; exit code 1 при любом FAIL. Секреты не печатаются.
 *
 * Точки проверки (гейт №3 блока):
 *   1. handshake БЕЗ токена → connect_error (fail-closed);
 *   2. валидный shim-JWT → connected (оба клиента);
 *   3. join ЧУЖОЙ беседы → chat:error forbidden (+ join своей → joined);
 *   4. message:send → персистенция в БД (Prisma row) + message:new у
 *      собеседника < 2s + conversation:updated в личную комнату (unreadDelta);
 *   5. presence: partner видит online:true при connect, online:false при
 *      disconnect;
 *   6. message:read → conversation:read у собеседника + readAt в БД;
 *   7. rate-limit: 31-е сообщение в минуту → chat:error rate_limited.
 *
 * Импорты — АБСОЛЮТНЫЕ пути в node_modules conditera-v2 (bun резолвит
 * относительный @prisma/client от ФАЙЛА пробы, а это agent-ctx — чужой
 * пакет-корень старого проекта; прямые пути гарантируют v2-клиент и v2-схему).
 *
 * Запуск: bun /home/z/my-project/agent-ctx/s6b1-socket-probe.ts
 */

import { io, type Socket } from "/home/z/my-project/conditera-v2/node_modules/socket.io-client/build/esm/index.js";
import { PrismaClient } from "/home/z/my-project/conditera-v2/node_modules/@prisma/client/default.js";
import { readFileSync } from "node:fs";

const SERVICE_URL = "http://127.0.0.1:3030"; // инфраструктура-проба, НЕ клиентский код
const SHIM_URL = "http://127.0.0.1:3040";
const EMAIL_CUSTOMER = "customer@demo.ru";
EMAIL_CUSTOMER; // пометка: демо-учётки S4B3
const EMAIL_CONFECTIONER = "confectioner@demo.ru";
const PASSWORD = "Demo123!";
const V2_ROOT = "/home/z/my-project/conditera-v2";

// --- DATABASE_URL из .env.local (не печатается) -----------------------------
function pickEnv(name: string): string {
  try {
    for (const line of readFileSync(`${V2_ROOT}/.env.local`, "utf8").split("\n")) {
      const m = line.match(new RegExp(`^${name}=(.*)$`));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // ignore
  }
  return process.env[name] ?? "";
}

const ANON_KEY = pickEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

const prisma = new PrismaClient({
  datasources: { db: { url: pickEnv("DATABASE_URL") } },
});

let passCount = 0;
let failCount = 0;
function pass(label: string): void {
  passCount += 1;
  console.log(`PASS: ${label}`);
}
function fail(label: string, detail?: string): void {
  failCount += 1;
  console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
}
function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) pass(label);
  else fail(label, detail);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ждать событие с таймаутом. */
function waitFor<T>(socket: Socket, event: string, timeoutMs = 3000): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, timeoutMs);
    const handler = (payload: T) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

async function shimLogin(email: string): Promise<{ accessToken: string; authId: string }> {
  const res = await fetch(`${SHIM_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`shim login failed ${res.status} for ${email}`);
  const data = (await res.json()) as { access_token: string; user: { id: string } };
  return { accessToken: data.access_token, authId: data.user.id };
}

function connect(token: string | null): Promise<{ socket: Socket; error: string | null }> {
  return new Promise((resolve) => {
    const socket = io(SERVICE_URL, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: token ? { token } : { token: "" },
      timeout: 5000,
      forceNew: true,
    });
    let settled = false;
    socket.on("connect", () => {
      if (settled) return;
      settled = true;
      resolve({ socket, error: null });
    });
    socket.on("connect_error", (err: Error) => {
      if (settled) return;
      settled = true;
      resolve({ socket, error: err.message });
    });
  });
}

async function main(): Promise<void> {
  console.log("=== s6b1-socket-probe: два клиента в одном скрипте ===");

  // --- логины через shim (dev JWT HS256, SUPABASE_JWT_SECRET) ---
  const customer = await shimLogin(EMAIL_CUSTOMER);
  const confectioner = await shimLogin(EMAIL_CONFECTIONER);
  const profiles = await prisma.profile.findMany({
    where: { userId: { in: [customer.authId, confectioner.authId] } },
    select: { id: true, userId: true, name: true },
  });
  const customerProfile = profiles.find((p) => p.userId === customer.authId);
  const confectionerProfile = profiles.find((p) => p.userId === confectioner.authId);
  assert(
    Boolean(customerProfile && confectionerProfile),
    "profiles resolved by auth id",
    JSON.stringify({ customer: Boolean(customerProfile), vendor: Boolean(confectionerProfile) })
  );
  if (!customerProfile || !confectionerProfile) {
    fail("demo profiles missing — проверь seed S4B3");
    process.exit(1);
  }

  // --- 1. handshake без токена ---
  const anon = await connect(null);
  assert(anon.error !== null, "handshake WITHOUT token → connect_error", anon.error ?? "no error");
  anon.socket.disconnect();

  // --- беседа между демо-парой (find-or-create прямым Prisma — проверка
  //     participant-пути сервиса; HTTP find-or-create гейтится curl-матрицей) ---
  let room = await prisma.chatRoom.findFirst({
    where: {
      type: "direct",
      AND: [
        { participants: { has: customer.authId } },
        { participants: { has: confectioner.authId } },
      ],
    },
  });
  if (!room) {
    room = await prisma.chatRoom.create({
      data: {
        type: "direct",
        name: "S6B1 probe",
        participants: [customer.authId, confectioner.authId],
      },
    });
  }
  const conversationId = room.id;

  // --- чужая беседа (участники — не демо-пара), удаляется в конце ---
  const foreignRoom = await prisma.chatRoom.create({
    data: {
      type: "direct",
      name: "S6B1 foreign (temp)",
      participants: [`foreign-auth-${Date.now()}`, `foreign-auth-${Date.now() + 1}`],
    },
  });

  // --- 2. валидные токены → connected (B первым для presence-теста) ---
  const vendorConn = await connect(confectioner.accessToken);
  assert(vendorConn.error === null && vendorConn.socket.connected, "valid token → connected (B)");
  const vendorPresence = waitFor<{ profileId: string; online: boolean }>(
    vendorConn.socket,
    "presence:update"
  );

  const customerConn = await connect(customer.accessToken);
  assert(
    customerConn.error === null && customerConn.socket.connected,
    "valid token → connected (A)"
  );

  // --- 5. presence: B видит A online ---
  const presenceSeen = await vendorPresence;
  assert(
    presenceSeen !== null && presenceSeen.profileId === customerProfile.id && presenceSeen.online,
    "presence:update online:true виден партнёру",
    presenceSeen ? JSON.stringify(presenceSeen) : "timeout"
  );

  // --- 3a. join ЧУЖОЙ беседы → forbidden ---
  customerConn.socket.emit("join:conversation", { conversationId: foreignRoom.id });
  const foreignErr = await waitFor<{ code?: string }>(customerConn.socket, "chat:error");
  assert(
    foreignErr !== null && foreignErr.code === "forbidden",
    "join FOREIGN conversation → chat:error forbidden",
    foreignErr ? JSON.stringify(foreignErr) : "no error event"
  );

  // --- 3b. join СВОЕЙ беседы → conversation:joined ---
  customerConn.socket.emit("join:conversation", { conversationId });
  const joined = await waitFor<{ conversationId: string }>(
    customerConn.socket,
    "conversation:joined"
  );
  assert(
    joined !== null && joined.conversationId === conversationId,
    "join OWN conversation → conversation:joined"
  );
  vendorConn.socket.emit("join:conversation", { conversationId });
  await waitFor(vendorConn.socket, "conversation:joined");

  // --- 4. message:send → персистенция + real-time у B ---
  const vendorMessagePromise = waitFor<{
    id: string;
    conversationId: string;
    senderId: string;
    body: string;
  }>(vendorConn.socket, "message:new", 2000);
  const clientId = `probe-${Date.now()}`;
  customerConn.socket.emit("message:send", {
    conversationId,
    body: "Здравствуйте! Это probe-сообщение S6B1.",
    clientId,
  });
  const received = await vendorMessagePromise;
  assert(
    received !== null &&
      received.conversationId === conversationId &&
      received.senderId === customerProfile.id &&
      received.body.includes("probe-сообщение"),
    "real-time message:new у собеседника (<2s)",
    received ? JSON.stringify(received) : "timeout"
  );
  if (received) {
    const dbRow = await prisma.chatMessage.findUnique({ where: { id: received.id } });
    assert(
      dbRow !== null && dbRow.roomId === conversationId && dbRow.senderId === customerProfile.id,
      "message PERSISTED in DB (ChatMessage row)",
      dbRow ? "" : "row missing"
    );
  } else {
    fail("message PERSISTED in DB — broadcast не получен, проверка БД пропущена");
  }

  const vendorUpdated = await waitFor<{ conversationId: string; unreadDelta: number }>(
    vendorConn.socket,
    "conversation:updated"
  );
  assert(
    vendorUpdated !== null && vendorUpdated.unreadDelta === 1,
    "conversation:updated → личная комната B, unreadDelta=+1",
    vendorUpdated ? JSON.stringify(vendorUpdated) : "timeout"
  );

  // --- 6. message:read → conversation:read + readAt в БД ---
  if (received) {
    const vendorRead = waitFor<{ conversationId: string; readerProfileId: string }>(
      customerConn.socket,
      "conversation:read"
    );
    vendorConn.socket.emit("message:read", { conversationId });
    const readEvent = await vendorRead;
    assert(
      readEvent !== null && readEvent.readerProfileId === confectionerProfile.id,
      "conversation:read у отправителя",
      readEvent ? JSON.stringify(readEvent) : "timeout"
    );
    const refreshed = await prisma.chatMessage.findUnique({ where: { id: received.id } });
    assert(refreshed?.readAt !== null && refreshed?.readAt !== undefined, "readAt set in DB");
  }

  // --- 7. rate-limit: 31-е сообщение в минуту ---
  const rateErrorPromise = waitFor<{ code?: string }>(customerConn.socket, "chat:error", 4000);
  for (let i = 1; i <= 31; i += 1) {
    customerConn.socket.emit("message:send", {
      conversationId,
      body: `rate-probe #${i}`,
      clientId: `rate-${Date.now()}-${i}`,
    });
    await sleep(15);
  }
  const rateError = await rateErrorPromise;
  assert(
    rateError !== null && rateError.code === "rate_limited",
    "rate-limit 31st message → chat:error rate_limited",
    rateError ? JSON.stringify(rateError) : "no error in window"
  );

  // --- 5b. presence offline при disconnect A ---
  const vendorOffline = waitFor<{ profileId: string; online: boolean }>(
    vendorConn.socket,
    "presence:update",
    4000
  );
  customerConn.socket.disconnect();
  const offlineSeen = await vendorOffline;
  assert(
    offlineSeen !== null && offlineSeen.profileId === customerProfile.id && !offlineSeen.online,
    "presence:update online:false после disconnect",
    offlineSeen ? JSON.stringify(offlineSeen) : "timeout"
  );

  // --- cleanup ---
  vendorConn.socket.disconnect();
  await prisma.chatRoom.delete({ where: { id: foreignRoom.id } }).catch(() => undefined);
  await prisma.$disconnect();

  console.log(`=== итог: PASS=${passCount} FAIL=${failCount} ===`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.log(`FAIL: probe crashed — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
