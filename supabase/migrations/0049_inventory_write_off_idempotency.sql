-- 0049_inventory_write_off_idempotency.sql
--
-- Идемпотентность батч-списания склада по заказу (закрытие известного
-- ограничения «batch write-off не идемпотентен»).
--
-- Проблема (worklog, production-audit): POST /api/inventory/write-off при
-- сетевом ретрае/двойной отправке одного и того же тела записывал движения
-- повторно → двойное списание остатка и дубли журнала.
--
-- Решение: реестр списаний inventory_write_offs. Сигнатура батча =
-- отсортированный список "item_id:quantity". Уникальный ключ
-- (owner_id, order_id, signature) на уровне БД: параллельные/повторные
-- отправки того же батча дают ровно один бизнес-эффект — вторая попытка
-- получает сохранённый результат (idempotent). Списания без order_id
-- не дедуплицируются (нет бизнес-ключа) — поведение как раньше.

CREATE TABLE IF NOT EXISTS public.inventory_write_offs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id UUID,
  signature TEXT NOT NULL,
  items JSONB NOT NULL,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_inventory_write_off_batch UNIQUE (owner_id, order_id, signature)
);

COMMENT ON TABLE public.inventory_write_offs IS
  'Реестр батч-списаний склада: дедупликация повторных/параллельных запросов по (owner_id, order_id, signature)';

CREATE INDEX IF NOT EXISTS idx_inventory_write_offs_order
  ON public.inventory_write_offs(order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_write_offs_owner_created
  ON public.inventory_write_offs(owner_id, created_at DESC);
