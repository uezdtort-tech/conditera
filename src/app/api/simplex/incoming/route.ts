/**
 * POST /api/simplex/incoming — webhook от simplex-bridge.
 *
 * Принимает события из SimpleX Chat:
 *   - message_received: входящее сообщение от клиента
 *   - contact_connected: клиент подключился к профилю
 *   - contact_request: запрос на подключение
 *
 * Bridge отправляет webhook с заголовком X-Bridge-Api-Key.
 * E2E-шифрование: bridge расшифровывает сообщения, которые приходят НА профиль.
 *
 * Auth: X-Bridge-Api-Key header (SIMPLEX_BRIDGE_API_KEY env var)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const BRIDGE_API_KEY = process.env.SIMPLEX_BRIDGE_API_KEY;

interface SimplexPayload {
  event: string;
  simplexChatId?: string;
  simplexMsgId?: string;
  fromName?: string;
  text?: string;
  messageType?: string;
  files?: any[];
  timestamp?: string;
  contactName?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!BRIDGE_API_KEY) {
      console.error("[simplex/incoming] SIMPLEX_BRIDGE_API_KEY not set");
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }
    const apiKey = request.headers.get("X-Bridge-Api-Key");
    if (apiKey !== BRIDGE_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = (await request.json()) as SimplexPayload;
    const { event } = payload;

    switch (event) {
      case "message_received":
        return await handleMessageReceived(payload);
      case "contact_connected":
        return await handleContactConnected(payload);
      case "contact_request":
        return await handleContactRequest(payload);
      default:
        console.warn(`[simplex/incoming] Unknown event: ${event}`);
        return NextResponse.json({ ok: true, ignored: true });
    }
  } catch (error: any) {
    console.error("[simplex/incoming] error:", error?.message);
    return NextResponse.json({ error: "Internal error", detail: error?.message }, { status: 500 });
  }
}

async function handleMessageReceived(payload: SimplexPayload): Promise<NextResponse> {
  const { simplexChatId, simplexMsgId, fromName, text, messageType, files, timestamp } = payload;

  if (!simplexChatId || !simplexMsgId) {
    return NextResponse.json({ error: "Missing simplexChatId/simplexMsgId" }, { status: 400 });
  }

  // Найти активный SimpleX-контакт
  let contact: Record<string, any> | null = null;
  try {
    const { data } = await supabaseAdmin
      .from("simplex_contacts")
      .select("*")
      .eq("profile_type", "confectioner")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    contact = data as Record<string, any> | null;
  } catch (e: any) {
    console.warn("[simplex/incoming] DB not available:", e?.message);
  }

  // Сохранить сообщение
  try {
    if (contact) {
      // Проверить дубликат
      const { data: existing } = await supabaseAdmin
        .from("simplex_messages")
        .select("id")
        .eq("simplex_msg_id", simplexMsgId)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({ ok: true, duplicate: true });
      }

      await supabaseAdmin.from("simplex_messages").insert({
        simplex_contact_id: contact.id,
        simplex_chat_id: simplexChatId,
        simplex_msg_id: simplexMsgId,
        from_name: fromName || null,
        text: text || null,
        metadata: { messageType, files: files || [], rawTimestamp: timestamp },
        direction: "incoming",
        read_by_operator: false,
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });

      console.log(`[simplex/incoming] Saved message from ${fromName}: ${text?.slice(0, 50) || `[${messageType}]`}`);

      // Push-уведомление владельцу (non-blocking)
      try {
        const { sendNotification } = await import("@/lib/notifications");
        await sendNotification({
          userId: contact.user_id,
          template: "SIMPLEX_MESSAGE",
          vars: { fromName: fromName || "клиента", text: text || "" },
          data: { simplexChatId, simplexContactId: contact.id, type: "simplex_message" },
        });
      } catch (notifyErr: any) {
        console.warn("[simplex/incoming] Push notification failed:", notifyErr?.message);
      }
    }
  } catch (e: any) {
    console.error("[simplex/incoming] Failed to save message:", e?.message);
  }

  return NextResponse.json({ ok: true });
}

async function handleContactConnected(payload: SimplexPayload): Promise<NextResponse> {
  const { contactName } = payload;
  console.log(`[simplex/incoming] Contact connected: ${contactName}`);

  try {
    const { data: contact } = await supabaseAdmin
      .from("simplex_contacts")
      .select("id, connections_count")
      .eq("profile_type", "confectioner")
      .eq("active", true)
      .maybeSingle();

    if (contact) {
      await supabaseAdmin
        .from("simplex_contacts")
        .update({ connections_count: (contact.connections_count || 0) + 1 })
        .eq("id", contact.id);
    }
  } catch (e: any) {
    console.warn("[simplex/incoming] Failed to increment connectionsCount:", e?.message);
  }

  return NextResponse.json({ ok: true });
}

async function handleContactRequest(payload: SimplexPayload): Promise<NextResponse> {
  const { contactName } = payload;
  console.log(`[simplex/incoming] Contact request from: ${contactName}`);
  return NextResponse.json({ ok: true });
}
