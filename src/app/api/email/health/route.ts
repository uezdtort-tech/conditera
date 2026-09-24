/**
 * GET /api/email/health — проверка статуса SMTP-соединения.
 */
import { NextResponse } from "next/server";
import { isEmailHealthy } from "@/lib/email";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const healthy = await isEmailHealthy();
  return NextResponse.json(
    {
      status: healthy ? "ok" : "unavailable",
      service: "email-smtp",
      configured: Boolean(
        process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD
      ),
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  );
}
