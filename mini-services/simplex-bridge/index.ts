// ============================================================
// SimpleX Bridge — bot-мост между SimpleX Chat CLI и backend маркетплейса.
// ============================================================
//
// Архитектура:
//   SimpleX-клиент (user)
//        ↓ SMP-протокол (E2E)
//   smp-server (simplexchat/smp-server)
//        ↓ SMP
//   simplex-chat CLI (запущен в этом же контейнере, порт 5225 WS)
//        ↓ WebSocket (JSON)
//   simplex-bridge (этот процесс)
//        ↓ HTTP webhook
//   backend маркетплейса (/api/simplex/incoming)
//
// В обратную сторону:
//   backend → POST /send { contactName, text } → simplex-bridge
//         → WebSocket cmd → simplex-chat CLI → SMP → клиент
//
// Команды SimpleX Bot API: https://github.com/simplex-chat/simplex-chat/blob/stable/bots/api/COMMANDS.md
// ============================================================

import { createServer } from "http";
import WebSocket from "ws";
import axios from "axios";

const CLI_WS_URL = process.env.SIMPLEX_CLI_WS || "ws://localhost:5225";
const BACKEND_WEBHOOK = process.env.BACKEND_WEBHOOK || "http://localhost:3000/api/simplex/incoming";
const BACKEND_API_KEY = process.env.BACKEND_API_KEY || "";
const PROFILE_NAME = process.env.SIMPLEX_PROFILE_NAME || "Кондитера";
const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || "5226", 10);

if (!BACKEND_API_KEY && process.env.NODE_ENV === "production") {
  console.error("КРИТИЧНО: BACKEND_API_KEY не задан. Bridge не сможет отправлять webhook в backend.");
  process.exit(1);
}

// === Состояние ===
let cliSocket: WebSocket | null = null;
let isInitialized = false;
let activeProfile: string | null = null;
const pendingCommands = new Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }>();

// === Health endpoint для Docker healthcheck + UI ===
const healthServer = createServer((req, res) => {
  if (req.url === "/health" || req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      service: "conditera-simplex-bridge",
      cliConnected: !!cliSocket && cliSocket.readyState === WebSocket.OPEN,
      isInitialized,
      activeProfile,
      pendingCommands: pendingCommands.size,
      uptime: process.uptime(),
    }));
    return;
  }

  // POST /send — отправить сообщение через SimpleX (вызывается backend'ом)
  if (req.method === "POST" && req.url === "/send") {
    handleSendRequest(req, res);
    return;
  }

  // POST /api/address — получить #simplex-адрес для QR-кода
  if (req.method === "GET" && req.url === "/api/address") {
    handleGetAddress(req, res);
    return;
  }

  // POST /api/create-profile — создать профиль маркетплейса
  if (req.method === "POST" && req.url === "/api/create-profile") {
    handleCreateProfile(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

healthServer.listen(BRIDGE_PORT, () => {
  console.log(`[bridge] HTTP server on :${BRIDGE_PORT}`);
});

// === HTTP handlers ===
async function handleSendRequest(req: any, res: any) {
  // Проверяем API-ключ (через X-Bridge-Api-Key header)
  const apiKey = req.headers["x-bridge-api-key"];
  if (apiKey !== BACKEND_API_KEY) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const { contactName, text, chatId } = JSON.parse(body);
    if (!contactName || !text) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "contactName and text required" }));
      return;
    }

    // Команда SimpleX: @contactName текст сообщения
    // Или если есть chatId: /_send_message <chatId> <text>
    const cmd = chatId
      ? `/_api /_send ${chatId} ${JSON.stringify({ msg: { text } })}`
      : `@${contactName} ${text}`;

    const result = await sendCommand(cmd);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, result }));
  } catch (err: any) {
    console.error("[bridge] /send error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleGetAddress(req: any, res: any) {
  try {
    // /_address — получить список адресов
    const result = await sendCommand("/_address");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, addresses: result }));
  } catch (err: any) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleCreateProfile(req: any, res: any) {
  const apiKey = req.headers["x-bridge-api-key"];
  if (apiKey !== BACKEND_API_KEY) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  try {
    // Создать профиль + business-адрес
    const profileResult = await sendCommand(`/_profile ${PROFILE_NAME} 1`);
    const addressResult = await sendCommand("/_address 1");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      success: true,
      profile: profileResult,
      address: addressResult,
    }));
  } catch (err: any) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// === WebSocket-клиент к simplex-chat CLI ===
function connectToCLI() {
  console.log(`[bridge] Connecting to SimpleX CLI at ${CLI_WS_URL}...`);
  cliSocket = new WebSocket(CLI_WS_URL);

  cliSocket.on("open", () => {
    console.log("[bridge] ✓ Connected to SimpleX CLI");
    // Инициализация — получить список пользователей
    sendRaw("/_users");
  });

  cliSocket.on("message", async (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      await handleCLIMessage(msg);
    } catch (err) {
      console.error("[bridge] Failed to parse CLI message:", err);
    }
  });

  cliSocket.on("close", () => {
    console.warn("[bridge] CLI connection closed. Reconnecting in 3s...");
    cliSocket = null;
    isInitialized = false;
    setTimeout(connectToCLI, 3000);
  });

  cliSocket.on("error", (err: Error) => {
    console.error("[bridge] CLI WebSocket error:", err.message);
  });
}

function sendRaw(cmd: string, corrId?: string) {
  if (!cliSocket || cliSocket.readyState !== WebSocket.OPEN) {
    console.warn("[bridge] Cannot send — CLI not connected");
    return false;
  }
  const message = JSON.stringify({
    corrId: corrId || `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    cmd,
  });
  cliSocket.send(message);
  return true;
}

function sendCommand(cmd: string, timeoutMs = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!cliSocket || cliSocket.readyState !== WebSocket.OPEN) {
      reject(new Error("CLI not connected"));
      return;
    }
    const corrId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timeout = setTimeout(() => {
      pendingCommands.delete(corrId);
      reject(new Error(`Command timeout: ${cmd.slice(0, 50)}...`));
    }, timeoutMs);

    pendingCommands.set(corrId, { resolve, reject, timeout });
    cliSocket.send(JSON.stringify({ corrId, cmd }));
  });
}

// === Обработка входящих сообщений от CLI ===
async function handleCLIMessage(msg: any) {
  // Ответ на нашу команду (с corrId)
  if (msg.corrId && pendingCommands.has(msg.corrId)) {
    const pending = pendingCommands.get(msg.corrId)!;
    pendingCommands.delete(msg.corrId);
    clearTimeout(pending.timeout);

    if (msg.resp?.type === "error") {
      pending.reject(new Error(msg.resp.error?.text || "SimpleX CLI error"));
    } else {
      pending.resolve(msg.resp);
    }
    return;
  }

  // Событие (без corrId) — входящее сообщение или статус
  const resp = msg.resp;
  if (!resp) return;

  switch (resp.type) {
    case "newChatItems":
      // Новые сообщения в чатах
      for (const item of resp.chatItems || []) {
        await handleNewChatItem(item);
      }
      break;

    case "chatCleared":
      console.log(`[bridge] Chat cleared: ${resp.chatInfo?.chatId}`);
      break;

    case "userProfile":
      // Ответ на /_users
      if (!isInitialized && resp.userProfile?.userId) {
        activeProfile = resp.userProfile.userId;
        isInitialized = true;
        console.log(`[bridge] ✓ Active profile: ${activeProfile}`);
      }
      break;

    case "contactConnected":
      console.log(`[bridge] Contact connected: ${resp.contactInfo?.localDisplayName}`);
      await notifyBackend({
        event: "contact_connected",
        contactName: resp.contactInfo?.localDisplayName,
        contactProfile: resp.contactInfo,
      });
      break;

    case "contactDeleted":
      console.log(`[bridge] Contact deleted: ${resp.contactId}`);
      break;

    case "newContact":
      // Новый контакт запросил подключение (через business-адрес)
      console.log(`[bridge] New contact request: ${resp.newContact?.localDisplayName}`);
      await notifyBackend({
        event: "contact_request",
        contactName: resp.newContact?.localDisplayName,
        contactProfile: resp.newContact,
      });
      // Автоматически принимаем (для business-чата это нормально)
      break;

    default:
      // Игнорируем неизвестные события
      break;
  }
}

async function handleNewChatItem(item: any) {
  const chatInfo = item.chatInfo;
  if (!chatInfo) return;

  const msgContent = chatInfo.content;
  const msgType = msgContent?.type;
  const text = msgContent?.msgContent?.text || msgContent?.text;
  const fromContact = chatInfo.chatInfo?.fromContact?.displayName ||
                      chatInfo.chatInfo?.contactRef?.displayName ||
                      "Unknown";

  // Пропускаем служебные сообщения
  if (msgType === "hist") return;
  if (msgType === "call") return;

  // Извлекаем метаданные
  const meta = chatInfo.meta || {};
  const chatItemId = chatInfo.chatItemId || chatInfo.id;
  const chatId = chatInfo.chatInfo?.chatId || item.chatId;
  const itemTs = meta.itemTs || meta.internals?.createdAt;

  // Файлы (если есть)
  const files = msgContent?.msgContent?.file ?
    [{
      fileName: msgContent.msgContent.file.name,
      fileSize: msgContent.msgContent.file.size,
      fileType: msgContent.msgContent.file.type,
    }] : [];

  console.log(`[bridge] ← ${fromContact} (chat ${chatId}): ${text?.slice(0, 50) || `[${msgType}]`}...`);

  // Переслать в backend маркетплейса
  await notifyBackend({
    event: "message_received",
    simplexChatId: chatId,
    simplexMsgId: chatItemId,
    fromName: fromContact,
    text: text || null,
    messageType: msgType,
    files: files.length > 0 ? files : undefined,
    timestamp: itemTs ? new Date(itemTs).toISOString() : new Date().toISOString(),
    raw: chatInfo, // для отладки/дополнительных полей
  });
}

async function notifyBackend(payload: any) {
  if (!BACKEND_WEBHOOK) return;
  try {
    await axios.post(BACKEND_WEBHOOK, payload, {
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Api-Key": BACKEND_API_KEY,
      },
      timeout: 5000,
    });
    console.log(`[bridge] → backend notified: ${payload.event}`);
  } catch (err: any) {
    console.error(`[bridge] Backend webhook failed: ${err.message}`);
    // Не падаем — сообщение потеряно, но bridge продолжает работать
    // TODO: persist failed deliveries to disk for retry
  }
}

// === Старт ===
connectToCLI();

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[bridge] SIGTERM received, closing connections...");
  if (cliSocket) cliSocket.close();
  healthServer.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[bridge] SIGINT received, exiting...");
  process.exit(0);
});

console.log(`[bridge] SimpleX bridge started. CLI=${CLI_WS_URL}, Backend=${BACKEND_WEBHOOK}`);
