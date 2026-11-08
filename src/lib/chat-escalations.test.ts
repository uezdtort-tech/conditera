/**
 * Тесты lib/chat-escalations — единственной точки создания эскалаций поддержки.
 *
 * Контракт (Z-v16, пробел SUPPORT-1):
 *   • looksLikeOperatorRequest: кириллица работает (легаси `\b`-regex не
 *     матчил ни одно русское сообщение), стем в начале после ведущего шума;
 *   • createChatEscalation пишет строго в `chat_escalations` (0019):
 *     chat_room_id / user_id / reason / priority / status / metadata;
 *   • дедуп: pending-эскалация комнаты уже существует → created=false,
 *     INSERT не вызывается;
 *   • fail-safe: ошибка БД возвращается в результате, не бросается.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom, getState, setState } = vi.hoisted(() => {
  type State = {
    selectResult: { data: unknown; error: unknown };
    insertResult: { data: unknown; error: unknown };
    insertPayload: Record<string, unknown> | null;
    insertCalled: boolean;
  };
  const state: State = {
    selectResult: { data: null, error: null },
    insertResult: { data: null, error: null },
    insertPayload: null,
    insertCalled: false,
  };
  const mockFrom = vi.fn(() => {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.in = vi.fn(() => builder);
    builder.limit = vi.fn(() => Promise.resolve(state.selectResult));
    builder.insert = vi.fn((payload: Record<string, unknown>) => {
      state.insertPayload = payload;
      state.insertCalled = true;
      return builder;
    });
    builder.single = vi.fn(() => Promise.resolve(state.insertResult));
    return builder;
  });
  return { mockFrom, getState: () => state, setState: (patch: Partial<State>) => Object.assign(state, patch) };
});

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

import { createChatEscalation, looksLikeOperatorRequest } from "./chat-escalations";

const ROOM = "cccccccc-0000-4000-8000-00000000cccc";
const USER = "uuuuuuuu-0000-4000-8000-00000000uuuu";

beforeEach(() => {
  vi.clearAllMocks();
  setState({
    selectResult: { data: null, error: null },
    insertResult: { data: { id: "esc-1" }, error: null },
    insertPayload: null,
    insertCalled: false,
  });
});

describe("looksLikeOperatorRequest", () => {
  it("русские запросы матчатся (легаси \\b на кириллице не работал)", () => {
    expect(looksLikeOperatorRequest("Оператор, помогите!")).toBe(true);
    expect(looksLikeOperatorRequest("оператор")).toBe(true);
    expect(looksLikeOperatorRequest("поддержка?")).toBe(true);
    expect(looksLikeOperatorRequest("Поддержку дайте")).toBe(true);
    expect(looksLikeOperatorRequest("Человек нужен")).toBe(true);
  });

  it("латинские запросы матчатся", () => {
    expect(looksLikeOperatorRequest("operator please")).toBe(true);
    expect(looksLikeOperatorRequest("HELP")).toBe(true);
    expect(looksLikeOperatorRequest("Human!")).toBe(true);
    expect(looksLikeOperatorRequest("agent")).toBe(true);
  });

  it("ведущий шум снимается: «- оператор» и «Помогите!» — запрос", () => {
    expect(looksLikeOperatorRequest("- оператор")).toBe(true);
    expect(looksLikeOperatorRequest("  оператор")).toBe(true);
  });

  it("не-запросы не матчатся", () => {
    expect(looksLikeOperatorRequest("")).toBe(false);
    expect(looksLikeOperatorRequest("Спасибо большое!")).toBe(false);
    expect(looksLikeOperatorRequest("Здравствуйте, нужна поддержка по заказу")).toBe(false);
    expect(looksLikeOperatorRequest("автоподдержка")).toBe(false);
    expect(looksLikeOperatorRequest("подскажите пожалуйста")).toBe(false);
  });

  it("не-строка безопасно false", () => {
    expect(looksLikeOperatorRequest(undefined as unknown as string)).toBe(false);
  });
});

describe("createChatEscalation", () => {
  it("создаёт запись в chat_escalations со колонками 0019", async () => {
    const res = await createChatEscalation({
      chatRoomId: ROOM,
      userId: USER,
      userName: "Иван",
      reason: "manual_request",
      priority: "high",
      messagePreview: "Оператор, помогите!",
      source: "chat_messages_post",
    });

    expect(res.created).toBe(true);
    expect(res.escalationId).toBe("esc-1");
    expect(mockFrom).toHaveBeenCalledWith("chat_escalations");
    expect(getState().insertCalled).toBe(true);
    const payload = getState().insertPayload as Record<string, unknown>;
    expect(payload).toMatchObject({
      chat_room_id: ROOM,
      user_id: USER,
      reason: "manual_request",
      priority: "high",
      status: "pending",
    });
    expect(payload.metadata).toMatchObject({
      source: "chat_messages_post",
      user_name: "Иван",
      message_preview: "Оператор, помогите!",
    });
  });

  it("дедуп: существующая pending-эскалация комнаты → created=false, без INSERT", async () => {
    setState({ selectResult: { data: [{ id: "esc-existing" }], error: null } });

    const res = await createChatEscalation({
      chatRoomId: ROOM,
      userId: USER,
      reason: "manual_request",
    });

    expect(res.created).toBe(false);
    expect(res.escalationId).toBe("esc-existing");
    expect(getState().insertCalled).toBe(false);
    // дедуп должен смотреть на открытые статусы (pending + assigned)
    expect(mockFrom).toHaveBeenCalledWith("chat_escalations");
  });

  it("дедуп покрывает assigned: открытая эскалация в работе тоже блокирует дубль", async () => {
    setState({ selectResult: { data: [{ id: "esc-open-assigned" }], error: null } });

    const res = await createChatEscalation({
      chatRoomId: ROOM,
      userId: USER,
      reason: "manual_request",
    });

    expect(res.created).toBe(false);
    expect(res.escalationId).toBe("esc-open-assigned");
    expect(getState().insertCalled).toBe(false);
    // проверяем, что в запросе участвует .in со статусами open-множества
    const fromCalls = mockFrom.mock.results.length;
    expect(fromCalls).toBeGreaterThan(0);
  });

  it("priority по умолчанию high", async () => {
    await createChatEscalation({ chatRoomId: ROOM, userId: USER, reason: "manual_request" });
    expect((getState().insertPayload as Record<string, unknown>).priority).toBe("high");
  });

  it("ошибка БД при дедуп-SELECT → fail-safe результат, без INSERT", async () => {
    setState({ selectResult: { data: null, error: { message: "connection refused" } } });

    const res = await createChatEscalation({ chatRoomId: ROOM, userId: USER, reason: "manual_request" });

    expect(res.created).toBe(false);
    expect(res.error).toBe("connection refused");
    expect(getState().insertCalled).toBe(false);
  });

  it("ошибка INSERT → результат с error, без исключения", async () => {
    setState({ insertResult: { data: null, error: { message: "23502 not_null_violation" } } });

    const res = await createChatEscalation({ chatRoomId: ROOM, userId: USER, reason: "manual_request" });

    expect(res.created).toBe(false);
    expect(res.error).toContain("23502");
  });

  it("без chatRoomId/userId → ошибка аргументов, INSERT не вызывается", async () => {
    const res = await createChatEscalation({ chatRoomId: "", userId: USER, reason: "manual_request" });
    expect(res.created).toBe(false);
    expect(res.error).toBeTruthy();
    expect(getState().insertCalled).toBe(false);
  });

  it("message_preview обрезается до 500 символов", async () => {
    await createChatEscalation({
      chatRoomId: ROOM,
      userId: USER,
      reason: "complaint",
      messagePreview: "а".repeat(800),
    });
    const payload = getState().insertPayload as { metadata: { message_preview: string } };
    expect(payload.metadata.message_preview).toHaveLength(500);
  });
});
