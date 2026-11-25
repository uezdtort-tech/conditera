import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

/**
 * certification-reminders is intentionally disabled until its business logic, persistence,
 * idempotency and end-to-end acceptance scenarios are implemented.
 * Never report a successful zero-work run for an unimplemented worker.
 */
export async function GET(req: NextRequest): Promise<NextResponse | Response> {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  console.warn("[cron/certification-reminders] worker is not implemented; refusing execution");
  return NextResponse.json(
    { ok: false, error: "not_implemented", worker: "certification-reminders" },
    { status: 501, headers: { "Cache-Control": "no-store" } },
  );
}
