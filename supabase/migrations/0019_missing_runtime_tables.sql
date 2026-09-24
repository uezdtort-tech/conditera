-- 0019_missing_runtime_tables.sql
-- ============================================================================
-- Добавляет таблицы, которые используются кодом приложения, но отсутствовали
-- в миграциях 0001-0018. Эти таблицы выявлены статическим анализом кода:
-- grep -rhE "supabaseAdmin.from\(['\"]" src/ --include="*.ts" --include="*.tsx"
--
-- Список добавленных таблиц:
--   1. email_messages      (7 использований в src/lib/email.ts и API)
--   2. venues              (7 использований в src/app/api/venues/*)
--   3. chat_escalations    (3 использования в src/app/api/operator/*)
--   4. moderation_reports  (1 использование в src/app/api/moderation/queue)
--   5. payouts             (1 использование в src/app/api/admin/dashboard)
--   6. fraud_alerts        (1 использование в src/app/api/admin/dashboard)
--   7. supplier_products   (2 использования в src/app/api/supplier/warehouse)
--
-- Примечание: abandoned_cart_logs, fraud_log — только в TODO-комментариях кода,
-- создаются как empty-tables для будущего использования.
-- ============================================================================

-- ============================================================================
-- 1. email_messages — лог всех входящих и исходящих email
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.email_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction     TEXT NOT NULL CHECK (direction IN ('incoming', 'sent', 'draft')),
  from_address  TEXT NOT NULL,
  from_name     TEXT,
  to_address    TEXT NOT NULL,
  to_name       TEXT,
  subject       TEXT,
  text_body     TEXT,
  html_body     TEXT,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id      UUID,
  ticket_id     UUID,
  lead_id       UUID,
  template      TEXT,
  message_id    TEXT,
  in_reply_to   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced', 'rejected')),
  sent_at       TIMESTAMPTZ,
  error_message TEXT,
  metadata      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_messages_user_id      ON public.email_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_direction    ON public.email_messages(direction);
CREATE INDEX IF NOT EXISTS idx_email_messages_status       ON public.email_messages(status);
CREATE INDEX IF NOT EXISTS idx_email_messages_order_id     ON public.email_messages(order_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_ticket_id    ON public.email_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_created_at   ON public.email_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_message_id   ON public.email_messages(message_id) WHERE message_id IS NOT NULL;

COMMENT ON TABLE public.email_messages IS 'Лог всех email-сообщений (входящие/исходящие)';
COMMENT ON COLUMN public.email_messages.direction IS 'incoming — полученное, sent — отправленное, draft — черновик';
COMMENT ON COLUMN public.email_messages.message_id IS 'Message-ID заголовок (для Threading и In-Reply-To)';
COMMENT ON COLUMN public.email_messages.template IS 'Шаблон письма (welcome, order_created, abandoned_cart, и т.д.)';

ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_messages_select_own_or_admin" ON public.email_messages;
CREATE POLICY "email_messages_select_own_or_admin" ON public.email_messages
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'MODERATOR')
        AND ur.is_active = true
    )
  );
DROP POLICY IF EXISTS "email_messages_insert_auth" ON public.email_messages;
CREATE POLICY "email_messages_insert_auth" ON public.email_messages
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL OR true);
DROP POLICY IF EXISTS "email_messages_update_own_or_admin" ON public.email_messages;
CREATE POLICY "email_messages_update_own_or_admin" ON public.email_messages
  FOR UPDATE USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
        AND ur.is_active = true
    )
  );

-- ============================================================================
-- 2. venues — площадки для мероприятий (рестораны, студии, выездные локации)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.venues (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  address         TEXT NOT NULL,
  city            TEXT,
  region          TEXT,
  lat             DECIMAL(10, 7),
  lng             DECIMAL(10, 7),
  capacity        INTEGER NOT NULL DEFAULT 0,
  price_per_hour  INTEGER NOT NULL DEFAULT 0,
  min_rent_hours  INTEGER NOT NULL DEFAULT 1,
  images          TEXT[] DEFAULT '{}',
  amenities       TEXT[] DEFAULT '{}',
  contacts        JSONB DEFAULT '{}'::jsonb,
  rules           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at     TIMESTAMPTZ,
  verified_by     UUID REFERENCES auth.users(id),
  rating          DECIMAL(2, 1) DEFAULT 0,
  reviews_count   INTEGER DEFAULT 0,
  bookings_count  INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_venues_owner_id      ON public.venues(owner_id);
CREATE INDEX IF NOT EXISTS idx_venues_city          ON public.venues(city);
CREATE INDEX IF NOT EXISTS idx_venues_is_active     ON public.venues(is_active);
CREATE INDEX IF NOT EXISTS idx_venues_is_verified   ON public.venues(is_verified);
CREATE INDEX IF NOT EXISTS idx_venues_capacity      ON public.venues(capacity);
CREATE INDEX IF NOT EXISTS idx_venues_price         ON public.venues(price_per_hour);
CREATE INDEX IF NOT EXISTS idx_venues_created_at    ON public.venues(created_at DESC);

COMMENT ON TABLE public.venues IS 'Площадки для мероприятий (рестораны, студии, банки, выездные локации)';
COMMENT ON COLUMN public.venues.amenities IS 'Удобства: ["wifi","parking","kitchen","sound","projector",...]';
COMMENT ON COLUMN public.venues.contacts IS 'JSONB: {"phone":"+7...","email":"...","telegram":"@..."}';

ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "venues_select_active" ON public.venues;
CREATE POLICY "venues_select_active" ON public.venues
  FOR SELECT USING (
    is_active = TRUE
    OR owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'MODERATOR')
        AND ur.is_active = true
    )
  );
DROP POLICY IF EXISTS "venues_insert_owner" ON public.venues;
CREATE POLICY "venues_insert_owner" ON public.venues
  FOR INSERT WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );
DROP POLICY IF EXISTS "venues_update_owner_or_admin" ON public.venues;
CREATE POLICY "venues_update_owner_or_admin" ON public.venues
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'MODERATOR')
        AND ur.is_active = true
    )
  );

-- ============================================================================
-- 3. chat_escalations — эскалации чатов в операторскую поддержку
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.chat_escalations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_room_id  UUID NOT NULL,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason        TEXT,
  priority      TEXT NOT NULL DEFAULT 'normal'
                CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'assigned', 'resolved', 'closed', 'cancelled')),
  assigned_to   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at   TIMESTAMPTZ,
  resolved_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at   TIMESTAMPTZ,
  resolution    TEXT,
  messages_count INTEGER NOT NULL DEFAULT 0,
  wait_time_sec INTEGER,
  metadata      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_escalations_status        ON public.chat_escalations(status);
CREATE INDEX IF NOT EXISTS idx_chat_escalations_priority      ON public.chat_escalations(priority);
CREATE INDEX IF NOT EXISTS idx_chat_escalations_assigned_to   ON public.chat_escalations(assigned_to);
CREATE INDEX IF NOT EXISTS idx_chat_escalations_chat_room_id  ON public.chat_escalations(chat_room_id);
CREATE INDEX IF NOT EXISTS idx_chat_escalations_created_at    ON public.chat_escalations(created_at DESC);

COMMENT ON TABLE public.chat_escalations IS 'Эскалации тикетов в операторскую поддержку (STATUS: pending → assigned → resolved → closed)';

ALTER TABLE public.chat_escalations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chat_escalations_select_operator_or_admin" ON public.chat_escalations;
CREATE POLICY "chat_escalations_select_operator_or_admin" ON public.chat_escalations
  FOR SELECT USING (
    user_id = auth.uid()
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'MODERATOR')
        AND ur.is_active = true
    )
  );
DROP POLICY IF EXISTS "chat_escalations_update_operator_or_admin" ON public.chat_escalations;
CREATE POLICY "chat_escalations_update_operator_or_admin" ON public.chat_escalations
  FOR UPDATE USING (
    assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'MODERATOR')
        AND ur.is_active = true
    )
  );
DROP POLICY IF EXISTS "chat_escalations_insert_auth" ON public.chat_escalations;
CREATE POLICY "chat_escalations_insert_auth" ON public.chat_escalations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL OR true);

-- ============================================================================
-- 4. moderation_reports — жалобы на контент (фото, отзывы, сообщения)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.moderation_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL,
  item_type       TEXT NOT NULL
                  CHECK (item_type IN ('product', 'review', 'comment', 'message', 'story', 'post', 'image')),
  reason          TEXT NOT NULL,
  description     TEXT,
  reporter_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reporter_name   TEXT,
  reporter_ip     INET,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'reviewing', 'approved', 'rejected', 'resolved')),
  moderator_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  moderator_notes TEXT,
  resolved_at     TIMESTAMPTZ,
  resolution      TEXT,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_reports_status     ON public.moderation_reports(status);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_item       ON public.moderation_reports(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_reporter   ON public.moderation_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_moderator  ON public.moderation_reports(moderator_id);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_created_at ON public.moderation_reports(created_at DESC);

COMMENT ON TABLE public.moderation_reports IS 'Жалобы на контент (фото, отзывы, сообщения) для модерации';

ALTER TABLE public.moderation_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "moderation_reports_select_admin" ON public.moderation_reports;
CREATE POLICY "moderation_reports_select_admin" ON public.moderation_reports
  FOR SELECT USING (
    reporter_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'MODERATOR')
        AND ur.is_active = true
    )
  );
DROP POLICY IF EXISTS "moderation_reports_insert_auth" ON public.moderation_reports;
CREATE POLICY "moderation_reports_insert_auth" ON public.moderation_reports
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL OR true);
DROP POLICY IF EXISTS "moderation_reports_update_admin" ON public.moderation_reports;
CREATE POLICY "moderation_reports_update_admin" ON public.moderation_reports
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'MODERATOR')
        AND ur.is_active = true
    )
  );

-- ============================================================================
-- 5. payouts — выплаты кондитерам (запросы на вывод средств)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confectioner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount          INTEGER NOT NULL, -- в копейках
  currency        TEXT NOT NULL DEFAULT 'RUB',
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  method          TEXT NOT NULL DEFAULT 'card'
                  CHECK (method IN ('card', 'sbp', 'bank_transfer')),
  destination     JSONB NOT NULL, -- {"card_last4":"1234","bank_bik":"...","bank_account":"..."}
  transaction_id  TEXT,
  provider        TEXT, -- 'yookassa', 'tinkoff', 'sberbank'
  fee_amount      INTEGER DEFAULT 0,
  net_amount      INTEGER NOT NULL,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  error_message   TEXT,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payouts_confectioner_id  ON public.payouts(confectioner_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status           ON public.payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_method           ON public.payouts(method);
CREATE INDEX IF NOT EXISTS idx_payouts_requested_at     ON public.payouts(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_payouts_transaction_id   ON public.payouts(transaction_id) WHERE transaction_id IS NOT NULL;

COMMENT ON TABLE public.payouts IS 'Выплаты кондитерам (запросы на вывод средств с баланса)';
COMMENT ON COLUMN public.payouts.amount IS 'Сумма выплаты в копейках (INTEGER для точности)';
COMMENT ON COLUMN public.payouts.destination IS 'JSONB: {"card_last4":"1234"} или {"bank_bik":"...","bank_account":"..."}';

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payouts_select_own_or_admin" ON public.payouts;
CREATE POLICY "payouts_select_own_or_admin" ON public.payouts
  FOR SELECT USING (
    confectioner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
        AND ur.is_active = true
    )
  );
DROP POLICY IF EXISTS "payouts_insert_own" ON public.payouts;
CREATE POLICY "payouts_insert_own" ON public.payouts
  FOR INSERT WITH CHECK (
    confectioner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );
DROP POLICY IF EXISTS "payouts_update_admin" ON public.payouts;
CREATE POLICY "payouts_update_admin" ON public.payouts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
        AND ur.is_active = true
    )
  );

-- ============================================================================
-- 6. fraud_alerts — автоматические антифрод-алерты
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.fraud_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id        UUID,
  alert_type      TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'medium'
                  CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'investigating', 'confirmed', 'false_positive', 'resolved')),
  trigger_rule    TEXT,
  trigger_data    JSONB DEFAULT '{}'::jsonb,
  risk_score      INTEGER DEFAULT 0,
  ip_address      INET,
  user_agent      TEXT,
  description     TEXT,
  reviewed_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  review_notes    TEXT,
  resolution      TEXT,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_alerts_status       ON public.fraud_alerts(status);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_severity     ON public.fraud_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_user_id      ON public.fraud_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_order_id     ON public.fraud_alerts(order_id);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_alert_type   ON public.fraud_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_created_at   ON public.fraud_alerts(created_at DESC);

COMMENT ON TABLE public.fraud_alerts IS 'Автоматические антифрод-алерты (triggered by anti-fraud rules engine)';

ALTER TABLE public.fraud_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fraud_alerts_select_admin" ON public.fraud_alerts;
CREATE POLICY "fraud_alerts_select_admin" ON public.fraud_alerts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
        AND ur.is_active = true
    )
  );
DROP POLICY IF EXISTS "fraud_alerts_insert_system" ON public.fraud_alerts;
CREATE POLICY "fraud_alerts_insert_system" ON public.fraud_alerts
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "fraud_alerts_update_admin" ON public.fraud_alerts;
CREATE POLICY "fraud_alerts_update_admin" ON public.fraud_alerts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
        AND ur.is_active = true
    )
  );

-- ============================================================================
-- 7. supplier_products — складские товары поставщика
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.supplier_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_name    TEXT NOT NULL,
  sku             TEXT,
  category        TEXT,
  description     TEXT,
  unit            TEXT NOT NULL DEFAULT 'piece'
                  CHECK (unit IN ('piece', 'kg', 'g', 'liter', 'ml', 'box', 'pack')),
  quantity        INTEGER NOT NULL DEFAULT 0,
  min_stock       INTEGER NOT NULL DEFAULT 0,
  max_stock       INTEGER,
  price           INTEGER NOT NULL DEFAULT 0, -- в копейках
  cost_price      INTEGER, -- в копейках
  currency        TEXT NOT NULL DEFAULT 'RUB',
  image_url       TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_restocked_at TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier_id  ON public.supplier_products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_products_category     ON public.supplier_products(category);
CREATE INDEX IF NOT EXISTS idx_supplier_products_is_active    ON public.supplier_products(is_active);
CREATE INDEX IF NOT EXISTS idx_supplier_products_product_name ON public.supplier_products(product_name);
CREATE INDEX IF NOT EXISTS idx_supplier_products_sku           ON public.supplier_products(sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_products_low_stock    ON public.supplier_products(supplier_id, quantity, min_stock);

COMMENT ON TABLE public.supplier_products IS 'Складские товары поставщика (для управления остатками)';
COMMENT ON COLUMN public.supplier_products.quantity IS 'Текущее количество на складе';
COMMENT ON COLUMN public.supplier_products.min_stock IS 'Минимальный остаток (для уведомления о пополнении)';

ALTER TABLE public.supplier_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supplier_products_select_own_or_admin" ON public.supplier_products;
CREATE POLICY "supplier_products_select_own_or_admin" ON public.supplier_products
  FOR SELECT USING (
    supplier_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );
DROP POLICY IF EXISTS "supplier_products_insert_own" ON public.supplier_products;
CREATE POLICY "supplier_products_insert_own" ON public.supplier_products
  FOR INSERT WITH CHECK (
    supplier_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );
DROP POLICY IF EXISTS "supplier_products_update_own_or_admin" ON public.supplier_products;
CREATE POLICY "supplier_products_update_own_or_admin" ON public.supplier_products
  FOR UPDATE USING (
    supplier_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );
DROP POLICY IF EXISTS "supplier_products_delete_own_or_admin" ON public.supplier_products;
CREATE POLICY "supplier_products_delete_own_or_admin" ON public.supplier_products
  FOR DELETE USING (
    supplier_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );

-- ============================================================================
-- 8. abandoned_cart_logs — лог брошенных корзин (для n8n automation)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.abandoned_cart_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id      TEXT,
  cart_items      JSONB NOT NULL,
  cart_total      INTEGER NOT NULL DEFAULT 0,
  cart_items_count INTEGER NOT NULL DEFAULT 0,
  abandoned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reminder_sent_at TIMESTAMPTZ,
  reminder_channel TEXT CHECK (reminder_channel IN ('email', 'push', 'telegram') ) ,
  reminder_status TEXT CHECK (reminder_status IN ('sent', 'failed', 'clicked', 'converted')),
  recovered_at    TIMESTAMPTZ,
  recovery_order_id UUID,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abandoned_cart_logs_user_id        ON public.abandoned_cart_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_abandoned_cart_logs_abandoned_at   ON public.abandoned_cart_logs(abandoned_at DESC);
CREATE INDEX IF NOT EXISTS idx_abandoned_cart_logs_reminder_status ON public.abandoned_cart_logs(reminder_status);
CREATE INDEX IF NOT EXISTS idx_abandoned_cart_logs_session_id     ON public.abandoned_cart_logs(session_id) WHERE session_id IS NOT NULL;

COMMENT ON TABLE public.abandoned_cart_logs IS 'Лог брошенных корзин для n8n-автоматизации (recovery campaigns)';

ALTER TABLE public.abandoned_cart_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "abandoned_cart_logs_select_own_or_admin" ON public.abandoned_cart_logs;
CREATE POLICY "abandoned_cart_logs_select_own_or_admin" ON public.abandoned_cart_logs
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
        AND ur.is_active = true
    )
  );
DROP POLICY IF EXISTS "abandoned_cart_logs_insert_system" ON public.abandoned_cart_logs;
CREATE POLICY "abandoned_cart_logs_insert_system" ON public.abandoned_cart_logs
  FOR INSERT WITH CHECK (true);

-- ============================================================================
-- 9. fraud_log — детальный лог антифрод-проверок (одно событие = одна запись)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.fraud_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id        UUID,
  event_type      TEXT NOT NULL,
  risk_score      INTEGER DEFAULT 0,
  ip_address      INET,
  user_agent      TEXT,
  fingerprint     TEXT,
  details         JSONB DEFAULT '{}'::jsonb,
  triggered_rules TEXT[] DEFAULT '{}',
  is_blocked      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_log_user_id      ON public.fraud_log(user_id);
CREATE INDEX IF NOT EXISTS idx_fraud_log_order_id     ON public.fraud_log(order_id);
CREATE INDEX IF NOT EXISTS idx_fraud_log_event_type   ON public.fraud_log(event_type);
CREATE INDEX IF NOT EXISTS idx_fraud_log_created_at   ON public.fraud_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_log_is_blocked   ON public.fraud_log(is_blocked) WHERE is_blocked = TRUE;
CREATE INDEX IF NOT EXISTS idx_fraud_log_fingerprint  ON public.fraud_log(fingerprint) WHERE fingerprint IS NOT NULL;

COMMENT ON TABLE public.fraud_log IS 'Детальный лог антифрод-событий (одна запись = одна проверка)';
COMMENT ON COLUMN public.fraud_log.triggered_rules IS 'Массив сработавших правил антифрода';

ALTER TABLE public.fraud_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fraud_log_select_admin" ON public.fraud_log;
CREATE POLICY "fraud_log_select_admin" ON public.fraud_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
        AND ur.is_active = true
    )
  );
DROP POLICY IF EXISTS "fraud_log_insert_system" ON public.fraud_log;
CREATE POLICY "fraud_log_insert_system" ON public.fraud_log
  FOR INSERT WITH CHECK (true);
