/**
 * courier-assignments.ts — серверный источник истины по назначению курьеров.
 *
 * Первопричина (P1, courier-path audit): HTTP/Socket-код курьера был написан
 * против фантомной колонки orders.courier_id (удалённая Prisma-схема). В
 * реальной БД назначение — строка в deliveries (order_id + courier_id, FK
 * на orders/auth.users). Ссылки на orders.courier_id давали PGRST204/42703
 * (500) на каждом запросе курьерского API.
 *
 * Этот модуль — единая точка чтения назначений для всех courier-роутов.
 * Клиентский payload назначением не считается — только серверные данные БД.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

/** id заказов, назначенных курьеру (deliveries.courier_id). */
export async function getCourierOrderIds(courierId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("deliveries")
    .select("order_id")
    .eq("courier_id", courierId) as { data: { order_id: string }[] | null; error: { message: string } | null };
  if (error) {
    console.error("[courier-assignments] fetch error:", error.message);
    return [];
  }
  return [...new Set((data || []).map((d) => d.order_id))];
}

/**
 * Назначен ли курьер на конкретный заказ (по серверным данным deliveries).
 * Используется GET /api/orders/[id] и courier:location в chat-server
 * (через HTTP-ответ, где deliveries вложены как order.delivery[]).
 */
export function isCourierAssignedToOrder(
  order: {
    courier_id?: string | null;
    courierId?: string | null;
    delivery?: { courier_id?: string | null }[] | null;
  } | null | undefined,
  courierId: string
): boolean {
  if (!order) return false;
  if (order.courier_id === courierId || order.courierId === courierId) return true;
  const rows = Array.isArray(order.delivery) ? order.delivery : [];
  return rows.some((d) => d?.courier_id === courierId);
}
