/**
 * use-cms.ts — TanStack Query hooks для CMS (страницы, баннеры, навигация, настройки).
 *
 * Query hooks:
 *   - useCmsPages() — список CMS страниц
 *   - useCmsPage(slug) — конкретная страница по slug
 *   - useCmsBanners(position?) — баннеры (с активными датами показа)
 *   - useNavMenu(location) — пункты меню (header/footer/mobile)
 *   - useSiteSettings(category?) — настройки сайта
 *   - usePromoCodes() — промокоды (для admin)
 *   - useModerationQueue(status?) — очередь модерации (для admin/moderator)
 *
 * Mutation hooks:
 *   - useCreateCmsPage() — создать страницу
 *   - useUpdateCmsPage() — обновить страницу (через @mdxeditor)
 *   - useDeleteCmsPage() — удалить (soft delete)
 *   - useCreateBanner() — создать баннер
 *   - useUpdateBanner() — обновить баннер
 *   - useUpdateNavMenu() — обновить пункт меню
 *   - useUpdateSiteSetting() — обновить настройку
 *   - useCreatePromoCode() — создать промокод
 *   - useValidatePromoCode() — валидировать промокод при checkout
 *   - useModerateContent() — одобрить/отклонить контент в очереди
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/browser";

// ==================== Types ====================
export interface CmsPage {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  content: string;
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords: string[] | null;
  status: string;
  is_in_menu: boolean;
  menu_order: number;
  parent_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CmsBanner {
  id: string;
  title: string;
  image_url: string | null;
  link_url: string | null;
  position: string;
  text: string | null;
  cta_text: string | null;
  starts_at: string | null;
  ends_at: string | null;
  target_audience: string[] | null;
  is_active: boolean;
  sort_order: number;
  impressions_count: number;
  clicks_count: number;
  created_at: string;
}

export interface NavMenuItem {
  id: string;
  location: string;
  label: string;
  url: string;
  icon: string | null;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  show_for_roles: string[] | null;
  show_for_authenticated: boolean | null;
  created_at: string;
}

export interface SiteSetting {
  key: string;
  value: string;
  value_type: string;
  description: string | null;
  category: string;
  is_public: boolean;
  updated_at: string;
}

export interface PromoCode {
  id: string;
  code: string;
  description: string | null;
  type: string;
  value: number;
  min_order_amount: number;
  max_uses: number | null;
  used_count: number;
  valid_from: string;
  valid_to: string | null;
  applies_to: string;
  target_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ModerationItem {
  id: string;
  content_type: string;
  content_id: string;
  author_id: string | null;
  auto_status: string;
  auto_reason: string | null;
  manual_status: string | null;
  moderated_by: string | null;
  moderated_at: string | null;
  moderation_comment: string | null;
  content_snapshot: Record<string, unknown> | null;
  created_at: string;
}

// ==================== Query hooks ====================

/** Список CMS страниц */
export function useCmsPages() {
  return useQuery<CmsPage[]>({
    queryKey: ["cms-pages"],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("cms_pages")
        .select("*")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });

      if (error) throw new Error(error.message);
      return (data || []) as CmsPage[];
    },
    staleTime: 60 * 1000,
  });
}

/** Конкретная CMS страница по slug */
export function useCmsPage(slug: string | null) {
  return useQuery<CmsPage>({
    queryKey: ["cms-page", slug],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("cms_pages")
        .select("*")
        .eq("slug", slug)
        .eq("status", "published")
        .is("deleted_at", null)
        .single();

      if (error) throw new Error(error.message);
      return data as CmsPage;
    },
    enabled: Boolean(slug),
  });
}

/** Баннеры по позиции (с фильтром по активным датам) */
export function useCmsBanners(position?: string) {
  return useQuery<CmsBanner[]>({
    queryKey: ["cms-banners", position],
    queryFn: async () => {
      const now = new Date().toISOString();
      let query = supabaseBrowser
        .from("cms_banners")
        .select("*")
        .eq("is_active", true)
        .or(`starts_at.is.null,starts_at.lte.${now}`)
        .or(`ends_at.is.null,ends_at.gte.${now}`)
        .order("sort_order", { ascending: true });

      if (position) {
        query = query.eq("position", position);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data || []) as CmsBanner[];
    },
    staleTime: 5 * 60 * 1000, // 5 минут (баннеры меняются редко)
  });
}

/** Пункты меню по локации */
export function useNavMenu(location: "header" | "footer" | "mobile") {
  return useQuery<NavMenuItem[]>({
    queryKey: ["nav-menu", location],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("cms_nav_menu")
        .select("*")
        .eq("location", location)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error) throw new Error(error.message);
      return (data || []) as NavMenuItem[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Настройки сайта по категории */
export function useSiteSettings(category?: string) {
  return useQuery<SiteSetting[]>({
    queryKey: ["site-settings", category],
    queryFn: async () => {
      let query = supabaseBrowser
        .from("cms_site_settings")
        .select("*")
        .eq("is_public", true)
        .order("category", { ascending: true });

      if (category) {
        query = query.eq("category", category);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data || []) as SiteSetting[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Промокоды (для admin) */
export function usePromoCodes() {
  return useQuery<PromoCode[]>({
    queryKey: ["promo-codes"],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("promo_codes")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);
      return (data || []) as PromoCode[];
    },
    staleTime: 60 * 1000,
  });
}

/** Очередь модерации (для admin/moderator) */
export function useModerationQueue(status?: "pending" | "approved" | "rejected" | "flagged") {
  return useQuery<ModerationItem[]>({
    queryKey: ["moderation-queue", status],
    queryFn: async () => {
      let query = supabaseBrowser
        .from("moderation_queue")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (status) {
        query = query.or(`auto_status.eq.${status},manual_status.eq.${status}`);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data || []) as ModerationItem[];
    },
    staleTime: 30 * 1000,
  });
}

// ==================== Mutation hooks ====================

/** Создать CMS страницу */
export function useCreateCmsPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (page: Partial<CmsPage>) => {
      const { data, error } = await supabaseBrowser
        .from("cms_pages")
        .insert(page)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      toast.success("Страница создана");
    },
    onError: (error: Error) => {
      toast.error("Ошибка", { description: error.message });
    },
  });
}

/** Обновить CMS страницу */
export function useUpdateCmsPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CmsPage> & { id: string }) => {
      const { data, error } = await supabaseBrowser
        .from("cms_pages")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      toast.success("Страница обновлена");
    },
    onError: (error: Error) => {
      toast.error("Ошибка", { description: error.message });
    },
  });
}

/** Удалить CMS страницу (soft delete) */
export function useDeleteCmsPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pageId: string) => {
      const { error } = await supabaseBrowser
        .from("cms_pages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", pageId);

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      toast.success("Страница удалена");
    },
  });
}

/** Создать баннер */
export function useCreateBanner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (banner: Partial<CmsBanner>) => {
      const { data, error } = await supabaseBrowser
        .from("cms_banners")
        .insert(banner)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-banners"] });
      toast.success("Баннер создан");
    },
  });
}

/** Обновить баннер */
export function useUpdateBanner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CmsBanner> & { id: string }) => {
      const { data, error } = await supabaseBrowser
        .from("cms_banners")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-banners"] });
      toast.success("Баннер обновлён");
    },
  });
}

/** Обновить пункт меню */
export function useUpdateNavMenuItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<NavMenuItem> & { id: string }) => {
      const { data, error } = await supabaseBrowser
        .from("cms_nav_menu")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nav-menu"] });
      toast.success("Меню обновлено");
    },
  });
}

/** Обновить настройку сайта */
export function useUpdateSiteSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const { data, error } = await supabaseBrowser
        .from("cms_site_settings")
        .update({ value })
        .eq("key", key)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
      toast.success("Настройка обновлена");
    },
  });
}

/** Создать промокод */
export function useCreatePromoCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (promo: Partial<PromoCode>) => {
      const { data, error } = await supabaseBrowser
        .from("promo_codes")
        .insert(promo)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promo-codes"] });
      toast.success("Промокод создан");
    },
  });
}

/** Валидировать промокод (при checkout) */
export function useValidatePromoCode() {
  return useMutation({
    mutationFn: async ({ code, orderAmount }: { code: string; orderAmount: number }) => {
      const { data, error } = await supabaseBrowser
        .from("promo_codes")
        .select("*")
        .eq("code", code)
        .eq("is_active", true)
        .single();

      if (error || !data) {
        throw new Error("Промокод не найден или неактивен");
      }

      const promo = data as PromoCode;
      const now = new Date();

      // Проверка срока действия
      if (promo.valid_from && new Date(promo.valid_from) > now) {
        throw new Error("Промокод ещё не действует");
      }
      if (promo.valid_to && new Date(promo.valid_to) < now) {
        throw new Error("Промокод истёк");
      }

      // Проверка минимальной суммы
      if (promo.min_order_amount > 0 && orderAmount < promo.min_order_amount) {
        throw new Error(`Минимальная сумма заказа: ${promo.min_order_amount / 100}₽`);
      }

      // Проверка лимита использований
      if (promo.max_uses !== null && promo.used_count >= promo.max_uses) {
        throw new Error("Лимит использований исчерпан");
      }

      // Считаем скидку
      let discountAmount = 0;
      if (promo.type === "percent") {
        discountAmount = Math.round((orderAmount * promo.value) / 100);
      } else if (promo.type === "fixed") {
        discountAmount = promo.value;
      } else if (promo.type === "free_delivery") {
        discountAmount = promo.value; // стоимость доставки
      }

      return {
        promoCode: promo,
        discountAmount,
        finalAmount: Math.max(0, orderAmount - discountAmount),
      };
    },
    onError: (error: Error) => {
      toast.error("Промокод недействителен", { description: error.message });
    },
  });
}

/** Модерация контента (одобрить/отклонить) */
export function useModerateContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      moderationId,
      status,
      comment,
    }: {
      moderationId: string;
      status: "approved" | "rejected" | "flagged";
      comment?: string;
    }) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const { data, error } = await supabaseBrowser
        .from("moderation_queue")
        .update({
          manual_status: status,
          moderated_by: user.id,
          moderated_at: new Date().toISOString(),
          moderation_comment: comment,
        })
        .eq("id", moderationId)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["moderation-queue"] });
      toast.success("Контент промодерирован");
    },
    onError: (error: Error) => {
      toast.error("Ошибка", { description: error.message });
    },
  });
}
