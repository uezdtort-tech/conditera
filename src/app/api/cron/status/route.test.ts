import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const state = {
    user: null as null | { id: string; roles: string[] },
    storedValue: "[]",
    selectError: null as null | { message: string },
    upsertError: null as null | { message: string },
    upsertPayload: null as null | Record<string, unknown>,
  };
  const from = vi.fn((_table: string) => {
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: state.selectError ? null : { value: state.storedValue },
        error: state.selectError,
      })),
      upsert: vi.fn((payload: Record<string, unknown>) => {
        state.upsertPayload = payload;
        return query;
      }),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve({ error: state.upsertError }).then(resolve, reject),
    };
    return query;
  });
  return { state, from };
});

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("@/lib/auth", () => ({ getUserFromRequest: vi.fn(async () => mocks.state.user) }));

import { GET, POST } from "./route";

function request(method: "GET" | "POST", body?: unknown, cronSecret?: string) {
  return new NextRequest("https://conditera.test/api/cron/status", {
    method,
    headers: {
      ...(cronSecret ? { "X-Cron-Secret": cronSecret } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("cron status endpoint authorization and validation", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    mocks.state.user = null;
    mocks.state.storedValue = "[]";
    mocks.state.selectError = null;
    mocks.state.upsertError = null;
    mocks.state.upsertPayload = null;
    mocks.from.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects anonymous GET", async () => {
    expect((await GET(request("GET"))).status).toBe(401);
  });
  it("rejects a non-admin authenticated GET", async () => {
    mocks.state.user = { id: "customer-1", roles: ["CUSTOMER"] };
    expect((await GET(request("GET"))).status).toBe(403);
  });
  it("allows an active admin session to read cron history", async () => {
    mocks.state.user = { id: "admin-1", roles: ["ADMIN"] };
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ runs: [], total: 0 });
  });
  it("allows the machine cron secret to read cron history", async () => {
    expect((await GET(request("GET", undefined, "cron-test-secret"))).status).toBe(200);
  });
  it("does not silently convert an invalid status into success", async () => {
    const response = await POST(request("POST", { workflow: "backup", status: "garbage" }, "cron-test-secret"));
    expect(response.status).toBe(400);
    expect(mocks.state.upsertPayload).toBeNull();
  });
  it("rejects a negative duration", async () => {
    const response = await POST(request("POST", { workflow: "backup", status: "success", duration: -1 }, "cron-test-secret"));
    expect(response.status).toBe(400);
    expect(mocks.state.upsertPayload).toBeNull();
  });
  it("records only an explicitly valid status", async () => {
    const response = await POST(request("POST", { workflow: "backup", status: "success", duration: 10 }, "cron-test-secret"));
    expect(response.status).toBe(201);
    expect(mocks.state.upsertPayload).toMatchObject({ key: "cron_runs", category: "cron" });
    const saved = JSON.parse(String(mocks.state.upsertPayload?.value));
    expect(saved[0]).toMatchObject({ workflow: "backup", status: "success", duration: 10 });
  });
  it("fails closed when the cron history database is unavailable", async () => {
    mocks.state.selectError = { message: "database unavailable" };
    expect((await GET(request("GET", undefined, "cron-test-secret"))).status).toBe(500);
  });
});
