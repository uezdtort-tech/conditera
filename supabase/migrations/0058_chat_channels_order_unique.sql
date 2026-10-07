-- 0058: консолидация order-чатов на chat_channels (p1-b).
--
-- До этого order-комнаты могли создаваться в двух местах:
--   • POST /api/chat/rooms {type:'order'}  → chat_channels (find-or-create
--     по order_id, НЕ атомарно);
--   • ensureOrderChatRoom (checkout/POST /api/orders) → легаси chat_rooms.
--
-- Частичный уникальный индекс делает find-or-create идемпотентным на уровне
-- БД: параллельные ensure из checkout и «Сообщение кондитеру» дают одну
-- комнату (проигравшая вставка ловит 23505 и пере-читает существующую строку).
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_channels_order_id
  ON public.chat_channels (order_id)
  WHERE order_id IS NOT NULL;
