-- 0062_cart_sync_custom.sql — серверная корзина: синхронизация и custom-позиции конструктора.
--
-- Контекст (P1 «серверная корзина»): до этой миграции cart_items использовался
-- только abandoned-cart cron'ом — UI-корзина жила в localStorage (Zustand persist),
-- сервисные custom-позиции конструктора (без product_id) хранить было невозможно.
--
-- Что делает миграция:
--   1. product_id → NULLABLE: custom-позиция конструктора не имеет товара в БД,
--      её состав и цена живут в custom_config (валидация/пересчёт — на checkout).
--   2. custom_config jsonb — снимок CakeBuilderConfig (та же структура, что кладётся
--      в order_items.selected_attributes у custom-позиций заказа).
--   3. client_ref — стабильный ссылка позиции со стороны клиента (itemId из
--      Zustand-корзины). Мутации корзины (PATCH/DELETE) и очистка после checkout
--      идут по (user_id, client_ref) — владение строкой проверяется ВСЕГДА.
--   4. CHECK: строка — ровно одно из двух (товар | custom-конфиг).
--   5. Индексы: дедуп (user_id, client_ref), горячая выборка (user_id, updated_at).
--
-- Обратная совместимость: abandoned-cart cron уже фильтрует product_id IS NULL
-- (filter(Boolean)) и считает такие позиции с ценой 0 — кастомные позиции не
-- ломают рассылку. Прочих читателей cart_items в рантайме нет.

ALTER TABLE cart_items ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS custom_config jsonb;
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS client_ref text;

-- Один client_ref на пользователя (ссылка на позицию клиентской корзины).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cart_user_client_ref
  ON cart_items (user_id, client_ref)
  WHERE client_ref IS NOT NULL;

-- Позиция корзины: либо товар, либо custom-конфиг — ровно одно из двух.
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_kind_check;
ALTER TABLE cart_items ADD CONSTRAINT cart_items_kind_check CHECK (
  (product_id IS NOT NULL AND custom_config IS NULL)
  OR (product_id IS NULL AND custom_config IS NOT NULL)
);

-- Горячая выборка корзины пользователя (GET /api/cart).
CREATE INDEX IF NOT EXISTS idx_cart_user_updated
  ON cart_items (user_id, updated_at DESC);
