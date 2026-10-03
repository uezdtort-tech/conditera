-- ============================================================================
-- 0040_local_runtime.sql
--
-- Этап 4: устранение schema drift между кодом API и миграциями.
-- Всё ADDITIVE — никаких DROP/ destructuring операций.
-- Идемпотентно: IF NOT EXISTS везде (раннер глотает already-exists, но не
-- полагаемся на это).
--
-- Источники дрейфа:
--   - orders/order_items: код написан под prisma-подобную snake_case-схему
--     (POST /api/orders, payment/webhook читает orders.customer_id)
--   - chat_messages/chat_rooms/profiles: чат-автоматизация пишет room_id /
--     is_bot / bot_kind / last_message (snake_case) — 0004/0017 имели
--     channel_id / camelCase "lastMessage"
--   - service_bookings / decor_products: таблицы, которых не было ни в одной
--     миграции (витрина декора и брони услуг)
-- ============================================================================

-- ===== 1. orders =====
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_time text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS comment text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bonus_points_redeemed integer DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS legal_status_snapshot text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS promo_code text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS promo_discount numeric DEFAULT 0;
-- webhook читает customer_id; без FK намеренно (колонка пишет код, а не схема)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_draft boolean DEFAULT false;
-- drift, найденный в POST /api/orders: роут пишет эти три, но их не было
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bonus_discount_rub numeric DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS promo_code_applied text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS promo_code_id uuid;
-- POST /api/orders не пишет subtotal (NOT NULL в 0002) — дефолт снимает блокер,
-- NOT NULL сохранён (явный NULL по-прежнему отклоняется)
ALTER TABLE public.orders ALTER COLUMN subtotal SET DEFAULT 0;

-- ===== 2. order_items =====
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS price numeric DEFAULT 0;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS quantity integer DEFAULT 1;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS customization jsonb;
-- 0002 требует product_title/unit_price/total NOT NULL, роут их не пишет —
-- дефолты сохраняют NOT NULL, но снимают блокер вставки
ALTER TABLE public.order_items ALTER COLUMN product_title SET DEFAULT '';
ALTER TABLE public.order_items ALTER COLUMN unit_price SET DEFAULT 0;
ALTER TABLE public.order_items ALTER COLUMN total SET DEFAULT 0;

-- ===== 3. chat_messages =====
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS room_id text;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS is_bot boolean DEFAULT false;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS bot_kind text;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS quick_replies jsonb;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS idempotency_key text;
-- Идемпотентность серверной отправки (клиент шлёт m_${Date.now()} — дедуп на БД)
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_messages_idem
  ON public.chat_messages(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
-- channel_id (0004) и room_id (код) сосуществуют в переходный период

-- ===== 4. chat_channels =====
-- support_ticket_id уже есть с 0004 — не трогаем
ALTER TABLE public.chat_channels ADD COLUMN IF NOT EXISTS order_id uuid;

-- ===== 5. chat_rooms =====
-- 0017 создавал camelCase "lastMessage"/"lastMessageAt"/"orderId" — код пишет
-- snake_case. Аддитивное сосуществование обеих нотаций.
ALTER TABLE public.chat_rooms ADD COLUMN IF NOT EXISTS last_message text;
ALTER TABLE public.chat_rooms ADD COLUMN IF NOT EXISTS last_message_at timestamptz;
ALTER TABLE public.chat_rooms ADD COLUMN IF NOT EXISTS order_id uuid;

-- ===== 6. profiles =====
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_bot boolean DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bot_role text;

-- ===== 7. service_bookings =====
-- Брони услуг (витрина «Услуги и площадки» → service_products из 0029).
-- FK только на service_products (PK = id, проверено) — остальные plain uuid.
CREATE TABLE IF NOT EXISTS public.service_bookings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_product_id uuid REFERENCES public.service_products(id) ON DELETE SET NULL,
  user_id            uuid,
  provider_id        uuid,
  booking_date       date NOT NULL,
  start_time         text,
  end_time           text,
  address            text,
  comment            text,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','confirmed','rejected','cancelled','completed')),
  price              numeric DEFAULT 0,
  order_id           uuid,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_bookings_provider ON public.service_bookings(provider_id);
CREATE INDEX IF NOT EXISTS idx_service_bookings_user     ON public.service_bookings(user_id);

-- ===== 8. decor_products =====
-- Витрина декора (decor-shop-page) — живого БД-источника не было.
CREATE TABLE IF NOT EXISTS public.decor_products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid,
  title       text NOT NULL,
  description text,
  price       numeric NOT NULL DEFAULT 0,
  images      jsonb DEFAULT '[]'::jsonb,
  category    text,
  in_stock    boolean DEFAULT true,
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ===== 9. products =====
-- POST /api/orders читает products.images (string[] снапшот картинки) —
-- колонки не было ни в одной миграции
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS images text[] DEFAULT '{}';

-- ===== 10. order_fraud_logs =====
-- 0017 создавал camelCase ("ipHash"/"deviceFp"/"userId"); anti-fraud.ts пишет
-- snake_case — аддитивное сосуществование нотаций
ALTER TABLE public.order_fraud_logs ADD COLUMN IF NOT EXISTS ip_hash text;
ALTER TABLE public.order_fraud_logs ADD COLUMN IF NOT EXISTS device_fp text;
ALTER TABLE public.order_fraud_logs ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE public.order_fraud_logs ADD COLUMN IF NOT EXISTS order_id text;
ALTER TABLE public.order_fraud_logs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
-- id TEXT NOT NULL без дефолта (0017) — shim-инсерты без id падали; дефолт снимает блокер
ALTER TABLE public.order_fraud_logs ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
-- camelCase NOT NULL "ipHash" без дефолта блокирует snake_case-инсерты переходного периода
ALTER TABLE public.order_fraud_logs ALTER COLUMN "ipHash" SET DEFAULT '';

-- ===== 11. Grants =====
GRANT ALL ON public.service_bookings TO service_role;
GRANT ALL ON public.decor_products TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_bookings TO authenticated;
GRANT SELECT ON public.decor_products TO authenticated;
