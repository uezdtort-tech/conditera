import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, verifyAccessToken } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session-cookies";
import { revokeUserSession } from "@/lib/session-registry";

export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });

  const bearerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const token = bearerToken || request.cookies.get(SESSION_COOKIE)?.value;
  const payload = token ? await verifyAccessToken(token) : null;
  if (!payload?.sid || payload.userId !== user.id) {
    return NextResponse.json({ error: "Активная сессия не подтверждена" }, { status: 401 });
  }

  const { sessionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return NextResponse.json({ error: "Некорректный идентификатор сессии" }, { status: 400 });
  }
  if (sessionId === payload.sid) {
    return NextResponse.json({ error: "Текущий сеанс завершается через выход из аккаунта" }, { status: 409 });
  }

  const revoked = await revokeUserSession(sessionId, user.id, "user_revoked_session");
  if (!revoked) {
    return NextResponse.json({ error: "Сеанс не найден или уже завершён" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, revoked: sessionId });
}
