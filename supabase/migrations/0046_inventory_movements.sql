-- 0046_inventory_movements.sql
--
-- Журнал движений склада для inventory_items (складской учёт кондитера).
--
-- История: таблица stock_movements (0010) ссылается на legacy-таблицу inventory
-- (inventory_id), не содержит user_id/order_id и не подходит для аудита списаний
-- по заказам. Новая таблица inventory_movements — канонический журнал для API
-- /api/inventory/movements и /api/inventory/write-off:
--   • IN      — приход (поставка): new_qty = quantity + q
--   • OUT     — списание (заказ/брак): new_qty = quantity - q (не ниже 0)
--   • ADJUST  — корректировка: new_qty = q (абсолютное значение)
--
-- Примечание: транзакционность «insert движения + update остатка» на стороне
-- supabase-js (PostgREST-шим) недоступна — API пишет движение первым, затем
-- обновляет остаток; при сбое update строка журнала остаётся (acceptably).

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('IN', 'OUT', 'ADJUST')),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  reason TEXT,
  order_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_movements IS
  'Журнал движений склада (IN/OUT/ADJUST) по inventory_items; order_id — необязательная привязка к заказу';
COMMENT ON COLUMN public.inventory_movements.type IS
  'IN = приход, OUT = списание, ADJUST = корректировка (absolute set)';

-- GET /api/inventory/movements: журнал по позициям пользователя, ?item_id= фильтр
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_created
  ON public.inventory_movements(item_id, created_at DESC);

-- Аудит списаний по заказу (write-off): найти все движения заказа
CREATE INDEX IF NOT EXISTS idx_inventory_movements_order
  ON public.inventory_movements(order_id)
  WHERE order_id IS NOT NULL;

-- Движения конкретного пользователя (owner-скоуп)
CREATE INDEX IF NOT EXISTS idx_inventory_movements_user_created
  ON public.inventory_movements(user_id, created_at DESC);
