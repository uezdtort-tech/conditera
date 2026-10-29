-- 0061: FIX-TL — устранение дублей в order_status_history (одна строка на переход).
--
-- Причина дублей: триггер orders_log_status (миграция 0006, строки 178-192)
-- на каждый UPDATE orders.status писал строку истории с
-- changed_by = auth.uid(). В runtime приложения (service-role supabase-js,
-- pg-пул без JWT-контекста) auth.uid() = NULL → на каждый переход
-- получались ДВЕ строки: actor=NULL (триггер) + actor=пользователь
-- (прикладной слой: ops/lifecycle.ts, PATCH /api/orders/[id], accept/cancel).
--
-- Решение: пишером истории остаётся ТОЛЬКО прикладной слой — он знает
-- актёра (acting user). Триггер и его функция удаляются.
--
-- Миграция НЕ трогает данные: ранее накопленные дубли не удаляются
-- (история остаётся как есть), исправляются только будущие записи.

DROP TRIGGER IF EXISTS orders_log_status ON public.orders;
DROP FUNCTION IF EXISTS public.log_order_status_change();
