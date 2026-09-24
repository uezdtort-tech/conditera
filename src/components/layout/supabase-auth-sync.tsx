"use client";

/**
 * SupabaseAuthSync — синхронизация сессии Supabase GoTrue → Zustand store.
 *
 * Проблема (найдена E2E-аудитом, задача 11 v3 ТЗ):
 *   SupabaseAuthModal после успешного входа НЕ пишет в Zustand store,
 *   поэтому header показывает «Войти», а гейт /dashboard бесконечно
 *   открывает модалку (store.user === null).
 *
 * Решение: клиентский компонент-подписчик. Монтируется рядом с
 * SupabaseAuthModal (dashboard/page.tsx; при необходимости — в layout).
 *
 * Логика:
 *   1. On mount: getSession() → профиль + активные роли из БД (RLS-aware)
 *      → store.setSupabaseUser(User)
 *   2. onAuthStateChange:
 *        SIGNED_IN / USER_UPDATED → перечитать профиль и синхронизировать
 *        SIGNED_OUT               → store.setSupabaseUser(null)
 *
 * NB: mock-модалка (auth-modal.tsx) продолжает работать как раньше —
 *     она пишет в store сама, а этот компонент не конфликтует (последний
 *     записавший выигрывает; на public-страницах Supabase-сессии нет).
 */

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { User } from "@/lib/types";
import type { user_role } from "@/lib/supabase/types";

async function fetchStoreUser(): Promise<User | null> {
  const {
    data: { session },
  } = await supabaseBrowser.auth.getSession();
  const authUser = session?.user;
  if (!authUser) return null;

  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabaseBrowser.from("profiles").select("*").eq("id", authUser.id).single(),
    supabaseBrowser
      .from("user_roles")
      .select("role")
      .eq("user_id", authUser.id)
      .eq("is_active", true),
  ]);

  return {
    id: authUser.id,
    email: authUser.email ?? "",
    name: profile?.name || authUser.user_metadata?.name || authUser.email?.split("@")[0] || "Пользователь",
    phone: profile?.phone ?? authUser.phone ?? undefined,
    avatar: profile?.avatar_url ?? authUser.user_metadata?.avatar_url ?? undefined,
    roles: (roles?.map((r) => r.role as user_role) ?? ["CUSTOMER"]) as User["roles"],
    createdAt: profile?.created_at ?? authUser.created_at ?? new Date().toISOString(),
    city: profile?.city ?? undefined,
  };
}

export function SupabaseAuthSync() {
  const setSupabaseUser = useAppStore((s) => s.setSupabaseUser);

  useEffect(() => {
    let cancelled = false;

    // 1. Начальная сессия
    fetchStoreUser().then((user) => {
      if (!cancelled) setSupabaseUser(user);
    });

    // 2. Подписка на изменения сессии
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === "SIGNED_OUT") {
        setSupabaseUser(null);
        return;
      }
      if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "TOKEN_REFRESHED") {
        fetchStoreUser().then((user) => {
          if (!cancelled) setSupabaseUser(user);
        });
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [setSupabaseUser]);

  return null;
}
