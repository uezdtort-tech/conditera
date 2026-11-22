/**
 * GET  /api/notifications/send — список последних уведомлений текущего пользователя.
 * POST /api/notifications/send — системная отправка по шаблону (n8n Cron Secret)
 *                         или ручная отправка ADMIN/SUPER_ADMIN.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { verifyCronSecret } from "@/lib/cron-auth";
import { sendNotification, TEMPLATES, type Channel, type Template } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_CHANNELS = new Set<Channel>(["in_app", "push", "email"]);

interface SendRequestBody {
  userId: string;
  type?: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  channel?: Channel;
  template?: string;
  vars?: Record<string, unknown>;
  channels?: string[];
  dedupKey?: string;
}

export async function GET(req: Request): Promise<NextResponse> {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[notifications/send GET] query failed:", error.message);
    return NextResponse.json({ error: "Не удалось загрузить уведомления" }, { status: 500 });
  }
  return NextResponse.json({ notifications: data || [] });
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const cronAuthorized = verifyCronSecret(req);
    let actorId: string | null = null;

    if (!cronAuthorized) {
      const user = await getUserFromRequest(req);
      if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
      const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
      if (guard) {
        return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });
      }
      actorId = user.id;
    }

    const body = await req.json() as SendRequestBody;
    if (!body || typeof body !== "object" || !USER_ID_RE.test(body.userId || "")) {
      return NextResponse.json({ error: "Некорректный userId" }, { status: 400 });
    }

    // n8n/system workflow: use the shared notification engine so preferences,
    // quiet hours, deduplication, SMTP, and Web Push delivery are consistent.
    if (body.template) {
      if (!Object.prototype.hasOwnProperty.call(TEMPLATES, body.template)) {
        return NextResponse.json({ error: "Неизвестный шаблон уведомления" }, { status: 400 });
      }
      if (!cronAuthorized && !actorId) {
        return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
      }

      const rawVars = body.vars || {};
      if (typeof rawVars !== "object" || Array.isArray(rawVars) || Object.keys(rawVars).length > 40) {
        return NextResponse.json({ error: "Некорректные vars" }, { status: 400 });
      }
      const vars: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(rawVars)) {
        if (typeof value !== "string" && typeof value !== "number") {
          return NextResponse.json({ error: `Недопустимое значение vars.${key}` }, { status: 400 });
        }
        if (typeof value === "string" && value.length > 2000) {
          return NextResponse.json({ error: `Слишком длинное значение vars.${key}` }, { status: 400 });
        }
        if (typeof value === "number" && !Number.isFinite(value)) {
          return NextResponse.json({ error: `Некорректное число vars.${key}` }, { status: 400 });
        }
        vars[key] = value;
      }

      const requestedChannels = body.channels?.length
        ? body.channels
        : body.channel ? [body.channel] : undefined;
      if (requestedChannels && requestedChannels.some((channel) => !ALLOWED_CHANNELS.has(channel as Channel))) {
        return NextResponse.json({ error: "Поддерживаются только in_app, email и push" }, { status: 400 });
      }
      if (body.dedupKey !== undefined &&
          (typeof body.dedupKey !== "string" || body.dedupKey.length < 1 || body.dedupKey.length > 200)) {
        return NextResponse.json({ error: "Некорректный dedupKey" }, { status: 400 });
      }

      const notificationIds = await sendNotification({
        userId: body.userId,
        template: body.template as Template,
        vars,
        channels: requestedChannels as Channel[] | undefined,
        data: body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {},
        dedupKey: body.dedupKey,
      });

      if (notificationIds.notificationIds.length === 0) {
        // A retry after a successful delivery may hit the dedup constraint and
        // return no new IDs. Confirm the existing delivery before telling n8n
        // to leave the abandoned-cart log pending forever.
        if (body.dedupKey) {
          const { data: existingRows, error: existingError } = await supabaseAdmin
            .from("notifications")
            .select("id, channel, status")
            .eq("user_id", body.userId)
            .contains("metadata", { dedup_key: body.dedupKey })
            .limit(10);

          if (existingError) {
            console.error("[notifications/send] dedup lookup failed:", existingError.message);
            return NextResponse.json({ error: "Не удалось подтвердить повторную доставку" }, { status: 502 });
          }

          const existing = existingRows || [];
          const alreadyDelivered = existing.length > 0 &&
            existing.every((row) => ["sent", "delivered", "read"].includes(row.status));
          if (alreadyDelivered) {
            return NextResponse.json({
              success: true,
              alreadySent: true,
              notificationIds: existing.map((row) => row.id),
              channels: existing.map((row) => ({ channel: row.channel, status: row.status })),
            });
          }
        }

        return NextResponse.json({ success: true, skipped: true, notificationIds: [] });
      }

      const { data: rows, error: statusError } = await supabaseAdmin
        .from("notifications")
        .select("id, channel, status")
        .in("id", notificationIds.notificationIds);
      if (statusError || !rows) {
        console.error("[notifications/send] delivery status lookup failed:", statusError?.message);
        return NextResponse.json({ error: "Не удалось подтвердить доставку уведомлений" }, { status: 502 });
      }
      if (rows.length !== notificationIds.notificationIds.length) {
        console.error("[notifications/send] notification status count mismatch", {
          expected: notificationIds.notificationIds.length,
          actual: rows.length,
        });
        return NextResponse.json({ error: "Не удалось подтвердить сохранение всех уведомлений" }, { status: 502 });
      }

      const failed = rows.filter((row) => row.status === "failed");
      if (failed.length > 0) {
        return NextResponse.json({
          success: false,
          error: "Часть каналов уведомлений не доставлена",
          notificationIds: notificationIds.notificationIds,
          failed: failed.map((row) => ({ id: row.id, channel: row.channel })),
        }, { status: 502 });
      }
      const allQueued = rows.length > 0 && rows.every((row) => row.status === "queued");
      if (allQueued) {
        return NextResponse.json({
          success: true,
          skipped: true,
          scheduled: true,
          notificationIds: notificationIds.notificationIds,
          channels: rows.map((row) => ({ channel: row.channel, status: row.status })),
        });
      }
      return NextResponse.json({
        success: true,
        notificationIds: notificationIds.notificationIds,
        channels: rows.map((row) => ({ channel: row.channel, status: row.status })),
      });
    }

    // Manual admin notifications are intentionally limited to in-app. External
    // channels must use a typed template so provider delivery and preferences apply.
    if (cronAuthorized) {
      return NextResponse.json({ error: "Cron requests must use a notification template" }, { status: 400 });
    }
    if (!body.title || !body.body || typeof body.title !== "string" || typeof body.body !== "string") {
      return NextResponse.json({ error: "title и body обязательны" }, { status: 400 });
    }
    if (body.title.length > 180 || body.body.length > 5000) {
      return NextResponse.json({ error: "Превышена длина уведомления" }, { status: 400 });
    }
    const { data: notif, error } = await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: body.userId,
        type: body.type || "info",
        title: body.title,
        body: body.body,
        metadata: body.data || {},
        channel: "in_app",
        status: "sent",
      })
      .select("id")
      .single();

    if (error || !notif) {
      console.error("[notifications/send] manual insert failed:", error?.message);
      return NextResponse.json({ error: "Не удалось сохранить уведомление" }, { status: 500 });
    }
    return NextResponse.json({ success: true, notificationId: notif.id });
  } catch (error) {
    console.error("[notifications/send] request failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Внутренняя ошибка отправки уведомления" }, { status: 500 });
  }
}
