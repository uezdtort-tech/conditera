/**
 * upload-role-guard.ts — ZV33-8d FIX B (D2): ролевой гвард загрузки файлов.
 *
 * Дефект D2: POST /api/upload и POST /api/services/upload принимали ЛЮБОГО
 * аутентифицированного пользователя («Auth: любой аутентифицированный» в
 * заголовках роутов) — покупатель мог заливать произвольные файлы. Роуты —
 * защищённые файлы (red-line), гвард реализован в middleware (src/proxy.ts)
 * через этот чистый хелпер; сами роуты не тронуты.
 *
 * Edge-safe: модуль без side-effects и без node-only зависимостей —
 * импортируется из proxy.ts (Edge Runtime) и из unit-тестов.
 *
 * Решение по ролям (по уликам использования, см. агент-запись ZV33-8d):
 *
 *   POST /api/services/upload — УПРАВЛЕНЧЕСКИЙ путь: единственный вызывающий
 *   в кодовой базе — services-manager.tsx:223 (фотографии услуг кондитера).
 *   Заголовок роута: «свои услуги добавляют в своих маршрутах». Клиентских
 *   (покупательских) использований НЕ найдено → allowed:
 *   CONFECTIONER / ADMIN / SUPER_ADMIN.
 *
 *   POST /api/upload — общий путь с ЛЕГИТИМНЫМИ покупательскими сценариями:
 *     • customer-dashboard.tsx:1436 — фото к отзывам (category="reviews",
 *       ownerType="customer"; роут /api/reviews принимает ≤3 URL из /api/upload);
 *     • customer-dashboard.tsx — вложения к обращениям в поддержку
 *       (category="tickets");
 *     • confectioner-atelier-tab (category="portfolio"), confectioner-lessons-tab
 *       (category="recipe") — кондитерские.
 *   Покупателя НЕЛЬЗЯ отрезать целиком (сломаются отзывы и тикеты), а
 *   инспектировать multipart-category в middleware нельзя (Next.js middleware
 *   не имеет доступа к телу запроса) → allowed: CONFECTIONER / ADMIN /
 *   SUPER_ADMIN / CUSTOMER (улика-обоснованное исключение, см. отчёт ZV33-8d).
 *
 * Аутентификация (какой JWT проверять) — забота proxy.ts: cookie cd_session,
 * HS256 через jose, роли из payload.roles (app-JWT от /api/auth/login).
 */

/** Пути загрузки файлов (POST), охраняемые middleware. */
export const UPLOAD_GUARD_PATHS = ["/api/upload", "/api/services/upload"] as const;

/** Роли управления контентом (услуги/товары/портфолио). */
export const UPLOAD_MANAGER_ROLES = [
  "CONFECTIONER",
  "ADMIN",
  "SUPER_ADMIN",
] as const;

/**
 * POST /api/services/upload — только управление услугами (улика: единственный
 * вызывающий — services-manager кондитера).
 */
export const UPLOAD_SERVICE_ALLOWED_ROLES: readonly string[] = UPLOAD_MANAGER_ROLES;

/**
 * POST /api/upload — общий путь: + CUSTOMER (фото отзывов category="reviews"
 * и вложения тикетов category="tickets" — легитимные покупательские сценарии).
 */
export const UPLOAD_GENERAL_ALLOWED_ROLES: readonly string[] = [
  ...UPLOAD_MANAGER_ROLES,
  "CUSTOMER",
];

/** Есть ли у набора ролей из JWT право на загрузку по конкретному пути. */
export function canUploadToPath(
  roles: readonly string[] | undefined | null,
  pathname: string
): boolean {
  const allowed =
    pathname === "/api/services/upload"
      ? UPLOAD_SERVICE_ALLOWED_ROLES
      : UPLOAD_GENERAL_ALLOWED_ROLES;
  return (roles || []).some((r) => allowed.includes(r));
}

/**
 * Точечный хелпер для управленческого пути (services/upload): покупатель —
 * false, кондитер/админ — true. Держим экспорт с той же сигнатурой, что
 * запросила задача, — удобен в тестах и для будущего сужения /api/upload.
 */
export function canUpload(role: string): boolean {
  return (UPLOAD_MANAGER_ROLES as readonly string[]).includes(role);
}
