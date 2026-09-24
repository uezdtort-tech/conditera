/**
 * POST /api/franchise-exchange/transfer — принять/отклонить оффер (продавец).
 *
 * Тело: { offerId, action: "accept" | "reject" }
 *
 * При accept:
 *   1. Обновить оффер: status="accepted", transferredAt=now
 *   2. Обновить листинг: status="sold", buyerId, soldAt=now
 *   3. Уведомить покупателя через sendNotification
 *
 * Auth: AUTHENTICATED (продавец определяется из metadata.sellerId)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { offerId, action } = await request.json();
    if (!offerId) return NextResponse.json({ error: "Укажите offerId" }, { status: 400 });
    if (!["accept", "reject"].includes(action)) {
      return NextResponse.json({ error: "action должен быть 'accept' или 'reject'" }, { status: 400 });
    }

    // Найти оффер
    const { data: offer, error: offerErr } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("id", offerId)
      .maybeSingle();

    if (offerErr || !offer) {
      return NextResponse.json({ error: "Оффер не найден" }, { status: 404 });
    }

    const meta = (offer.metadata as any) || {};
    if (meta.sellerId !== user.id) {
      return NextResponse.json({ error: "Вы не продавец этого оффера" }, { status: 403 });
    }

    if (action === "accept") {
      // Обновить оффер
      meta.status = "accepted";
      meta.transferredAt = new Date().toISOString();
      await supabaseAdmin
        .from("audit_log")
        .update({ metadata: meta })
        .eq("id", offerId);

      // Обновить листинг
      if (meta.listingId) {
        const { data: listing } = await supabaseAdmin
          .from("audit_log")
          .select("metadata")
          .eq("id", meta.listingId)
          .maybeSingle();
        if (listing) {
          const lmeta = (listing.metadata as any) || {};
          lmeta.status = "sold";
          lmeta.buyerId = meta.buyerId;
          lmeta.soldAt = new Date().toISOString();
          await supabaseAdmin
            .from("audit_log")
            .update({ metadata: lmeta })
            .eq("id", meta.listingId);
        }
      }

      // Уведомить покупателя
      try {
        const { sendNotification } = await import("@/lib/notifications");
        await sendNotification({
          userId: meta.buyerId,
          template: "NEW_MESSAGE",
          vars: { senderName: "Биржа франшиз", text: "Ваш оффер принят! Франшиза передана вам." },
          data: { type: "franchise_transferred", offerId, listingId: meta.listingId },
        });
      } catch {}
    } else {
      // Reject
      meta.status = "rejected";
      meta.rejectedAt = new Date().toISOString();
      await supabaseAdmin
        .from("audit_log")
        .update({ metadata: meta })
        .eq("id", offerId);

      // Уведомить покупателя об отказе
      try {
        const { sendNotification } = await import("@/lib/notifications");
        await sendNotification({
          userId: meta.buyerId,
          template: "NEW_MESSAGE",
          vars: { senderName: "Биржа франшиз", text: "Ваш оффер отклонён продавцом." },
          data: { type: "franchise_offer_rejected", offerId },
        });
      } catch {}
    }

    return NextResponse.json({ success: true, offerId, action, status: meta.status });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
