import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { safeJsonBody } from "@/lib/http-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WithdrawBody = { consentType?: "personal_data" | "marketing" };

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) return noStore(NextResponse.json({ error: "Требуется авторизация" }, { status: 401 }));

  const { data, error } = await supabaseAdmin
    .from("user_consent_events")
    .select("event_type, consent_type, document_version, created_at, source")
    .eq("user_id", user.userId)
    .order("created_at", { ascending: false });

  if (error) {
    return noStore(NextResponse.json({ error: "Не удалось получить историю согласий" }, { status: 500 }));
  }

  const current: Record<string, { granted: boolean; version: string; changedAt: string; source: string }> = {};
  for (const event of data || []) {
    if (!current[event.consent_type]) {
      current[event.consent_type] = {
        granted: event.event_type === "grant",
        version: event.document_version,
        changedAt: event.created_at,
        source: event.source,
      };
    }
  }

  return noStore(NextResponse.json({ consents: current }));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return noStore(NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 }));
  }

  const user = await getUserFromRequest(request);
  if (!user) return noStore(NextResponse.json({ error: "Требуется авторизация" }, { status: 401 }));

  const { data: body, error: parseError } = await safeJsonBody<WithdrawBody>(request);
  if (parseError || !body || !["personal_data", "marketing"].includes(body.consentType || "")) {
    return noStore(NextResponse.json({ error: "Укажите тип согласия personal_data или marketing" }, { status: 400 }));
  }

  const consentType = body.consentType!;
  const { data: latestGrant, error: lookupError } = await supabaseAdmin
    .from("user_consent_events")
    .select("document_version")
    .eq("user_id", user.userId)
    .eq("consent_type", consentType)
    .eq("event_type", "grant")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    return noStore(NextResponse.json({ error: "Не удалось проверить действующее согласие" }, { status: 500 }));
  }
  if (!latestGrant) {
    return noStore(NextResponse.json({ error: "Действующее согласие не найдено" }, { status: 409 }));
  }

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipAddress = (forwardedFor || request.headers.get("x-real-ip") || "").slice(0, 64) || null;
  const userAgent = request.headers.get("user-agent")?.slice(0, 512) || null;

  const { error: insertError } = await supabaseAdmin.from("user_consent_events").insert({
    user_id: user.userId,
    event_type: "withdraw",
    consent_type: consentType,
    document_version: latestGrant.document_version,
    source: "account_settings",
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  if (insertError) {
    return noStore(NextResponse.json({ error: "Не удалось зафиксировать отзыв согласия" }, { status: 500 }));
  }

  return noStore(NextResponse.json({
    ok: true,
    consentType,
    message: consentType === "marketing"
      ? "Согласие на маркетинговые сообщения отозвано."
      : "Отзыв согласия на обработку персональных данных зарегистрирован. Обработка, необходимая для исполнения договора и обязательных требований закона, может продолжаться на иных законных основаниях.",
  }));
}
