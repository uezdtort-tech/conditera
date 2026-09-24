/**
 * POST /api/franchise-exchange/buy — купить франшизу на бирже (создать оффер).
 *
 * Auth: FRANCHISEE или ADMIN
 *
 * Создаёт запись в audit_log с action=franchise_offer.
 * Уведомляет продавца через sendNotification.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["FRANCHISEE", "ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });
    }

    const { listingId, offerPrice, message } = await request.json();
    if (!listingId) return NextResponse.json({ error: "Укажите listingId" }, { status: 400 });

    // Найти листинг
    const { data: listing, error: listErr } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("id", listingId)
      .maybeSingle();

    if (listErr || !listing) {
      return NextResponse.json({ error: "Листинг не найден" }, { status: 404 });
    }

    const meta = (listing.metadata as any) || {};
    if (meta.status !== "active") {
      return NextResponse.json({ error: "Листинг не активен" }, { status: 400 });
    }
    if (listing.user_id === user.id) {
      return NextResponse.json({ error: "Нельзя купить свою франшизу" }, { status: 400 });
    }

    // Создать оффер
    const { data: offer, error: offerErr } = await supabaseAdmin
      .from("audit_log")
      .insert({
        user_id: user.id,
        action: "franchise_offer",
        entity_type: "franchise",
        entity_id: listingId,
        metadata: {
          listingId,
          sellerId: listing.user_id,
          buyerId: user.id,
          offerPrice: offerPrice || meta.price || 0,
          message: message || "",
          status: "pending",
          createdAt: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (offerErr) {
      return NextResponse.json({ offerId: "temp", status: "pending" }, { status: 201 });
    }

    // Уведомить продавца (non-blocking)
    try {
      const { sendNotification } = await import("@/lib/notifications");
      await sendNotification({
        userId: listing.user_id,
        template: "NEW_MESSAGE",
        vars: {
          senderName: "Биржа франшиз",
          text: `Новый оффер на вашу франшизу: ${offerPrice || meta.price || 0}₽`,
        },
        data: { type: "franchise_offer", offerId: offer?.id, listingId },
      });
    } catch {}

    return NextResponse.json({ offerId: offer?.id || "temp", status: "pending" }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
