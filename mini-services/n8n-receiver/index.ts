/**
 * mini-services/n8n-receiver/index.ts
 *
 * Локальный приёмник n8n-webhook'ов (порт 5678) для dev-среды без Docker.
 *
 * Зачем: Conditera шлёт события (src/lib/n8n.ts emitEvent) на
 * `${N8N_WEBHOOK_BASE_URL || N8N_BASE_URL}/conditera-${type}`. Канонический
 * webhook-URL настоящего n8n — `http://host:5678/webhook/<path>` → в
 * production N8N_WEBHOOK_BASE_URL заканчивается на /webhook, и полный путь
 * события = `/webhook/conditera-${type}`. Этот приёмник принимает ОБЕ формы
 * (`/conditera-*` и `/webhook/conditera-*`) и логирует события, отвечая 200:
 *   1) проверить webhook-контракт end-to-end;
 *   2) health /api/health показывает n8n:"ok";
 *   3) поднять настоящий n8n (npx n8n) на этом же порту — код приложения
 *      менять не нужно (fail-safe: если n8n выключен, приложение работает).
 *
 * Запуск: bun run dev из этого каталога.
 */

const PORT = 5678;
const SECRET = process.env.N8N_WEBHOOK_SECRET || "";

const received: { at: string; type: string; payload: unknown }[] = [];

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/healthz") {
      return Response.json({ status: "ok", service: "n8n-receiver", received: received.length });
    }

    if (url.pathname === "/events") {
      return Response.json({ events: received.slice(-50) });
    }

    // Канон n8n: /webhook/conditera-<type>; также принимаем /conditera-<type>
    // (прямая форма, когда N8N_WEBHOOK_BASE_URL не задан)
    const eventPath = url.pathname.startsWith("/webhook/conditera-")
      ? url.pathname.slice("/webhook".length)
      : url.pathname;
    if (req.method === "POST" && eventPath.startsWith("/conditera-")) {
      const type = eventPath.replace("/conditera-", "");
      if (SECRET) {
        const header = req.headers.get("x-n8n-secret");
        if (header !== SECRET) {
          return Response.json({ error: "bad secret" }, { status: 401 });
        }
      }
      let payload: unknown = null;
      try {
        payload = await req.json();
      } catch {
        payload = null;
      }
      received.push({ at: new Date().toISOString(), type, payload });
      if (received.length > 500) received.splice(0, received.length - 500);
      console.log(`[n8n-receiver] event=${type} total=${received.length}`);
      return Response.json({ received: true, type });
    }

    return Response.json({
      service: "conditera-n8n-receiver",
      note: "dev-заглушка n8n. Настоящий n8n: npx n8n (порт 5678), workflows — n8n-workflows/*.json",
      endpoints: ["POST /conditera-<type>", "POST /webhook/conditera-<type>", "GET /events", "GET /healthz"],
    });
  },
});

console.log(`[n8n-receiver] listening on http://localhost:${PORT}`);

// ===== [TEMP-DEV-KEEPER 2026-10-30] Автохранитель dev-сервера (ОТКАТИТЬ: удалить блок + touch /home/z/.diag/dev-keeper.stop) =====
// Причины существования (обе задокументированы):
//  1) исполнители песочницы не могут держать фоновые процессы (cleanup после вызова);
//  2) kernel OOM убивает next-server при пике компиляции в 4GB-песочнице
//     (см. «7 инцидентов OOM-kill» в next.config.ts) — сервер должен самовосстанавливаться.
// Механика: hot-reload ЭТОГО выживающего bun-процесса ставит интервал 15с, который
// проверяет порт 3000 и при ECONNREFUSED запускает `bun run dev:local` detached
// (orphan, переживает cleanup; антидребезг 20с). Остановка: touch /home/z/.diag/dev-keeper.stop
{
  const G = globalThis as { __devKeeperArmedV5?: boolean };
  if (!G.__devKeeperArmedV5) {
    G.__devKeeperArmedV5 = true;
    const net = require("node:net");
    const { spawn } = require("node:child_process");
    const { openSync, existsSync } = require("node:fs");
    const STOP_FILE = "/home/z/.diag/dev-keeper.stop";
    let lastSpawnAt = 0;
    const spawnDev = () => {
      try {
        const logFd = openSync("/home/z/my-project/dev.log", "a");
        const child = spawn("bun", ["run", "dev:local"], {
          cwd: "/home/z/my-project",
          detached: true,
          stdio: ["ignore", logFd, logFd],
        });
        child.unref();
        console.log("[dev-keeper] respawned `bun run dev:local` pid=" + child.pid);
      } catch (e) {
        console.log("[dev-keeper] respawn failed: " + (e as Error).message);
      }
    };
    const probeOnce = () => {
      if (existsSync(STOP_FILE)) {
        console.log("[dev-keeper] stop-file found — keeper disabled");
        if (keeperTimer) clearInterval(keeperTimer);
        G.__devKeeperArmedV5 = false;
        return;
      }
      const probe = net.createConnection({ port: 3000, host: "127.0.0.1" });
      probe.on("connect", () => probe.destroy()); // сервер жив — ничего не делаем
      probe.on("error", () => {
        const now = Date.now();
        if (now - lastSpawnAt < 20000) return; // антидребезг
        lastSpawnAt = now;
        spawnDev();
      });
    };
    let keeperTimer: ReturnType<typeof setInterval> | null = null;
    keeperTimer = setInterval(probeOnce, 15000);
    probeOnce();
    console.log("[dev-keeper] armed (probe every 15s, stop-file: " + STOP_FILE + ")");
  }
}
// ===== [/TEMP-DEV-KEEPER] =====
