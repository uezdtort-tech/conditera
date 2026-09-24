/**
 * role-guards.ts — серверная утилита для проверки ролей и прав доступа.
 *
 * В отличие от use-rbac.ts (react hooks для client components),
 * этот модуль используется в:
 *   - API route handlers (src/app/api/...)
 *   - Server components (src/components/pages/...)
 *   - Middleware / Edge runtime
 *
 * Использует supabaseAdmin для проверки user_roles в обход RLS
 * (для случая когда пользователь ещё не имеет session в Supabase Auth
 * но мы хотим проверить его роли по user_id).
 *
 * Все функции возвращают Promise<boolean> — это позволяет использовать
 * их в conditions и guard-clauses.
 *
 * @module @/lib/role-guards
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { user_role } from "@/lib/supabase/types";

/**
 * Получить все активные роли пользователя (по user_id).
 * Возвращает пустой массив если:
 *   - пользователь не существует
 *   - нет активных ролей
 *   - Supabase admin не сконфигурирован
 *
 * @example
 * const roles = await getUserRoles(userId);
 * if (!roles.includes("ADMIN")) return NextResponse.json({error: "Forbidden"}, {status: 403});
 */
export async function getUserRoles(userId: string): Promise<user_role[]> {
  // Guard: если Supabase не сконфигурирован — возвращаем пустой массив
  // (это позволяет тестам работать без реального Supabase)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("is_active", true);
  if (error) {
    console.error("[role-guards] getUserRoles error:", error.message);
    return [];
  }
  return (data || []).map((r) => r.role as user_role);
}

/**
 * Проверить, имеет ли пользователь указанную роль.
 *
 * @example
 * if (await hasRole(userId, "ADMIN")) { ... }
 */
export async function hasRole(userId: string, role: user_role): Promise<boolean> {
  const roles = await getUserRoles(userId);
  return roles.includes(role);
}

/**
 * Проверить, имеет ли пользователь хотя бы одну из указанных ролей.
 * Используется для endpoints доступных нескольким ролям (например CONFECTIONER + ADMIN).
 *
 * @example
 * if (!(await hasAnyRole(userId, ["CONFECTIONER", "ADMIN"]))) {
 *   return NextResponse.json({error: "Forbidden"}, {status: 403});
 * }
 */
export async function hasAnyRole(
  userId: string,
  roles: user_role[]
): Promise<boolean> {
  if (roles.length === 0) return false;
  const userRoles = await getUserRoles(userId);
  return roles.some((r) => userRoles.includes(r));
}

/**
 * Проверить, имеет ли пользователь все указанные роли.
 * Редкий кейс — например, FRANCHISEE + ADMIN (франчайзи, который также администратор).
 */
export async function hasAllRoles(
  userId: string,
  roles: user_role[]
): Promise<boolean> {
  if (roles.length === 0) return true;
  const userRoles = await getUserRoles(userId);
  return roles.every((r) => userRoles.includes(r));
}

/**
 * Проверить, является ли пользователь администратором (ADMIN или SUPER_ADMIN).
 */
export async function isAdmin(userId: string): Promise<boolean> {
  return hasAnyRole(userId, ["ADMIN", "SUPER_ADMIN"]);
}

/**
 * Проверить, является ли пользователь супер-администратором (только SUPER_ADMIN).
 * SUPER_ADMIN имеет полный доступ ко всем системным настройкам.
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  return hasRole(userId, "SUPER_ADMIN");
}

/**
 * Helper для RBAC — выдать 403 если у пользователя нет нужной роли.
 * Возвращает NextResponse или null (если доступ разрешён).
 *
 * @example
 * import { requireRole, forbidden } from "@/lib/role-guards";
 *
 * export async function POST(req: NextRequest) {
 *   const userId = await getCurrentUserId(req);
 *   const guard = await requireRole(userId, "ADMIN");
 *   if (guard) return guard; // 403 Forbidden
 *   // ... proceed
 * }
 */
export async function requireRole(
  userId: string | null | undefined,
  role: user_role
): Promise<Response | null> {
  if (!userId) {
    return new Response(
      JSON.stringify({ error: "Необходима аутентификация" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
  const has = await hasRole(userId, role);
  if (!has) {
    return new Response(
      JSON.stringify({
        error: `Требуется роль: ${role}`,
        required_role: role,
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
  return null; // доступ разрешён
}

/**
 * То же что requireRole, но для проверки нескольких ролей (ИЛИ).
 */
export async function requireAnyRole(
  userId: string | null | undefined,
  roles: user_role[]
): Promise<Response | null> {
  if (!userId) {
    return new Response(
      JSON.stringify({ error: "Необходима аутентификация" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
  if (roles.length === 0) return null; // нет требований — доступ открыт
  const has = await hasAnyRole(userId, roles);
  if (!has) {
    return new Response(
      JSON.stringify({
        error: `Требуется одна из ролей: ${roles.join(", ")}`,
        required_roles: roles,
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
  return null;
}

/**
 * Проверить, может ли пользователь редактировать профиль другого пользователя.
 * Разрешено если:
 *   - это свой профиль
 *   - пользователь ADMIN или SUPER_ADMIN
 */
export async function canEditUser(
  editorId: string,
  targetUserId: string
): Promise<boolean> {
  if (editorId === targetUserId) return true;
  return isAdmin(editorId);
}

/**
 * Получить роль с максимальным приоритетом для пользователя.
 * Например, если у пользователя роли [CUSTOMER, CONFECTIONER, FRANCHISEE],
 * вернуть FRANCHISEE (самая «административная»).
 *
 * Используется для выбора дашборда по умолчанию.
 */
export async function getPrimaryRole(userId: string): Promise<user_role | null> {
  const roles = await getUserRoles(userId);
  if (roles.length === 0) return null;

  // Приоритет ролей (от высокого к низкому)
  const PRIORITY: user_role[] = [
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

  for (const role of PRIORITY) {
    if (roles.includes(role)) return role;
  }
  return roles[0];
}

/**
 * Описание ролей для UI (метаданные).
 * Можно использовать в дашборде для отображения названия роли и её иконки.
 */
export const ROLE_LABELS: Record<user_role, { label: string; group: string; icon: string }> = {
  CUSTOMER: { label: "Покупатель", group: "Покупатели", icon: "shopping-bag" },
  CORPORATE_CLIENT: { label: "Корпоративный клиент", group: "Покупатели", icon: "building" },
  GUEST: { label: "Гость", group: "Покупатели", icon: "user" },
  CONFECTIONER: { label: "Кондитер", group: "Исполнители", icon: "cake" },
  COURIER: { label: "Курьер", group: "Исполнители", icon: "truck" },
  STUDIO: { label: "Фотостудия", group: "Исполнители", icon: "camera" },
  ANIMATOR_AGENCY: { label: "Аниматор", group: "Исполнители", icon: "sparkles" },
  RECREATION_CENTER: { label: "База отдыха", group: "Исполнители", icon: "trees" },
  KIDS_CLUB: { label: "Детский клуб", group: "Исполнители", icon: "baby" },
  SUPPLIER: { label: "Поставщик", group: "Партнёры", icon: "package" },
  WHOLESALER: { label: "Оптовик", group: "Партнёры", icon: "boxes" },
  VENUE_OWNER: { label: "Владелец площадки", group: "Партнёры", icon: "map-pin" },
  FOOD_SERVICE: { label: "HoReCa-партнёр", group: "Партнёры", icon: "utensils-crossed" },
  EVENT_ORGANIZER: { label: "Организатор событий", group: "Партнёры", icon: "calendar" },
  PICKUP_POINT: { label: "Пункт выдачи", group: "Партнёры", icon: "package-check" },
  MODERATOR: { label: "Модератор", group: "Контроль", icon: "shield" },
  QUALITY_INSPECTOR: { label: "Инспектор качества", group: "Контроль", icon: "clipboard-check" },
  NUTRITIONIST: { label: "Нутрициолог", group: "Контроль", icon: "leaf" },
  CERTIFICATION_AGENT: { label: "Агент сертификации", group: "Контроль", icon: "badge-check" },
  INSPECTOR: { label: "Финансовый аудитор", group: "Контроль", icon: "search" },
  BLOGGER: { label: "Блогер", group: "Контент", icon: "pen-tool" },
  COPYWRITER: { label: "Копирайтер", group: "Контент", icon: "file-text" },
  TASTER: { label: "Дегустатор", group: "Контент", icon: "utensils" },
  ADMIN: { label: "Администратор", group: "Администрирование", icon: "settings" },
  SUPER_ADMIN: { label: "Супер-админ", group: "Администрирование", icon: "crown" },
  SUPPORT: { label: "Поддержка", group: "Администрирование", icon: "headphones" },
  FRANCHISEE: { label: "Франчайзи", group: "Франшиза", icon: "store" },
  RECIPE_DEVELOPER: { label: "Разработчик рецептов", group: "Новые роли", icon: "book-open" },
  LOYALTY_PARTNER: { label: "Партнёр лояльности", group: "Новые роли", icon: "gift" },
  AI_ASSISTANT: { label: "AI-ассистент", group: "Новые роли", icon: "bot" },
};
