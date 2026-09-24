/**
 * auth.ts — helpers для работы с auth в Server Components и Route Handlers.
 *
 * Использует Supabase GoTrue под капотом.
 *
 * Usage:
 *   import { getSession, requireRole, requireAdmin } from '@/lib/supabase/auth';
 *
 *   // В server component:
 *   const { user } = await getSession();
 *   if (!user) redirect('/login');
 *
 *   // Защита endpoint по роли:
 *   const user = await requireRole('ADMIN');
 *   if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 */

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { user_role } from "@/lib/supabase/types";

// ==================== Session ====================

/** Получить текущую сессию (или null если не авторизован) */
export async function getSession() {
  try {
    const supabase = await getSupabaseServer();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return { user: null, supabase };
    }

    return { user, supabase };
  } catch (e) {
    console.error("[auth] getSession error:", (e as Error).message);
    return { user: null, supabase: null };
  }
}

/** Получить текущего пользователя с ролями */
export async function getCurrentUser() {
  const { user, supabase } = await getSession();
  if (!user || !supabase) return null;

  // Загружаем роли из public.user_roles (через admin client для обхода RLS)
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  return {
    ...user,
    roles: (roles || []).map((r: { role: user_role }) => r.role),
  };
}

// ==================== Role-based helpers ====================

/** Требовать роль — если нет, возвращает null (для route handlers) */
export async function requireRole(role: user_role | user_role[]) {
  const user = await getCurrentUser();
  if (!user) return null;

  const requiredRoles = Array.isArray(role) ? role : [role];
  const hasRole = user.roles.some((r: string) => requiredRoles.includes(r as user_role));

  if (!hasRole) return null;

  return user;
}

/** Требовать роль ADMIN или SUPER_ADMIN */
export async function requireAdmin() {
  return requireRole(["ADMIN", "SUPER_ADMIN"] as user_role[]);
}

/** Требовать роль CONFECTIONER */
export async function requireConfectioner() {
  return requireRole("CONFECTIONER" as user_role);
}

/** Требовать роль COURIER */
export async function requireCourier() {
  return requireRole("COURIER" as user_role);
}

/** Требовать роль SUPPLIER */
export async function requireSupplier() {
  return requireRole("SUPPLIER" as user_role);
}

// ==================== Auth helpers для server components ====================

/** Редирект на /login если не авторизован (для server components) */
export async function requireAuthOrRedirect(returnTo?: string) {
  const { user } = await getSession();
  if (!user) {
    const url = returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login";
    redirect(url);
  }
  return user;
}

/** Вернуть 401 для route handler если не авторизован */
export function unauthorizedResponse(message = "Не авторизован") {
  return NextResponse.json({ error: message }, { status: 401 });
}

/** Вернуть 403 для route handler если нет прав */
export function forbiddenResponse(message = "Недостаточно прав") {
  return NextResponse.json({ error: message }, { status: 403 });
}
