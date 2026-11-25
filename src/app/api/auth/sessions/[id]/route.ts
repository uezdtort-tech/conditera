import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { revokeUserSession } from "@/lib/session-registry";

export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });

  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Некорректный идентификатор сессии" }, { status: 400 });
  }

  const revoked = await revokeUserSession(id, user.id, "user_revoked_device");
  if (!revoked) return NextResponse.json({ error: "Сессия не найдена или уже завершена" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
