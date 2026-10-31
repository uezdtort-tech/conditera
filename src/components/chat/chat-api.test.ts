/**
 * chat-api.test.ts — ensureDirectRoom (прямой диалог покупатель↔кондитер).
 *
 * Контракт:
 *   - POST /api/chat/rooms {type:'direct', peerId} → { room } → мапнутая ChatRoom;
 *   - 401 → Error('unauthorized') (вызывающий код откроет auth-модалку);
 *   - прочие не-2xx → Error (не-JSON тело → generic-сообщение, без броска
 *     синтаксической ошибки из res.json()).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/api-client", () => ({
  getStoredAccessToken: () => "test-access-token",
  getCsrfToken: async () => "test-csrf-token",
}));

import { ensureDirectRoom } from "./chat-api";

const ROOM_PAYLOAD = {
  room: {
    id: "room-1",
    type: "direct",
    name: "Кондитер Анна",
    participants: [
      { id: "u-me", name: "Я" },
      { id: "u-peer", name: "Кондитер Анна" },
    ],
    unreadCount: 2,
    createdAt: "2025-01-01T00:00:00.000Z",
  },
};

function jsonRes(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureDirectRoom", () => {
  it("успех: POST {type:'direct', peerId} → возвращает мапнутую комнату", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonRes(200, JSON.stringify(ROOM_PAYLOAD))
    );
    vi.stubGlobal("fetch", fetchMock);

    const room = await ensureDirectRoom("u-peer");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/chat/rooms");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      type: "direct",
      peerId: "u-peer",
    });
    expect(room).toMatchObject({
      id: "room-1",
      type: "direct",
      name: "Кондитер Анна",
      unreadCount: 2,
    });
  });

  it("401 → Error('unauthorized')", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonRes(401, "Unauthorized"))
    );

    await expect(ensureDirectRoom("u-peer")).rejects.toThrow("unauthorized");
  });

  it("500 с не-JSON телом → generic Error (не падает на res.json)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>Bad Gateway</html>", {
          status: 500,
          headers: { "Content-Type": "text/html" },
        })
      )
    );

    await expect(ensureDirectRoom("u-peer")).rejects.toThrow(/500/);
  });
});
