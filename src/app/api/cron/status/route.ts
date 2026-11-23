/**
 * GET /api/cron/status — list recent cron run logs
 * POST /api/cron/status — record a cron run (called by n8n after each workflow)
 *
 * Machine-to-machine access uses X-Cron-Secret; interactive access requires
 * a valid application session and an active ADMIN/SUPER_ADMIN role from DB.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

const SETTING_KEY = "cron_runs";
const MAX_LOGS = 50;
const ALLOWED_STATUSES = new Set(["success", "failed", "running"]);

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

async function loadCronRuns(): Promise<CronRun[]> {
  const { data, error } = await supabaseAdmin
    .from("site_settings")
    .select("value")
    .eq("key", SETTING_KEY)
    .maybeSingle();

  if (error) {
    console.error("[cron/status] load error:", error.message);
    throw new Error("Cron history is unavailable");
  }
  if (!data) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(data.value ?? "[]"));
  } catch {
    throw new Error("Cron history contains invalid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("Cron history has an invalid format");
  return parsed as CronRun[];
}

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
      { onConflict: "key" },
    );

  if (error) {
    console.error("[cron/status] save error:", error.message);
    throw new Error("Cron history could not be saved");
  }
}

async function authorizeRead(req: NextRequest): Promise<Response | null> {
  if (verifyCronSecret(req)) return null;
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!user.roles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await authorizeRead(req);
  if (denied) return denied;
  try {
    const runs = await loadCronRuns();
    return NextResponse.json(
      { runs, total: runs.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[cron/status] GET failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const workflow = typeof input.workflow === "string" ? input.workflow.trim() : "";
  if (!workflow || workflow.length > 100) {
    return NextResponse.json({ error: "workflow обязателен и должен быть короче 100 символов" }, { status: 400 });
  }
  if (typeof input.status !== "string" || !ALLOWED_STATUSES.has(input.status)) {
    return NextResponse.json({ error: "status должен быть success, failed или running" }, { status: 400 });
  }

  const numericFields = ["duration", "sent", "notified", "totalPoints"] as const;
  for (const field of numericFields) {
    const value = input[field];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
      return NextResponse.json({ error: field + " должен быть неотрицательным числом" }, { status: 400 });
    }
  }
  if (input.errorMessage !== undefined && (
    typeof input.errorMessage !== "string" || input.errorMessage.length > 1000
  )) {
    return NextResponse.json({ error: "errorMessage должен быть строкой до 1000 символов" }, { status: 400 });
  }

  const newRun: CronRun = {
    workflow,
    status: input.status as CronRun["status"],
    timestamp: new Date().toISOString(),
    ...(typeof input.duration === "number" ? { duration: input.duration } : {}),
    ...(typeof input.sent === "number" ? { sent: input.sent } : {}),
    ...(typeof input.notified === "number" ? { notified: input.notified } : {}),
    ...(typeof input.totalPoints === "number" ? { totalPoints: input.totalPoints } : {}),
    ...(typeof input.errorMessage === "string" ? { errorMessage: input.errorMessage } : {}),
  };

  try {
    const runs = await loadCronRuns();
    runs.unshift(newRun);
    await saveCronRuns(runs.slice(0, MAX_LOGS));
    return NextResponse.json({ success: true, run: newRun }, { status: 201 });
  } catch (error) {
    console.error("[cron/status] POST failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
