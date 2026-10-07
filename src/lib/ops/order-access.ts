/**
 * order-access.ts — общий доступ к заказам для P0.5 API (ТЗ §43).
 *
 * Роли (существующая модель user_roles, ТЗ P0.5 §2: «использовать
 * существующие роли»):
 *   • CUSTOMER      — видит СВОИ заказы (user_id), свой lifecycle;
 *   • CONFECTIONER  — видит/оперирует НАЗНАЧЕННЫЕ заказы (confectioner_id);
 *   • ADMIN/SUPER_ADMIN/SUPPORT/COURIER — операционные данные;
 *   • MODERATOR/content-менеджеры — доступа к финансовым/производственным
 *     данным НЕТ (явно не входит в списки ниже, ТЗ §43).
 */

import { getPool } from "@/lib/postgrest/pool";

export interface OrderRowLite {
  id: string;
  number: string;
  status: string;
  user_id: string;
  confectioner_id: string | null;
  payment_status: string;
  delivery_date: string | null;
  delivery_time_window: string | null;
  delivery_time: string | null;
  delivery_type: string | null;
  delivery_city: string | null;
  total: number;
  created_at: string;
  is_draft: boolean;
}

export async function loadOrderLite(orderId: string): Promise<OrderRowLite | null> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const pool = getPool();
  const res = await pool.query<{
    id: string;
    number: string;
    status: string;
    user_id: string;
    confectioner_id: string | null;
    payment_status: string;
    delivery_date: string | null;
    delivery_time_window: string | null;
    delivery_time: string | null;
    delivery_type: string | null;
    delivery_city: string | null;
    total: number;
    created_at: Date;
    is_draft: boolean | null;
  }>(
    `SELECT id::text, number, status::text, user_id::text, confectioner_id::text,
            payment_status::text,
            to_char(delivery_date, 'YYYY-MM-DD') AS delivery_date,
            delivery_time_window, delivery_time, delivery_type, delivery_city,
            total, created_at, is_draft
     FROM public.orders WHERE id = $1::uuid`,
    [orderId]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    user_id: r.user_id,
    confectioner_id: r.confectioner_id,
    payment_status: r.payment_status,
    delivery_date: r.delivery_date,
    delivery_time_window: r.delivery_time_window,
    delivery_time: r.delivery_time,
    delivery_type: r.delivery_type,
    delivery_city: r.delivery_city,
    total: Number(r.total),
    created_at: new Date(r.created_at).toISOString(),
    is_draft: r.is_draft === true,
  };
}

const STAFF_VIEW_ROLES = ["ADMIN", "SUPER_ADMIN", "SUPPORT", "COURIER"] as const;

/** Может ли пользователь ВИДЕТЬ заказ (ТЗ §43). */
export function canViewOrder(order: OrderRowLite, userId: string): boolean {
  return order.user_id === userId || order.confectioner_id === userId;
}

/** Является ли пользователь операционным стаффом (админ/поддержка/курьер). */
export async function isOpsStaff(userId: string): Promise<boolean> {
  const { hasAnyRole } = await import("@/lib/role-guards");
  return hasAnyRole(userId, STAFF_VIEW_ROLES as unknown as Parameters<typeof hasAnyRole>[1]);
}

/** Может ли пользователь ВИДЕТЬ заказ (включая стафф-роли по БД). */
export async function canViewOrderChecked(
  order: OrderRowLite,
  userId: string
): Promise<boolean> {
  if (canViewOrder(order, userId)) return true;
  return isOpsStaff(userId);
}

/**
 * Может ли пользователь ОПЕРИРОВАТЬ производственным контуром заказа
 * (назначение, производство, готовность): назначенный кондитер или админ.
 */
export async function canOperateOrder(
  order: OrderRowLite,
  userId: string
): Promise<boolean> {
  if (order.confectioner_id === userId) return true;
  const { hasAnyRole } = await import("@/lib/role-guards");
  return hasAnyRole(userId, ["ADMIN", "SUPER_ADMIN"] as unknown as Parameters<typeof hasAnyRole>[1]);
}
