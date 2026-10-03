/**
 * /auth/v1/[...path] — заглушка GoTrue.
 *
 * В локальном рантайме Supabase GoTrue отсутствует: каноническая аутентификация —
 * собственная JWT-система приложения (/api/auth/*, bcrypt + HS256, cookie cd_session
 * + Bearer). supabase-js-клиенты, случайно обращающиеся к /auth/v1/*, получают
 * явную 501-подсказку вместо тишины.
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path?: string[] }> };

async function handle(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params;
  return NextResponse.json(
    {
      code: "LOCAL_AUTH_DISABLED",
      msg: "Local runtime: Supabase GoTrue is disabled. Use /api/auth/login, /api/auth/register, /api/auth/session, /api/auth/logout",
      requestedPath: (path ?? []).join("/"),
    },
    { status: 501 }
  );
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
