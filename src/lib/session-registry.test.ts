// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  result: { data: { id: "session-1" }, error: null as { message: string } | null },
  from: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  filters: [] as Array<[string, ...unknown[]]>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocked.from },
}));

type Query = {
  update(value: unknown): Query;
  eq(...args: unknown[]): Query;
  is(...args: unknown[]): Query;
  gt(...args: unknown[]): Query;
  select(...args: unknown[]): Query;
  maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
  insert(value: unknown): Promise<{ error: null }>;
};
const query: Query = {
  update: (value) => { mocked.update(value); return query; },
  eq: (...args) => { mocked.filters.push(["eq", ...args]); return query; },
  is: (...args) => { mocked.filters.push(["is", ...args]); return query; },
  gt: (...args) => { mocked.filters.push(["gt", ...args]); return query; },
  select: (...args) => { mocked.filters.push(["select", ...args]); return query; },
  maybeSingle: () => Promise.resolve(mocked.result),
  insert: (value) => { mocked.insert(value); return Promise.resolve({ error: null }); },
};

vi.mocked(mocked.from).mockImplementation(() => query as never);

import { rotateSessionRefreshJti, setSessionRefreshJti } from "@/lib/session-registry";

describe("session refresh-token rotation", () => {
  beforeEach(() => {
    mocked.result = { data: { id: "session-1" }, error: null };
    mocked.from.mockClear();
    mocked.update.mockClear();
    mocked.insert.mockClear();
    mocked.filters = [];
  });

  it("stores the initial refresh JTI before a token is issued", async () => {
    await setSessionRefreshJti("session-1", "user-1", "jti-first");

    expect(mocked.from).toHaveBeenCalledWith("user_sessions");
    expect(mocked.update).toHaveBeenCalledWith({ refresh_jti: "jti-first" });
    expect(mocked.filters).toContainEqual(["eq", "id", "session-1"]);
    expect(mocked.filters).toContainEqual(["eq", "user_id", "user-1"]);
    expect(mocked.filters).toContainEqual(["is", "revoked_at", null]);
  });

  it("allows only the currently stored JTI to rotate", async () => {
    await expect(
      rotateSessionRefreshJti("session-1", "user-1", "jti-first", "jti-second"),
    ).resolves.toBe(true);

    expect(mocked.update).toHaveBeenCalledWith(
      expect.objectContaining({ refresh_jti: "jti-second" }),
    );
    expect(mocked.filters).toContainEqual(["eq", "refresh_jti", "jti-first"]);
    expect(mocked.filters).toContainEqual(["eq", "id", "session-1"]);
    expect(mocked.filters).toContainEqual(["eq", "user_id", "user-1"]);
    expect(mocked.filters).toContainEqual(["is", "revoked_at", null]);
  });

  it("rejects replay when the compare-and-swap updates no row", async () => {
    mocked.result = { data: null, error: null };

    await expect(
      rotateSessionRefreshJti("session-1", "user-1", "already-used", "jti-next"),
    ).resolves.toBe(false);
    expect(mocked.from).toHaveBeenCalledWith("user_security_events");
    expect(mocked.insert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "refresh_replay_detected", severity: "warning" }),
    );
  });

  it("fails closed when the database rejects rotation", async () => {
    mocked.result = { data: null, error: { message: "database unavailable" } };

    await expect(
      rotateSessionRefreshJti("session-1", "user-1", "jti-old", "jti-new"),
    ).resolves.toBe(false);
  });
});
