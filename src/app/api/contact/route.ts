import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getClientIP, rateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;
const CONTACT_WINDOW_MS = 60 * 60 * 1000;
const CONTACT_LIMIT = 3;

const contactSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(40).optional().default(""),
  topic: z.enum(["general", "order", "dispute", "partnership", "press", "investor", "confectioner"]),
  message: z.string().trim().min(10).max(5000),
  consent: z.literal(true),
  // Honeypot: humans never see or fill this field.
  website: z.string().max(200).optional().default(""),
});

const TOPIC_LABELS: Record<z.infer<typeof contactSchema>["topic"], string> = {
  general: "Общий вопрос",
  order: "Вопрос по заказу",
  dispute: "Спор или возврат",
  partnership: "Сотрудничество",
  press: "Пресса и медиа",
  investor: "Инвесторам",
  confectioner: "Регистрация кондитера",
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "Ожидается application/json" }, { status: 415 });
    }

    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Слишком большой запрос" }, { status: 413 });
    }

    const ip = getClientIP(request);
    const limit = await rateLimit({
      key: `contact:${ip}`,
      limit: CONTACT_LIMIT,
      windowMs: CONTACT_WINDOW_MS,
    });
    if (!limit.success) {
      return NextResponse.json(
        { error: "Слишком много обращений. Попробуйте позже." },
        {
          status: 429,
          headers: {
            "Retry-After": String(limit.retryAfterSec),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Слишком большой запрос" }, { status: 413 });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }

    const parsed = contactSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Проверьте заполнение формы", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Silently accept honeypot submissions without storing or notifying.
    if (parsed.data.website.trim()) {
      return NextResponse.json({ success: true }, { status: 202 });
    }

    const input = parsed.data;
    const email = input.email.toLowerCase();
    const createdAt = new Date().toISOString();
    const metadata = {
      topic: input.topic,
      topic_label: TOPIC_LABELS[input.topic],
      source_page: "/contacts",
      privacy_consent: true,
      privacy_consent_at: createdAt,
      privacy_document_version: "2026-11-23",
      user_agent: request.headers.get("user-agent")?.slice(0, 512) || null,
    };

    const { data: lead, error } = await supabaseAdmin
      .from("leads")
      .insert({
        name: input.name,
        email,
        phone: input.phone.trim() || null,
        source: "website",
        inquiry: `Тема: ${TOPIC_LABELS[input.topic]}\n\n${input.message}`,
        status: "new",
        stage: "awareness",
        metadata,
      })
      .select("id")
      .single();

    if (error || !lead) {
      console.error("[contact] lead insert failed:", error?.message || "no lead returned");
      return NextResponse.json({ error: "Не удалось зарегистрировать обращение" }, { status: 500 });
    }

    const notificationEmail = process.env.CONTACT_NOTIFICATION_EMAIL?.trim();
    let notificationStatus: "sent" | "failed" | "not_configured" = "not_configured";
    if (notificationEmail) {
      const notification = await sendEmail({
        to: notificationEmail,
        subject: `Новое обращение с сайта: ${TOPIC_LABELS[input.topic]}`,
        text: [
          "Новое обращение зарегистрировано в CRM Conditera.",
          `Номер: ${lead.id}`,
          `Имя: ${input.name}`,
          `Email: ${email}`,
          `Телефон: ${input.phone.trim() || "не указан"}`,
          `Тема: ${TOPIC_LABELS[input.topic]}`,
          "",
          input.message,
        ].join("\n"),
        replyTo: email,
        leadId: lead.id,
        template: "contact_inquiry",
      });
      notificationStatus = notification.success ? "sent" : "failed";
      if (!notification.success) {
        console.error("[contact] notification email failed:", notification.error || "unknown error");
      }
    } else if (process.env.NODE_ENV === "production") {
      console.error("[contact] CONTACT_NOTIFICATION_EMAIL is missing; lead stored without email notification");
      notificationStatus = "failed";
    }

    const { error: metadataError } = await supabaseAdmin
      .from("leads")
      .update({
        metadata: { ...metadata, notification_status: notificationStatus },
      })
      .eq("id", lead.id);
    if (metadataError) {
      console.error("[contact] failed to persist notification status:", metadataError.message);
    }

    return NextResponse.json(
      { success: true, reference: lead.id, notificationStatus },
      { status: 201 }
    );
  } catch (error) {
    console.error("[contact] request failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Не удалось отправить обращение. Попробуйте позже." }, { status: 500 });
  }
}
