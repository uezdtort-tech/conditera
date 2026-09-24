import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * /login — страница входа (server component).
 *
 * Если пользователь уже залогинен → редирект на /dashboard.
 * Иначе → показывает клиентский AuthModal в открытом виде.
 */

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const params = await searchParams;
  const returnTo = params.returnTo || "/dashboard";

  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect(returnTo);
  }

  return <LoginClient />;
}

// Lazy load client component
import LoginClient from "./login-client";
