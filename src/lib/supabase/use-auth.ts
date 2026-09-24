"use client";

/**
 * use-auth.ts — React hook для работы с Supabase Auth.
 *
 * Включает:
 *   - useAuth() — текущий пользователь + профиль + роли
 *   - useSignIn() — мутация входа
 *   - useSignUp() — мутация регистрации
 *   - useSignOut() — выход
 *   - useOAuth() — OAuth вход (Google, Яндекс, VK)
 *   - useResetPassword() — сброс пароля
 *   - useUpdatePassword() — обновление пароля
 *
 * Под капотом использует @supabase/ssr для управления cookies.
 * Подписывается на onAuthStateChange — обновляется при login/logout.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { Profile, user_role, UserWithRoles } from "@/lib/supabase/types";

// ==================== useAuth — текущий пользователь ====================
export function useAuth() {
  const [state, setState] = React.useState<{
    user: UserWithRoles | null;
    profile: Profile | null;
    isLoading: boolean;
  }>({ user: null, profile: null, isLoading: true });

  // Подписка на onAuthStateChange
  React.useEffect(() => {
    let isMounted = true;

    // Получить текущую сессию
    supabaseBrowser.auth.getSession().then(async ({ data: { session } }) => {
      if (!isMounted) return;
      if (!session?.user) {
        setState({ user: null, profile: null, isLoading: false });
        return;
      }

      // Загрузить профиль и роли
      const { data: profile } = await supabaseBrowser
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();

      const { data: roles } = await supabaseBrowser
        .from("user_roles")
        .select("role, is_active")
        .eq("user_id", session.user.id)
        .eq("is_active", true);

      const user: UserWithRoles = {
        id: session.user.id,
        email: session.user.email || "",
        name: profile?.name || session.user.email?.split("@")[0] || "Пользователь",
        avatar_url: profile?.avatar_url || session.user.user_metadata?.avatar_url || null,
        roles: (roles || []).map((r) => r.role as user_role),
      };

      setState({ user, profile: profile as Profile, isLoading: false });
    });

    // Подписка на изменения сессии (login/logout/refresh)
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange(
      async (_event, session) => {
        if (!isMounted) return;
        if (!session?.user) {
          setState({ user: null, profile: null, isLoading: false });
          return;
        }

        const { data: profile } = await supabaseBrowser
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .single();

        const { data: roles } = await supabaseBrowser
          .from("user_roles")
          .select("role, is_active")
          .eq("user_id", session.user.id)
          .eq("is_active", true);

        const user: UserWithRoles = {
          id: session.user.id,
          email: session.user.email || "",
          name: profile?.name || session.user.email?.split("@")[0] || "Пользователь",
          avatar_url: profile?.avatar_url || session.user.user_metadata?.avatar_url || null,
          roles: (roles || []).map((r) => r.role as user_role),
        };

        setState({ user, profile: profile as Profile, isLoading: false });
      }
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}

// ==================== useSignIn ====================
interface SignInInput {
  email: string;
  password: string;
}

export function useSignIn() {
  const router = useRouter();
  return useMutation({
    mutationFn: async ({ email, password }: SignInInput) => {
      const { data, error } = await supabaseBrowser.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Добро пожаловать!", {
        description: "Вы успешно вошли в систему.",
      });
      router.refresh();
    },
    onError: (error: { message?: string }) => {
      toast.error("Ошибка входа", { description: error.message });
    },
  });
}

// ==================== useSignUp ====================
interface SignUpInput {
  email: string;
  password: string;
  name: string;
  phone?: string;
}

export function useSignUp() {
  const router = useRouter();
  return useMutation({
    mutationFn: async ({ email, password, name, phone }: SignUpInput) => {
      const { data, error } = await supabaseBrowser.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            phone,
          },
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      toast.success("Регистрация успешна!", {
        description: `Добро пожаловать, ${variables.name}! Проверьте почту для подтверждения.`,
      });
      router.refresh();
    },
    onError: (error: { message?: string }) => {
      toast.error("Ошибка регистрации", { description: error.message });
    },
  });
}

// ==================== useMagicLink ====================
export function useMagicLink() {
  return useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabaseBrowser.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    },
    onSuccess: (_data, email) => {
      toast.success("Письмо отправлено!", {
        description: `Магическая ссылка отправлена на ${email}. Проверьте почту.`,
      });
    },
    onError: (error: { message?: string }) => {
      toast.error("Ошибка отправки", { description: error.message });
    },
  });
}

// ==================== useSignOut ====================
export function useSignOut() {
  const router = useRouter();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabaseBrowser.auth.signOut();
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Вы вышли из системы");
      router.push("/");
      router.refresh();
    },
    onError: (error: { message?: string }) => {
      toast.error("Ошибка выхода", { description: error.message });
    },
  });
}

// ==================== useOAuth (Google/Яндекс/VK) ====================
type OAuthProvider = "google" | "yandex" | "vk";

export function useOAuth() {
  return useMutation({
    mutationFn: async (provider: OAuthProvider) => {
      const { data, error } = await supabaseBrowser.auth.signInWithOAuth({
        provider: provider as "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
      return data;
    },
    onError: (error: { message?: string }) => {
      toast.error("Ошибка OAuth", { description: error.message });
    },
  });
}

// ==================== useResetPassword ====================
export function useResetPassword() {
  return useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabaseBrowser.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (error) throw error;
    },
    onSuccess: (_data, email) => {
      toast.success("Письмо отправлено", {
        description: `Инструкции по сбросу пароля отправлены на ${email}`,
      });
    },
    onError: (error: { message?: string }) => {
      toast.error("Ошибка сброса пароля", { description: error.message });
    },
  });
}

// ==================== useUpdatePassword ====================
export function useUpdatePassword() {
  const router = useRouter();
  return useMutation({
    mutationFn: async ({ newPassword }: { newPassword: string }) => {
      const { error } = await supabaseBrowser.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Пароль изменён", {
        description: "Теперь вы можете войти с новым паролем.",
      });
      router.push("/dashboard");
    },
    onError: (error: { message?: string }) => {
      toast.error("Ошибка смены пароля", { description: error.message });
    },
  });
}

// ==================== useUpdateProfile ====================
interface UpdateProfileInput {
  name?: string;
  phone?: string;
  bio?: string;
  avatar_url?: string;
  city?: string;
}

export function useUpdateProfile() {
  return useMutation({
    mutationFn: async (input: UpdateProfileInput) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const { data, error } = await supabaseBrowser
        .from("profiles")
        .update(input)
        .eq("id", user.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Профиль обновлён");
    },
    onError: (error: { message?: string }) => {
      toast.error("Ошибка обновления профиля", { description: error.message });
    },
  });
}

// ==================== useUploadAvatar (через Supabase Storage) ====================
export function useUploadAvatar() {
  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      // Уникальное имя файла
      const fileExt = file.name.split(".").pop();
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      // Загрузить в bucket "avatars"
      const { error: uploadError } = await supabaseBrowser.storage
        .from("avatars")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Получить публичный URL
      const { data: { publicUrl } } = supabaseBrowser.storage
        .from("avatars")
        .getPublicUrl(filePath);

      // Обновить profile.avatar_url
      await supabaseBrowser
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", user.id);

      return publicUrl;
    },
    onSuccess: () => {
      toast.success("Аватар загружен");
    },
    onError: (error: { message?: string }) => {
      toast.error("Ошибка загрузки аватара", { description: error.message });
    },
  });
}
