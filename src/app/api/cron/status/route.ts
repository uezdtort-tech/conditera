/**
 * GET  /api/cron/status            — list recent cron run logs
 * POST /api/cron/status            — record a cron run (called by n8n after each workflow)
 *
 * Stores the most recent 50 cron run summaries in a `site_settings` row
 * (key: cron_runs), so the admin dashboard can show execution history.
 *
 * Auth: X-Cron-Secret header (CRON_SECRET env var)
 *
 * Соответствует таблице: site_settings (миграция 0001)
 * Использует supabase-js напрямую (v2.0, без Prisma shim).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

const SETTING_KEY = "cron_runs";
const MAX_LOGS = 50;

interface CronRun {
  workflow: string;
  status: "success" | "failed" | "running";
  timestamp: string;
  duration?: number;
  sent?: number;
  notified?: number;
  totalPoints?: number;
  errorMessage?: string;
}

/**
 * Загрузить последние записи cron из site_settings.
 */
async function loadCronRuns(): Promise<CronRun[]> {
  const { data, error } = await supabaseAdmin
    .from("site_settings")
    .select("value")
    .eq("key", SETTING_KEY)
    .maybeSingle();

  if (error || !data) {
    return [];
  }

  try {
    const parsed = JSON.parse(data.value as string);
    if (Array.isArray(parsed)) {
      return parsed as CronRun[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Сохранить массив cron-записей в site_settings через upsert.
 */
async function saveCronRuns(runs: CronRun[]): Promise<void> {
  const { error } = await supabaseAdmin
    .from("site_settings")
    .upsert(
      {
        key: SETTING_KEY,
        value: JSON.stringify(runs),
        category: "cron",
        description: "Cron workflow execution logs (last 50)",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );

  if (error) {
    console.error("[cron/status] save error:", error.message);
    throw error;
  }
}

/**
 * GET /api/cron/status — вернуть список последних cron runs.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Allow both CRON_SECRET and admin JWT for this endpoint
  const isCron = verifyCronSecret(req);
  if (!isCron) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new NextResponse(cronUnauthorized().body, {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    // TODO: verify admin JWT and check role IN ('ADMIN', 'SUPER_ADMIN')
  }

  try {
    const runs = await loadCronRuns();
    return NextResponse.json({ runs, total: runs.length });
  } catch (error: any) {
    console.error("GET /api/cron/status error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", details: error?.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cron/status — записать cron run в лог.
 * Тело запроса:
 *  {
 *    "workflow": "abandoned-cart",
 *    "status": "success",
 *    "duration": 1234,
 *    "sent": 15,
 *    "notified": 14,
 *    "errorMessage": null
 *  }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(req)) {
    return new NextResponse(cronUnauthorized().body, {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const newRun: CronRun = {
      workflow: String(body.workflow || "unknown"),
      status: ["success", "failed", "running"].includes(body.status) ? body.status : "success",
      timestamp: new Date().toISOString(),
      duration: typeof body.duration === "number" ? body.duration : undefined,
      sent: typeof body.sent === "number" ? body.sent : undefined,
      notified: typeof body.notified === "number" ? body.notified : undefined,
      totalPoints: typeof body.totalPoints === "number" ? body.totalPoints : undefined,
      errorMessage: typeof body.errorMessage === "string" ? body.errorMessage : undefined,
    };

    // Load existing logs
    const runs = await loadCronRuns();

    // Prepend new run and trim to MAX_LOGS
    runs.unshift(newRun);
    const trimmedRuns = runs.slice(0, MAX_LOGS);

    await saveCronRuns(trimmedRuns);

    return NextResponse.json({ success: true, run: newRun });
  } catch (error: any) {
    console.error("POST /api/cron/status error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", details: error?.message },
      { status: 500 }
    );
  }
}
