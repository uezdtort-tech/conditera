/**
 * POST /api/events/:id/assign — назначить кондитера на мероприятие (EVENT_ORGANIZER или ADMIN).
 *
 * Auth: EVENT_ORGANIZER или ADMIN
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const guard = await requireAnyRole(user.id, ["EVENT_ORGANIZER", "ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const { confectionerId } = await request.json();

    // Отправить уведомление кондитеру
    try {
      const { sendNotification } = await import("@/lib/notifications");
      await sendNotification({
        userId: confectionerId,
        template: "NEW_MESSAGE",
        vars: {
          senderName: "Мероприятие",
          text: `Вы назначены на мероприятие #${id}`,
        },
        data: { type: "event_assigned", eventId: id },
      });
    } catch (e: any) {
      console.warn("[events/:id/assign] notification failed:", e?.message);
    }

    return NextResponse.json({ success: true, eventId: id, confectionerId });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
