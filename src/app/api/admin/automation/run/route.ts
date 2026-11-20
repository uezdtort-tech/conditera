import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ADMIN_MANUAL_RUNNABLE_EDGE_FUNCTIONS,
  invokeInternalEdgeFunction,
} from "@/lib/supabase/edge-functions";

export const runtime = "nodejs";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** POST /api/admin/automation/run — запускает только разрешённую Edge Function от имени администратора. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const guard = await requireAnyRole(user.id, [...ADMIN_ROLES]);
  if (guard) {
    return new NextResponse(guard.body, {
      status: guard.status,
      headers: guard.headers,
    });
  }

  const body = await request.json().catch(() => null) as { jobId?: unknown } | null;
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  if (!UUID.test(jobId)) {
    return NextResponse.json({ error: "Некорректный идентификатор задачи" }, { status: 400 });
  }

  const { data: job, error } = await supabaseAdmin
    .from("scheduled_jobs")
    .select("id,type,function_name")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    console.error("[automation/run] Failed to load scheduled job:", error.message);
    return NextResponse.json({ error: "Не удалось загрузить задачу" }, { status: 500 });
  }
  if (!job) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
  if (job.type !== "edge_function" || !job.function_name) {
    return NextResponse.json({ error: "Ручной запуск доступен только для Edge Function задач" }, { status: 422 });
  }
  if (!ADMIN_MANUAL_RUNNABLE_EDGE_FUNCTIONS.has(job.function_name)) {
    return NextResponse.json({ error: "Эта Edge Function пока не допущена к ручному запуску" }, { status: 422 });
  }

  try {
    const result = await invokeInternalEdgeFunction(job.function_name, {
      manual: true,
      scheduledJobId: job.id,
    });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("[automation/run] Edge Function invocation failed:", error);
    return NextResponse.json({ error: "Не удалось запустить задачу" }, { status: 502 });
  }
}
