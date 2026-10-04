-- ============================================================================
-- 0047_chat_support_indexes.sql — оптимизация запросов очереди поддержки.
--
-- Реальные горячие запросы (GET /api/chat/rooms для staff):
--   1) SELECT * FROM chat_channels
--      WHERE type='support' AND deleted_at IS NULL
--      ORDER BY last_message_at DESC NULLS LAST LIMIT 50
--      → составной индекс убирает отдельный Sort узел.
--   2) Мост тикет↔чат (POST /api/chat/rooms: find support_ticket_id,
--      закрывает тикет при закрытии комнаты) — lookup по support_ticket_id.
--
-- Идемпотентно (IF NOT EXISTS). Частичные индексы — только живые строки.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_channels_type_last_message
  ON public.chat_channels (type, last_message_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_channels_support_ticket
  ON public.chat_channels (support_ticket_id)
  WHERE support_ticket_id IS NOT NULL;
