// GET /api/csrf-token
// Issues a new CSRF token using the double-submit cookie pattern.
//
// The same token is stored in an httpOnly cookie AND returned in the JSON
// body. The client must send the body token back as the `x-csrf-token`
// header on state-changing requests; the server then compares header vs.
// cookie using a timing-safe comparison (see src/lib/csrf.ts).

import { NextResponse } from "next/server";
import {
  generateCsrfToken,
  CSRF_COOKIE_NAME,
} from "@/lib/csrf";

export async function GET() {
  const token = generateCsrfToken();

  const response = NextResponse.json({
    token,
    header: "x-csrf-token",
  });

  // httpOnly so the token can't be read by XSS-ridden client JS — it is
  // only ever sent back by the server's own comparison logic.
  // SameSite=Lax blocks cross-site submits without breaking top-level
  // navigations. Secure is enabled automatically in production via Next.
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 24 hours
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
