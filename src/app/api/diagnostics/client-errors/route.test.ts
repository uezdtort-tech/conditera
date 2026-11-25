/**
 * Тесты POST /api/diagnostics/client-errors — ingest клиентских ошибок
 * (ZV31-006). Проверяется РЕАЛЬНОЕ поведение маршрута и его коллабораторов:
 * event-store (fire-and-forget, очередь), masking (двойное маскирование),
 * rate-limit (in-memory sliding window 20/мин/IP), fingerprint.
 *
 * Моки: только граница БД (@/lib/postgrest/pool → queryMock) и Telegram
 * (notifyChannel) — по образцу src/lib/diagnostics/event-store.test.ts.
 * Всё, что попадает в store, проверяется по фактическим INSERT-параметрам
 * app_error_events после flushQueueForTests().
 *
 * Контракт маршрута:
 *   • валидный event → 202 {ok, fingerprint}, INSERT component='frontend',
 *     source='client', stack_trace=NULL (клиентский стек не сохраняется);
 *   • пустое тело → 400; невалидный JSON → 400; message отсутствует/длиннее
 *     400 → 400; payload > 16KB → 413 — store НЕ вызывается;
 *   • rate limit 20/мин/IP → 429 + Retry-After, окно скользящее (сброс по
 *     истечении 60с); лимит считается ДО записи (запись блокируется тоже);
 *   • секреты: лишние поля payload (password/apiKey/authorization) отбрасываются
 *     allowlist'ом; Bearer/JWT/карта в message → [REDACTED] ДО записи;
 *     сырой IP не сохраняется (только ipHash);
 *   • сбой канала записи → маршрут всё равно 202 (fail-open, без 500-утечки);
 *   • ошибки 4xx не содержат stack traces / внутренних путей.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// --- Мок границы БД (реальный event-store + masking работают по-настоящему) ---
const queryMock = vi.fn();
const notifyChannelMock = vi.fn();

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({ query: queryMock }),
}));

vi.mock("@/lib/telegram-bot", () => ({
  notifyChannel: (...args: unknown[]) => notifyChannelMock(...args),
}));

import { POST } from "./route";
import {
  __resetStoreForTests,
  __resetPoolCacheForTests,
  flushQueueForTests,
} from "@/lib/diagnostics/event-store";
import { CLIENT_PAYLOAD_MAX_BYTES, CLIENT_MESSAGE_MAX } from "@/lib/diagnostics/capture";

/** Уникальный IP на тест: in-memory rate-limit живёт в module-global бакетах. */
function makePost(body: unknown | string, ip: string): NextRequest {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new NextRequest("http://localhost:3000/api/diagnostics/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": ip },
    body: raw,
  });
}

const VALID_EVENT = { message: "TypeError: cannot read properties of undefined" };

/** INSERT-вызовы app_error_events (не инцидент-upsert'ы). */
function eventInserts(): unknown[][] {
  return queryMock.mock.calls
    .filter((c) => String(c[0]).includes("app_error_events"))
    .map((c) => c[1] as unknown[]);
}

beforeEach(() => {
  __resetStoreForTests();
  __resetPoolCacheForTests();
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });
  notifyChannelMock.mockReset();
});

describe("POST /api/diagnostics/client-errors — валидация и 202", () => {
  it("валидный минимальный event → 202 {ok, fingerprint}, запись component=frontend/source=client", async () => {
    const res = await POST(makePost(VALID_EVENT, "10.1.0.1"));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean; fingerprint: string };
    expect(body.ok).toBe(true);
    // fingerprint — sha256 hex (40 символов), пригоден для корреляции с инцидентом
    expect(body.fingerprint).toMatch(/^[0-9a-f]{40}$/);

    await flushQueueForTests();
    const rows = eventInserts();
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<number, unknown>;
    expect(row[5]).toBe("frontend"); // клиент не может подменить компонент
    expect(row[15]).toBe("client");
    expect(row[13]).toBeNull(); // клиентский stack НЕ сохраняется
    expect(row[8]).toBe(VALID_EVENT.message);
  });

  it("route не начинающийся с '/' → сохраняется как null (не путь)", async () => {
    const res = await POST(
      makePost({ message: "err", route: "https://evil.example.com/x" }, "10.1.0.2")
    );
    expect(res.status).toBe(202);
    await flushQueueForTests();
    const rows = eventInserts();
    expect(rows[0]?.[11]).toBeNull();
  });

  it("severity critical от клиента принижается до error; warning сохраняется", async () => {
    await POST(makePost({ message: "a", severity: "critical" }, "10.1.0.3"));
    await POST(makePost({ message: "b", severity: "warning" }, "10.1.0.4"));
    await flushQueueForTests();
    const rows = eventInserts();
    expect(rows[0]?.[6]).toBe("error");
    expect(rows[1]?.[6]).toBe("warning");
  });
});

describe("POST /api/diagnostics/client-errors — 4xx без записи в store", () => {
  it.each([
    ["пустое тело", "", 400],
    ["невалидный JSON", "not-json{", 400],
    ["message отсутствует", JSON.stringify({ route: "/" }), 400],
    [
      `message длиннее ${CLIENT_MESSAGE_MAX}`,
      JSON.stringify({ message: "x".repeat(CLIENT_MESSAGE_MAX + 1) }),
      400,
    ],
  ])("%s → %i, store не вызывается", async (_label, raw, expected) => {
    const res = await POST(makePost(raw, "10.2.0.1"));
    expect(res.status).toBe(expected);
    await flushQueueForTests();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it(`payload > ${CLIENT_PAYLOAD_MAX_BYTES} символов → 413, store не вызывается`, async () => {
    const big = JSON.stringify({ message: "x", padding: "y".repeat(20000) });
    expect(big.length).toBeGreaterThan(CLIENT_PAYLOAD_MAX_BYTES);
    const res = await POST(makePost(big, "10.2.0.2"));
    expect(res.status).toBe(413);
    await flushQueueForTests();
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/diagnostics/client-errors — rate limit 20/мин/IP (реальный limiter)", () => {
  it("21-й запрос с одного IP → 429 + Retry-After, запись не выполняется", async () => {
    const ip = "10.3.33.33";
    // Разные message → разные fingerprint (не задействуем per-fingerprint лимит store)
    for (let i = 0; i < 20; i++) {
      const res = await POST(makePost({ message: `burst ${i}` }, ip));
      expect(res.status).toBe(202);
    }
    const blocked = await POST(makePost({ message: "blocked" }, ip));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(await blocked.json()).toEqual({ error: "Слишком много запросов" });

    // 429-й запрос не дошёл до store (20 записей от первых двадцати)
    await flushQueueForTests();
    expect(eventInserts()).toHaveLength(20);
  });

  it("другой IP не затронут лимитом первого (изоляция по ключу diagnostics:client:<ip>)", async () => {
    const exhausted = "10.3.44.44";
    for (let i = 0; i < 20; i++) {
      await POST(makePost({ message: `flood ${i}` }, exhausted));
    }
    expect((await POST(makePost({ message: "over" }, exhausted))).status).toBe(429);
    expect((await POST(makePost({ message: "другой клиент" }, "10.3.44.45"))).status).toBe(202);
  });

  it("скользящее окно: после истечения 60с тот же IP принимается снова", async () => {
    const ip = "10.3.55.55";
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    try {
      for (let i = 0; i < 20; i++) {
        const res = await POST(makePost({ message: `window ${i}` }, ip));
        expect(res.status).toBe(202);
      }
      expect((await POST(makePost({ message: "over window" }, ip))).status).toBe(429);
      vi.advanceTimersByTime(61_000);
      const afterWindow = await POST(makePost({ message: "after window" }, ip));
      expect(afterWindow.status).toBe(202);
    } finally {
      vi.useRealTimers();
    }
    await flushQueueForTests();
  });
});

describe("POST /api/diagnostics/client-errors — маскирование до записи", () => {
  it("секреты в message (Bearer/JWT/карта) → [REDACTED] в записанной строке", async () => {
    const bearer = "Bearer supersecrettokenvalue123456";
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.K3t0k3ns3cr3t";
    const card = "4111111111111111";
    const res = await POST(
      makePost(
        { message: `Не удалось войти: ${bearer}; token=${jwt}; карта ${card} отклонена` },
        "10.4.0.1"
      )
    );
    expect(res.status).toBe(202);
    await flushQueueForTests();

    const rows = eventInserts();
    expect(rows).toHaveLength(1);
    const storedMessage = String(rows[0]?.[8]);
    expect(storedMessage).toContain("[REDACTED]");
    expect(storedMessage).not.toContain("supersecrettokenvalue123456");
    expect(storedMessage).not.toContain(jwt);
    expect(storedMessage).not.toContain(card);
    // лог-инъекция: переводы строк нормализованы (одна строка = одна запись)
    expect(storedMessage).not.toMatch(/[\r\n]/);
  });

  it("лишние поля payload (password/apiKey/authorization) отбрасываются allowlist'ом и не сохраняются", async () => {
    const passwordValue = "hunter2-super-password";
    const apiKeyValue = ["sk", "live", "51HxT9s2D3f4G5h6J7k8"].join("_");
    const authValue = "Bearer authorization-header-value-123";
    const res = await POST(
      makePost(
        {
          message: "Ошибка формы оплаты",
          password: passwordValue,
          apiKey: apiKeyValue,
          authorization: authValue,
          cookies: { session: "steal" },
        },
        "10.4.0.2"
      )
    );
    expect(res.status).toBe(202);
    await flushQueueForTests();

    const rows = eventInserts();
    expect(rows).toHaveLength(1);
    const allParams = JSON.stringify(rows[0]);
    expect(allParams).not.toContain(passwordValue);
    expect(allParams).not.toContain(apiKeyValue);
    expect(allParams).not.toContain(authValue);
    expect(allParams).not.toContain("steal");
  });

  it("userAgentShort маскируется; сырой IP не сохраняется — только ipHash", async () => {
    const res = await POST(
      makePost(
        {
          message: "render error",
          userAgentShort: "Mozilla/5.0 Bearer ua-secret-token-987654",
        },
        "10.4.0.3"
      )
    );
    expect(res.status).toBe(202);
    await flushQueueForTests();

    const rows = eventInserts();
    const metadataJson = String(rows[0]?.[17]);
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    // userAgent прошёл maskString: Bearer-токен заменён, сырой не сохранён
    expect(metadataJson).not.toContain("ua-secret-token-987654");
    expect(JSON.stringify(parsed)).toContain("[REDACTED]");
    // PII-минимизация: ipHash 16 hex, сырого IP в записи нет
    expect(String(parsed.ipHash)).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(rows[0])).not.toContain("10.4.0.3");
  });
});

describe("POST /api/diagnostics/client-errors — fail-open (сбой store не роняет маршрут)", () => {
  it("канал записи недоступен (pool.query отклоняется) → всё равно 202 {ok:true}, без 500", async () => {
    queryMock.mockRejectedValue(new Error("db connection refused"));
    const res = await POST(makePost(VALID_EVENT, "10.5.0.1"));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    // сбой записи не утёк в ответ (нет деталей ошибки/стека)
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("db connection refused");
    expect(raw).not.toContain("stack");
  });
});

describe("POST /api/diagnostics/client-errors — форма ошибок без утечек", () => {
  it.each([
    ["400 пустое тело", ""],
    ["400 невалидный JSON", "not-json{"],
    ["413 oversized", JSON.stringify({ message: "x", padding: "y".repeat(20000) })],
  ])("%s — тело ответа только {error: string}, без stack/путей", async (_label, raw) => {
    const res = await POST(makePost(raw, "10.6.0.1"));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["error"]);
    expect(typeof body.error).toBe("string");
    expect(text).not.toMatch(/at\s+\S+\s+\(/); // stack frames
    expect(text).not.toContain("/home/z");
    expect(text).not.toContain("node_modules");
    expect(text).not.toContain("file://");
  });
});
