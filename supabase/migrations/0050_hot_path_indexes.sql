-- 0050_hot_path_indexes.sql
--
-- Оптимизация Supabase/PostgreSQL: индексы подтверждённо-горячих FK-путей
-- (проверено по фактическим запросам кода, не «на всякий случай») +
-- ANALYZE горячих таблиц для свежей статистики планировщика.
--
-- 1) loyalty_transactions(order_id, type):
--    POST /api/payment/webhook на КАЖДЫЙ payment.succeeded ищет
--    EARN-транзакцию заказа (дедуп бонусов), /api/loyalty/history — по
--    order_id. Без индекса — seq scan растёт с ростом истории.
-- 2) lesson_enrollments(lesson_id, user_id):
--    POST /api/lessons/[id]/enroll проверяет дубликат записи —
--    .eq("lesson_id").eq("user_id").
-- 3) chat_messages(reply_to_id) — частичный: ветки ответов в чате
--    (reply-выборки), NULL-строки не индексируем.

CREATE INDEX IF NOT EXISTS idx_loyalty_tx_order_type
  ON public.loyalty_transactions(order_id, type);

CREATE INDEX IF NOT EXISTS idx_lesson_enrollments_lesson_user
  ON public.lesson_enrollments(lesson_id, user_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to
  ON public.chat_messages(reply_to_id)
  WHERE reply_to_id IS NOT NULL;

-- Свежая статистика планировщика по горячим таблицам
ANALYZE public.orders;
ANALYZE public.payments;
ANALYZE public.refunds;
ANALYZE public.loyalty_transactions;
ANALYZE public.inventory_items;
ANALYZE public.inventory_movements;
ANALYZE public.products;
ANALYZE public.product_reviews;
ANALYZE public.chat_channels;
ANALYZE public.chat_messages;
ANALYZE public.chat_channel_members;
ANALYZE public.profiles;
ANALYZE public.inventory_write_offs;
