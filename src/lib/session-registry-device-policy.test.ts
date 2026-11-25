// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  previousSessions: [] as Array<{ id: string; ip_address: string | null; user_agent: string | null }>,
  historyError: null as { message: string } | null,
  fromCalls: [] as string[],
  inserts: [] as Array<{ table: string; value: unknown }>,
  upserts: [] as Array<{ table: string; value: unknown; options: unknown }>,
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocked.from,
    rpc: mocked.rpc,
  },
}));

import {
  createUserSession,
  NEW_DEVICE_LOGIN_BLOCKED,
  SESSION_POLICY_UNAVAILABLE,
} from "@/lib/session-registry";

function configureDatabase() {
  mocked.from.mockImplementation((table: string) => {
    let query: any;
    query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      gt: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      insert: vi.fn((value: unknown) => {
        mocked.inserts.push({ table, value });
        return Promise.resolve({ error: null });
      }),
      upsert: vi.fn((value: unknown, options: unknown) => {
        mocked.upserts.push({ table, value, options });
        return Promise.resolve({ error: null });
      }),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(
          table === "user_sessions"
            ? { data: mocked.previousSessions, error: mocked.historyError }
            : { data: null, error: null },
        ).then(resolve, reject),
    };
    return query;
  });
}

describe("personal account device-transfer protection", () => {
  beforeEach(() => {
    mocked.previousSessions = [];
    mocked.historyError = null;
    mocked.fromCalls = [];
    mocked.inserts = [];
    mocked.upserts = [];
    mocked.rpc.mockReset();
    mocked.rpc.mockResolvedValue({ data: 0, error: null });
    mocked.from.mockReset();
    configureDatabase();
  });

  it("blocks a new device while preserving the existing active session", async () => {
    mocked.previousSessions = [{
      id: "existing-session",
      ip_address: "192.0.2.10",
      user_agent: "Existing browser",
    }];

    await expect(createUserSession(
      "user-1",
      new Request("https://conditera.test/api/auth/login", {
        headers: {
          "x-forwarded-for": "192.0.2.20",
          "user-agent": "Different browser",
        },
      }),
      "password",
    )).rejects.toThrow(NEW_DEVICE_LOGIN_BLOCKED);

    expect(mocked.inserts.some((x) => x.table === "user_sessions")).toBe(false);
    expect(mocked.inserts).toContainEqual(expect.objectContaining({
      table: "user_security_events",
      value: expect.objectContaining({
        event_type: "new_device_login_blocked",
        session_id: null,
        severity: "warning",
      }),
    }));
    expect(mocked.inserts).toContainEqual(expect.objectContaining({
      table: "notifications",
      value: expect.objectContaining({ type: "security_alert" }),
    }));
    expect(mocked.upserts).toContainEqual(expect.objectContaining({
      table: "ops_tasks",
      value: expect.objectContaining({ type: "ACCOUNT_NEW_DEVICE" }),
    }));
    expect(mocked.rpc).not.toHaveBeenCalled();
  });

  it("does not trust a missing user-agent as a known device", async () => {
    mocked.previousSessions = [{
      id: "existing-session",
      ip_address: "192.0.2.10",
      user_agent: null,
    }];

    await expect(createUserSession(
      "user-1",
      new Request("https://conditera.test/api/auth/login", {
        headers: { "x-forwarded-for": "192.0.2.10" },
      }),
      "password",
    )).rejects.toThrow(NEW_DEVICE_LOGIN_BLOCKED);

    expect(mocked.inserts.some((x) => x.table === "user_sessions")).toBe(false);
  });

  it("fails closed when active-session history cannot be read", async () => {
    mocked.historyError = { message: "database unavailable" };

    await expect(createUserSession(
      "user-1",
      new Request("https://conditera.test/api/auth/login", {
        headers: { "user-agent": "Browser" },
      }),
      "password",
    )).rejects.toThrow(SESSION_POLICY_UNAVAILABLE);

    expect(mocked.inserts).toHaveLength(0);
    expect(mocked.upserts).toHaveLength(0);
    expect(mocked.rpc).not.toHaveBeenCalled();
  });

  it("allows the same known device to create a replacement session", async () => {
    mocked.previousSessions = [{
      id: "existing-session",
      ip_address: "192.0.2.10",
      user_agent: "Known browser",
    }];

    const sessionId = await createUserSession(
      "user-1",
      new Request("https://conditera.test/api/auth/login", {
        headers: {
          "x-forwarded-for": "192.0.2.20",
          "user-agent": "Known browser",
        },
      }),
      "password",
    );

    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(mocked.inserts.some((x) => x.table === "user_sessions")).toBe(true);
    expect(mocked.rpc).toHaveBeenCalledWith(
      "enforce_single_active_user_session",
      expect.objectContaining({ p_user_id: "user-1", p_session_id: sessionId }),
    );
  });
});
