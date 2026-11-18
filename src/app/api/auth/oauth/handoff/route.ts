/**
 * GET /api/auth/oauth/handoff — одноразовая передача OAuth-сессии в браузер.
 * Секреты не кешируются; cookie очищается как при успешном чтении, так и при ошибке.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearHandoffCookie(response: NextResponse): NextResponse {
  response.cookies.set("oauth_handoff", "", {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Не выдаём одноразовый токен при кросс-сайтовом запросе.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  }

  const raw = request.cookies.get("oauth_handoff")?.value;
  if (!raw) {
    return clearHandoffCookie(NextResponse.json(
      { error: "OAuth handoff не найден или уже использован" },
      { status: 404 }
    ));
  }

  try {
    const data = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
      email?: string;
      name?: string;
      returnTo?: string;
    };
    if (!data.accessToken || !data.refreshToken ||
        (data.expiresAt !== undefined && (!Number.isFinite(data.expiresAt) || data.expiresAt <= 0))) {
      return clearHandoffCookie(NextResponse.json({ error: "Некорректный handoff" }, { status: 400 }));
    }

    return clearHandoffCookie(NextResponse.json({
      ok: true,
      session: {
        access_token: data.accessToken,
        refresh_token: data.refreshToken,
        expires_at: data.expiresAt,
      },
      email: data.email,
      name: data.name,
      returnTo: data.returnTo,
    }));
  } catch {
    return clearHandoffCookie(NextResponse.json({ error: "Некорректный handoff" }, { status: 400 }));
  }
}
