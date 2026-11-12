-- 0084_order_items_price_version.sql — PR-1B: привязка позиции заказа к версии цены.
--
-- order_items получает необязательную ссылку на строку product_price_history (0083),
-- зафиксированную в момент создания заказа (снимок цены). NULL — заказ создан до
-- ввода версионирования цен (или цена синтезирована из products.price без версии).
-- Никаких данных не трогаем; checkout/orders-маршруты начнут заполнять колонку
-- в отдельном пакете (PR-1C+).
--
-- Forward-only, идемпотентно: IF NOT EXISTS / IF EXISTS.

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS price_version_id uuid NULL
  REFERENCES public.product_price_history(id);

COMMENT ON COLUMN order_items.price_version_id IS
  'Версия из product_price_history, зафиксированная при создании заказа (снимок цены)';
