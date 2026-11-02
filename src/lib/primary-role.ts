/**
 * primary-role.ts — client-safe выбор главной роли пользователя.
 *
 * Первопричина (смена кабинета при переключении аккаунта):
 *   setSupabaseUser выбирал activeRole = user.roles[0], а у мультит-рольных
 *   аккаунтов (например, курьер: roles = ["CUSTOMER", "COURIER"]) первая роль —
 *   CUSTOMER. Кабинет после логина курьером открывался покупательским.
 *
 * Канонический серверный источник иерархии — role-guards.getPrimaryRole
 * (DB-вариант). Массив ROLE_PRIORITY вынесен сюда как единый источник
 * правды: role-guards.ts импортирует его же, поэтому расхождений нет.
 * Модуль НЕ импортирует server-зависимости (supabaseAdmin) — безопасен
 * для клиентских бандлов.
 *
 * @module @/lib/primary-role
 */

import type { user_role } from "@/lib/supabase/types";
import type { ViewKey } from "@/lib/types";

/**
 * Приоритет ролей (от высокой к низкой) — «административные» и
 * специализированные роли главнее CUSTOMER при выборе кабинета.
 * ДОЛЖЕН совпадать с иерархией role-guards.getPrimaryRole (единый импорт).
 */
export const ROLE_PRIORITY: user_role[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "INSPECTOR",
  "FRANCHISEE",
  "CERTIFICATION_AGENT",
  "QUALITY_INSPECTOR",
  "NUTRITIONIST",
  "MODERATOR",
  "SUPPORT",
  "CORPORATE_CLIENT",
  "WHOLESALER",
  "FOOD_SERVICE",
  "EVENT_ORGANIZER",
  "PICKUP_POINT",
  "VENUE_OWNER",
  "ANIMATOR_AGENCY",
  "RECREATION_CENTER",
  "KIDS_CLUB",
  "STUDIO",
  "SUPPLIER",
  "RECIPE_DEVELOPER",
  "LOYALTY_PARTNER",
  "CONFECTIONER",
  "COURIER",
  "BLOGGER",
  "TASTER",
  "COPYWRITER",
  "AI_ASSISTANT",
  "CUSTOMER",
  "GUEST",
];

/**
 * Синхронный выбор главной роли из набора ролей пользователя
 * (client-аналог getPrimaryRole). При пустом наборе — GUEST.
 */
export function pickPrimaryRole(roles: readonly string[] | null | undefined): user_role {
  if (!roles || roles.length === 0) return "GUEST";
  for (const role of ROLE_PRIORITY) {
    if (roles.includes(role)) return role;
  }
  return (roles[0] as user_role) ?? "GUEST";
}

/**
 * Главная роль → view личного кабинета. Единый источник для:
 *   • store.setSupabaseUser (пересчёт view при смене пользователя);
 *   • /dashboard/page.tsx (первичная установка view по роли).
 */
export const dashboardViewByRole: Record<user_role, ViewKey> = {
  CUSTOMER: "dashboard-customer",
  CONFECTIONER: "dashboard-confectioner",
  STUDIO: "dashboard-confectioner",
  SUPPLIER: "dashboard-supplier",
  COURIER: "dashboard-courier",
  ADMIN: "dashboard-admin",
  SUPER_ADMIN: "dashboard-admin",
  RECIPE_DEVELOPER: "dashboard-recipe-developer",
  LOYALTY_PARTNER: "dashboard-loyalty-partner",
  // Расширенные и нишевые роли → ExtraDashboards
  MODERATOR: "dashboard-extra",
  SUPPORT: "dashboard-extra",
  BLOGGER: "dashboard-extra",
  TASTER: "dashboard-extra",
  FRANCHISEE: "dashboard-extra",
  NUTRITIONIST: "dashboard-extra",
  CORPORATE_CLIENT: "dashboard-extra",
  COPYWRITER: "dashboard-extra",
  FOOD_SERVICE: "dashboard-extra",
  EVENT_ORGANIZER: "dashboard-extra",
  PICKUP_POINT: "dashboard-extra",
  WHOLESALER: "dashboard-extra",
  QUALITY_INSPECTOR: "dashboard-extra",
  CERTIFICATION_AGENT: "dashboard-extra",
  VENUE_OWNER: "dashboard-extra",
  ANIMATOR_AGENCY: "dashboard-extra",
  RECREATION_CENTER: "dashboard-extra",
  KIDS_CLUB: "dashboard-extra",
  INSPECTOR: "dashboard-extra",
  GUEST: "dashboard-customer",
  AI_ASSISTANT: "dashboard-extra",
};
