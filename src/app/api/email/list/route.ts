/**
 * GET /api/email/list — список писем (входящие/исходящие) для админки.
 * POST /api/email/list — отправка письма вручную (admin only).
 *
 * Безопасность:
 *   • GET: requires AUTHENTICATED. Не-админ видит только свои письма.
 *   • GET: direction/status/search фильтры (validate types).
 *   • POST: требует роль ADMIN/SUPPORT/MODERATOR.
 *   • POST: zod schema для валидации (to — email, subject ≤500, text ≤50000).
 *   • Type-safe interfaces, без `as any` для where.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { HttpError, handleRouteError } from "@/lib/http-helpers";
import { z } from "zod";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

interface EmailMessageRow {
  id: string;
  direction: string;
  from_address: string;
  from_name: string | null;
  to_address: string;
  to_name: string | null;
  subject: string;
  text_body: string | null;
  html_body: string | null;
  status: string;
  user_id: string | null;
  order_id: string | null;
  ticket_id: string | null;
  template: string | null;
  message_id: string | null;
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
}

const STAFF_ROLES = ["ADMIN", "SUPPORT", "MODERATOR"] as const;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MAX_OFFSET = 1_000_000;

function parsePositiveInt(value: string | null, defaultValue: number, max: number): number {
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num < 0) return defaultValue;
  return Math.min(num, max);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const isAdmin = user.roles.some((r) => (STAFF_ROLES as readonly string[]).includes(r));

    const { searchParams } = new URL(request.url);
    const direction = searchParams.get("direction"); // "sent" | "received"
    const status = searchParams.get("status");       // "sent" | "failed" | "pending"
    const search = searchParams.get("search");
    const limit = parsePositiveInt(searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
    const offset = parsePositiveInt(searchParams.get("offset"), 0, MAX_OFFSET);

    // Build supabase query
    let query = supabaseAdmin
      .from("email_messages")
      .select(`
        id, direction, from_address, from_name, to_address, to_name,
        subject, text_body, html_body, status,
        user_id, order_id, ticket_id, template, message_id,
        sent_at, error_message, created_at
      `, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    let countQuery = supabaseAdmin
      .from("email_messages")
      .select("id", { count: "exact", head: true });

    // Не-админ видит только свои письма
    if (!isAdmin) {
      query = query.eq("user_id", user.userId);
      countQuery = countQuery.eq("user_id", user.userId);
    }

    if (direction) {
      query = query.eq("direction", direction);
      countQuery = countQuery.eq("direction", direction);
    }
    if (status) {
      query = query.eq("status", status);
      countQuery = countQuery.eq("status", status);
    }
    if (search) {
      // Supabase не поддерживает OR в одной цепочке — используем ilike на subject
      query = query.ilike("subject", `%${search}%`);
      countQuery = countQuery.ilike("subject", `%${search}%`);
    }

    const [emailsResult, countResult] = await Promise.all([
      query,
      countQuery,
    ]) as [
      { data: EmailMessageRow[] | null; error: SupabaseError | null },
      { count: number | null; error: SupabaseError | null }
    ];

    if (emailsResult.error) {
      console.error("[email/list] GET failed:", emailsResult.error.message);
      throw new HttpError(500, "Не удалось загрузить письма");
    }

    return NextResponse.json({
      emails: emailsResult.data || [],
      total: countResult.count || 0,
      limit,
      offset,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

const sendEmailSchema = z.object({
  to: z.string().email(),
  toName: z.string().max(200).optional(),
  subject: z.string().min(1).max(500),
  text: z.string().max(50000).optional(),
  html: z.string().max(100000).optional(),
  userId: z.string().max(100).optional(),
  orderId: z.string().max(100).optional(),
  ticketId: z.string().max(100).optional(),
  leadId: z.string().max(100).optional(),
});

type SendEmailInput = z.infer<typeof sendEmailSchema>;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const isAdmin = user.roles.some((r) => (STAFF_ROLES as readonly string[]).includes(r));
    if (!isAdmin) {
      throw new HttpError(403, "Только для персонала");
    }

    const body = await request.json().catch(() => null);
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    const parse = sendEmailSchema.safeParse(body);
    if (!parse.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parse.error.flatten() },
        { status: 400 }
      );
    }

    const data: SendEmailInput = parse.data;
    const result = await sendEmail({
      to: data.to,
      toName: data.toName,
      subject: data.subject,
      text: data.text,
      html: data.html,
      userId: data.userId,
      orderId: data.orderId,
      ticketId: data.ticketId,
      leadId: data.leadId,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (error) {
    return handleRouteError(error);
  }
}
