/**
 * GET  /api/live-streams — список стримов (?status=live|scheduled|ended&confectionerId=)
 * POST /api/live-streams — создать стрим (CONFECTIONER)
 *
 * Auth: GET public, POST CONFECTIONER
 *
 * Безопасность:
 *   • POST: требует роль CONFECTIONER.
 *   • POST: парсинг JSON безопасен (safeJsonBody), 400 при невалидном теле.
 *   • POST: валидируются title (max 200) и description (max 2000).
 *   • При DB error не возвращаем детали БД клиенту (общая ошибка 500).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import { safeJsonBody, HttpError, handleRouteError, readStringField } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface CreateStreamBody {
  title?: string;
  description?: string;
  productId?: string;
  scheduledAt?: string;
}

const MAX_TITLE_LENGTH = 200;
const MAX_DESC_LENGTH = 2000;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const sp = request.nextUrl.searchParams;
    const status = sp.get("status") || "live,scheduled";
    const confectionerId = sp.get("confectionerId");
    const statuses = status
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (statuses.length === 0) {
      throw new HttpError(400, "status не может быть пустым");
    }

    let query = supabaseAdmin
      .from("live_streams")
      .select("*")
      .in("status", statuses)
      .order("status", { ascending: true })
      .order("started_at", { ascending: false })
      .limit(20);

    if (confectionerId) query = query.eq("confectioner_id", confectionerId);

    const { data: streams, error } = await query;
    if (error) {
      console.warn("[live-streams] GET error:", error.message);
    }

    return NextResponse.json({ streams: streams || [], total: (streams || []).length });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const guard = await requireRole(user.id, "CONFECTIONER");
    if (guard) {
      return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });
    }

    const { data: body, error: parseErr } = await safeJsonBody<CreateStreamBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }

    const titleResult = readStringField((body || {}) as Record<string, unknown>, "title", {
      maxLength: MAX_TITLE_LENGTH,
    });
    const title = titleResult.value || "Live Stream";
    if (titleResult.error) {
      throw new HttpError(422, titleResult.error);
    }

    const descResult = readStringField((body || {}) as Record<string, unknown>, "description", {
      maxLength: MAX_DESC_LENGTH,
    });

    // Find confectioner
    const { data: conf, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (confErr) {
      console.error("[live-streams] confectioner lookup failed:", confErr.message);
      throw new HttpError(500, "Не удалось проверить профиль кондитера");
    }
    if (!conf) {
      throw new HttpError(404, "Профиль кондитера не найден");
    }

    const scheduledAt = body?.scheduledAt || null;
    const productId = body?.productId || null;

    const { data: stream, error } = await supabaseAdmin
      .from("live_streams")
      .insert({
        confectioner_id: conf.id,
        title,
        description: descResult.value || null,
        product_id: productId,
        status: scheduledAt ? "scheduled" : "live",
        scheduled_at: scheduledAt,
        started_at: scheduledAt ? null : new Date().toISOString(),
        viewers_count: 0,
        peak_viewers: 0,
        total_viewers: 0,
        likes_count: 0,
      })
      .select()
      .single();

    if (error) {
      console.error("[live-streams] insert failed:", error.message);
      throw new HttpError(500, "Не удалось создать стрим");
    }

    return NextResponse.json({ stream }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
