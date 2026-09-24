/**
 * GET /api/auth/oauth/handoff — одноразовая передача OAuth-сессии в браузер.
 *
 * Callback провайдера кладёт GoTrue-сессию в httpOnly-cookie `oauth_handoff`
 * (60 сек) и редиректит на /oauth/finish. Эта страница вызывает handoff,
 * получает { accessToken, refreshToken, email, name } и выполняет
 * supabaseBrowser.auth.setSession() — итог тот же, что после обычного входа.
 * Cookie стирается сразу после чтения (one-time).
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const raw = request.cookies.get("oauth_handoff")?.value;
  if (!raw) {
    return NextResponse.json({ error: "OAuth handoff не найден или уже использован" }, { status: 404 });
  }

  const response = NextResponse.json({ ok: true });
  // Стираем cookie сразу — одноразовость.
  response.cookies.set("oauth_handoff", "", { httpOnly: true, maxAge: 0, path: "/" });

  try {
    const data = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
      email?: string;
      name?: string;
    };
    if (!data.accessToken || !data.refreshToken) {
      return NextResponse.json({ error: "Некорректный handoff" }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      session: {
        access_token: data.accessToken,
        refresh_token: data.refreshToken,
        expires_at: data.expiresAt,
      },
      email: data.email,
      name: data.name,
    });
  } catch {
    return NextResponse.json({ error: "Некорректный handoff" }, { status: 400 });
  }
}
