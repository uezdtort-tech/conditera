import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as certificationReminders } from "./certification-reminders/route";
import { GET as franchiseeReports } from "./franchisee-reports/route";
import { GET as ppCertificationCheck } from "./pp-certification-check/route";
import { GET as qualityInspections } from "./quality-inspections/route";
import { GET as tasterAssignment } from "./taster-assignment/route";

const workers = [
  ["certification-reminders", certificationReminders],
  ["franchisee-reports", franchiseeReports],
  ["pp-certification-check", ppCertificationCheck],
  ["quality-inspections", qualityInspections],
  ["taster-assignment", tasterAssignment],
] as const;

function request(worker: string, authorized: boolean): NextRequest {
  return new NextRequest("https://conditera.test/api/cron/" + worker, {
    headers: authorized ? { "X-Cron-Secret": "cron-test-secret" } : {},
  });
}

describe("disabled cron workers fail honestly", () => {
  beforeEach(() => vi.stubEnv("CRON_SECRET", "cron-test-secret"));
  afterEach(() => vi.unstubAllEnvs());

  it.each(workers)("%s requires the cron secret", async (worker, handler) => {
    const response = await handler(request(worker, false));
    expect(response.status).toBe(401);
  });

  it.each(workers)("%s returns 501 instead of a fake successful zero-work result", async (worker, handler) => {
    const response = await handler(request(worker, true));
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ ok: false, error: "not_implemented", worker });
  });
});
