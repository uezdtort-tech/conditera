import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { verifyAccessToken } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session-cookies";

/**
 * /login — страница входа (server component).
 *
 * Если пользователь уже залогинен → редирект на /dashboard.
 * Проверка идёт по единому auth-контракту: cookie cd_session (app-JWT),
 * затем легаси Supabase GoTrue-сессия.
 * Иначе → показывает единую клиентскую AuthModal (как на главной).
 */

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const params = await searchParams;
  const returnTo = params.returnTo || "/dashboard";

  // 1. Единый auth-контракт: app-сессия в httpOnly cookie cd_session
  const sessionCookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (sessionCookie && (await verifyAccessToken(sessionCookie))) {
    redirect(returnTo);
  }

  // 2. Легаси: Supabase GoTrue-сессия
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect(returnTo);
  }

  return <LoginClient />;
}

// Lazy load client component
import LoginClient from "./login-client";
