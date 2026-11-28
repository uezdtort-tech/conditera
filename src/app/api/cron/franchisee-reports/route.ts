import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

/**
 * franchisee-reports is intentionally disabled until its business logic, persistence,
 * idempotency and end-to-end acceptance scenarios are implemented.
 * Never report a successful zero-work run for an unimplemented worker.
 */
export async function GET(req: NextRequest): Promise<NextResponse | Response> {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  console.warn("[cron/franchisee-reports] worker is not implemented; refusing execution");
  return NextResponse.json(
    { ok: false, error: "not_implemented", worker: "franchisee-reports" },
    { status: 501, headers: { "Cache-Control": "no-store" } },
  );
}
