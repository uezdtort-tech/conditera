/**
 * POST /api/chat/bot-trigger — внутренний endpoint для триггеров бота.
 *
 * Используется:
 *  - При смене статуса заказа (вызывает order status update endpoint)
 *  - При создании заказа (welcome message)
 *  - При напоминании об оплате (cron)
 *
 * Auth: требует X-Bot-Secret header (не доступен извне)
 */
import { NextRequest, NextResponse } from "next/server";
import { notifyOrderStatusChange, ensureOrderChatRoom, sendPaymentReminder } from "@/lib/chat-automation";

const BOT_SECRET = process.env.BOT_SECRET || "dev-bot-secret-change-me";

export async function POST(request: NextRequest) {
  try {
    // Проверка secret
    const secret = request.headers.get("x-bot-secret");
    if (secret !== BOT_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { trigger, orderId, fromStatus, toStatus, extra } = body;

    switch (trigger) {
      case "order_status_change":
        if (!orderId || !toStatus) {
          return NextResponse.json(
            { error: "orderId and toStatus required" },
            { status: 400 }
          );
        }
        await notifyOrderStatusChange({
          orderId,
          fromStatus,
          toStatus,
          extra,
        });
        return NextResponse.json({ success: true, trigger, orderId, toStatus });

      case "order_created":
        if (!orderId) {
          return NextResponse.json({ error: "orderId required" }, { status: 400 });
        }
        const roomId = await ensureOrderChatRoom(orderId);
        return NextResponse.json({ success: true, trigger, orderId, roomId });

      case "payment_reminder":
        if (!orderId) {
          return NextResponse.json({ error: "orderId required" }, { status: 400 });
        }
        await sendPaymentReminder(orderId);
        return NextResponse.json({ success: true, trigger, orderId });

      default:
        return NextResponse.json(
          { error: `Unknown trigger: ${trigger}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("POST /api/chat/bot-trigger error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: (error as Error).message },
      { status: 500 }
    );
  }
}
