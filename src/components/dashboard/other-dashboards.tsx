/**
 * other-dashboards.tsx — THIN RE-EXPORT (v2.0).
 *
 * Раньше это был монолитный файл 1098 строк с 3 дашбордами:
 *   - SupplierDashboard
 *   - CourierDashboard
 *   - AdminDashboard
 *
 * Теперь каждый дашборд вынесен в отдельный файл:
 *   - supplier-dashboard.tsx (типизирован, без @ts-nocheck, TanStack Query)
 *   - courier-dashboard.tsx (типизирован, без @ts-nocheck, TanStack Query)
 *   - admin-dashboard.tsx (типизирован, без @ts-nocheck, TanStack Query)
 *
 * Этот файл оставляет обратную совместимость — все импорты из "@/components/dashboard/other-dashboards"
 * продолжают работать. Внутри просто реэкспортирует из новых файлов.
 *
 * @deprecated Используйте прямые импорты из новых файлов вместо этого.
 */

export { SupplierDashboard } from "@/components/dashboard/supplier-dashboard";
export { CourierDashboard } from "@/components/dashboard/courier-dashboard";
export { AdminDashboard } from "@/components/dashboard/admin-dashboard";
