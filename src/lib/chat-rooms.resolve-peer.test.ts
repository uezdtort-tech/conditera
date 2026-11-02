/**
 * chat-rooms.resolveDirectPeer — резолв пира для direct-комнаты.
 *
 * Контракт (P1 «чат после reload», первопричина 400 'peerId должен быть UUID'):
 *   - peerId UUID → возвращается как есть (прямая ссылка на пользователя);
 *   - confectionerId (id профиля, напр. 'c2') → сервер резолвит confectioners.userId;
 *     клиентский store может держать mock-снимок кондитера (userId 'u0'..'u8')
 *     с теми же id, что и в реальной БД — доверять ему нельзя;
 *   - confectionerId не найден → HttpError 404;
 *   - сбой БД → HttpError 500 (fail-closed);
 *   - ничего не передано → пустая строка (роут отдаст 400 UUID-проверкой).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpError } from "@/lib/http-helpers";

const { mockFrom, setMockData } = vi.hoisted(() => {
  let _mockData: { data: unknown; error: unknown } | null = null;
  const setMockData = (data: unknown, error: unknown = null) => {
    _mockData = { data, error };
  };
  const maybeSingle = vi.fn(() => Promise.resolve(_mockData || { data: null, error: null }));
  const mockFrom = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        limit: vi.fn(() => ({ maybeSingle })),
      })),
    })),
  }));
  return { mockFrom, setMockData, maybeSingle };
});

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

import { resolveDirectPeer } from "./chat-rooms";

const CONF_USER_ID = "11111111-1111-4111-8111-111111111103";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  setMockData(null, null);
  vi.clearAllMocks();
});

describe("resolveDirectPeer", () => {
  it("UUID peerId возвращается как есть (запроса в БД нет)", async () => {
    const peer = await resolveDirectPeer({ peerId: OTHER_USER_ID });
    expect(peer).toBe(OTHER_USER_ID);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("confectionerId резолвится в confectioners.userId", async () => {
    setMockData({ userId: CONF_USER_ID });
    const peer = await resolveDirectPeer({ peerId: null, confectionerId: "c2" });
    expect(peer).toBe(CONF_USER_ID);
    expect(mockFrom).toHaveBeenCalledWith("confectioners");
  });

  it("неизвестный confectionerId → HttpError 404 (не угадываем)", async () => {
    setMockData(null);
    await expect(resolveDirectPeer({ confectionerId: "nope" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("пустой userId профиля → HttpError 404", async () => {
    setMockData({ userId: "" });
    await expect(resolveDirectPeer({ confectionerId: "c2" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("сбой БД → HttpError 500 (fail-closed)", async () => {
    setMockData(null, { message: "Connection refused" });
    await expect(resolveDirectPeer({ confectionerId: "c2" })).rejects.toBeInstanceOf(HttpError);
    await expect(resolveDirectPeer({ confectionerId: "c2" })).rejects.toMatchObject({
      status: 500,
    });
  });

  it("peerId и confectionerId пусты → пустая строка (400 на стороне роута)", async () => {
    const peer = await resolveDirectPeer({});
    expect(peer).toBe("");
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
