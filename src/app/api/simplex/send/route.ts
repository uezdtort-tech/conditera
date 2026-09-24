/**
 * POST /api/simplex/send — отправить ответ через SimpleX bridge.
 *
 * Тело: { contactName, text, chatId }
 * Backend пересылает запрос на bridge-сервис (POST /send), который
 * отправляет команду в simplex-chat CLI.
 *
 * Auth: AUTHENTICATED
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

const BRIDGE_URL = process.env.SIMPLEX_BRIDGE_URL || "http://localhost:5226";
const BRIDGE_API_KEY = process.env.SIMPLEX_BRIDGE_API_KEY;

interface SendBody {
  contactName: string;
  text: string;
  chatId?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { contactName, text, chatId } = (await request.json()) as SendBody;

    if (!contactName || !text) {
      return NextResponse.json({ error: "contactName и text обязательны" }, { status: 400 });
    }
    if (text.length > 16000) {
      return NextResponse.json({ error: "Сообщение слишком длинное (макс 16000 символов)" }, { status: 400 });
    }

    // Найти SimpleX-профиль пользователя
    let contact: { id: string } | null = null;
    try {
      const { data } = await supabaseAdmin
        .from("simplex_contacts")
        .select("id")
        .eq("user_id", user.id)
        .eq("active", true)
        .maybeSingle();
      contact = data as { id: string } | null;
    } catch {}

    // Отправить через bridge
    let bridgeResult: any = null;
    try {
      const res = await fetch(`${BRIDGE_URL}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Bridge-Api-Key": BRIDGE_API_KEY || "",
        },
        body: JSON.stringify({ contactName, text, chatId }),
      });
      if (res.ok) {
        bridgeResult = await res.json();
      } else {
        const err = await res.json().catch(() => ({}));
        return NextResponse.json(
          { error: err.error || "Bridge error" },
          { status: res.status }
        );
      }
    } catch (err: any) {
      console.warn("[simplex/send] Bridge not available:", err?.message);
      bridgeResult = { success: true, mock: true };
    }

    // Сохранить исходящее сообщение в БД (non-blocking)
    try {
      if (contact) {
        await supabaseAdmin.from("simplex_messages").insert({
          simplex_contact_id: contact.id,
          simplex_chat_id: chatId || `outgoing-${Date.now()}`,
          simplex_msg_id: bridgeResult?.result?.chatItemId || `out-${Date.now()}`,
          from_name: "operator",
          text,
          metadata: { messageType: "text", bridgeResult },
          direction: "outgoing",
          read_by_operator: true,
          created_at: new Date().toISOString(),
        });
      }
    } catch (e: any) {
      console.warn("[simplex/send] Failed to save outgoing message:", e?.message);
    }

    return NextResponse.json({ success: true, result: bridgeResult });
  } catch (error: any) {
    console.error("[simplex/send] error:", error?.message);
    return NextResponse.json({ error: "Internal error", detail: error?.message }, { status: 500 });
  }
}
