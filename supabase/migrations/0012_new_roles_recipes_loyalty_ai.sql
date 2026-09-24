-- ════════════════════════════════════════════════════════════════════
-- 0012_new_roles_recipes_loyalty_ai.sql
--
-- Добавляет 3 новые роли из PDF-спецификации «Уездный кондитер v2.0 —
-- Архитектура ролевой экосистемы» (Часть I, раздел «Новые роли»):
--   • RECIPE_DEVELOPER  — авторские рецепты с роялти
--   • LOYALTY_PARTNER   — внешний партнёр (банки, страховые, кофейни)
--   • AI_ASSISTANT      — виртуальный помощник для всех ролей
--
-- Также создает таблицы:
--   • recipe_marketplace        — каталог авторских рецептов
--   • recipe_purchases          — покупки рецептов кондитерами (роялти)
--   • recipe_subscriptions      — премиум-подписки на рецепты
--   • loyalty_partners          — реестр внешних партнёров
--   • loyalty_cross_actions     — кросс-акции с партнёрами
--   • loyalty_point_exchanges   — обмен бонусами между системами
--   • ai_assistant_logs         — логи запросов к AI-помощнику
--   • ai_assistant_conversations — сохранённые диалоги
--
-- Все таблицы включают RLS-политики. Триггеры для updated_at.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Добавить новые значения в enum user_role
-- ─────────────────────────────────────────────────────────────────────
-- ALTER TYPE ... ADD VALUE не может выполняться внутри транзакции в PostgreSQL <12,
-- но в PG 12+ работает. Supabase использует PG 15.
DO $$ BEGIN
  -- Проверяем, не добавлены ли уже значения
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'RECIPE_DEVELOPER'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
  ) THEN
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'RECIPE_DEVELOPER';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'LOYALTY_PARTNER'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
  ) THEN
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'LOYALTY_PARTNER';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'AI_ASSISTANT'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
  ) THEN
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'AI_ASSISTANT';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. recipe_marketplace — каталог авторских рецептов
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recipe_marketplace (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           VARCHAR(200) NOT NULL,
  slug            VARCHAR(220) UNIQUE NOT NULL,
  description     TEXT NOT NULL,
  base_price      NUMERIC(10,2) NOT NULL DEFAULT 0,  -- цена разовой покупки
  is_premium      BOOLEAN NOT NULL DEFAULT FALSE,    -- премиум-подписка?
  premium_price   NUMERIC(8,2),                       -- мес. цена подписки
  royalty_rate    NUMERIC(3,2) NOT NULL DEFAULT 0.05, -- 5% роялти с продаж по умолчанию
  cooking_time_min INT,
  difficulty      SMALLINT CHECK (difficulty BETWEEN 1 AND 5),
  tags            TEXT[] DEFAULT '{}',
  preview_image   TEXT,
  steps_json      JSONB NOT NULL,                     -- массив шагов [{step_number, description, image, video_url}]
  ingredients_json JSONB NOT NULL,                    -- массив ингредиентов [{name, qty, unit}]
  views           INT NOT NULL DEFAULT 0,
  purchases_count INT NOT NULL DEFAULT 0,
  rating          NUMERIC(2,1) NOT NULL DEFAULT 0,
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  published_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recipe_marketplace_author ON public.recipe_marketplace(author_id);
CREATE INDEX IF NOT EXISTS idx_recipe_marketplace_slug  ON public.recipe_marketplace(slug);
CREATE INDEX IF NOT EXISTS idx_recipe_marketplace_tags  ON public.recipe_marketplace USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_recipe_marketplace_published ON public.recipe_marketplace(is_published, published_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 3. recipe_purchases — покупки рецептов (для расчёта роялти)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recipe_purchases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id       UUID NOT NULL REFERENCES public.recipe_marketplace(id) ON DELETE CASCADE,
  buyer_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  price_paid      NUMERIC(10,2) NOT NULL,
  royalty_amount  NUMERIC(10,2) NOT NULL,   -- сколько получил автор
  commission_amount NUMERIC(10,2) NOT NULL, -- сколько получила платформа
  payment_id      UUID,                     -- ссылка на payments.id
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE если подписка отменена
  expires_at      TIMESTAMPTZ,              -- для премиум-подписок
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_recipe_purchase_payment CHECK (price_paid >= 0 AND royalty_amount >= 0 AND commission_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_recipe_purchases_recipe ON public.recipe_purchases(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_purchases_buyer ON public.recipe_purchases(buyer_id);
CREATE INDEX IF NOT EXISTS idx_recipe_purchases_active ON public.recipe_purchases(is_active, expires_at);

-- ─────────────────────────────────────────────────────────────────────
-- 4. recipe_subscriptions — премиум-подписки на все рецепты автора
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recipe_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  price_per_month NUMERIC(8,2) NOT NULL,
  status          VARCHAR(20) NOT NULL CHECK (status IN ('active','paused','cancelled','expired')),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end   TIMESTAMPTZ NOT NULL,
  next_renewal_at TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscriber_id, author_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_subs_subscriber ON public.recipe_subscriptions(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_recipe_subs_author ON public.recipe_subscriptions(author_id);
CREATE INDEX IF NOT EXISTS idx_recipe_subs_status ON public.recipe_subscriptions(status, current_period_end);

-- ─────────────────────────────────────────────────────────────────────
-- 5. loyalty_partners — реестр внешних партнёров (банки, страховые, кофейни)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loyalty_partners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,  -- владелец-партнёр
  company_name    VARCHAR(200) NOT NULL,
  company_type    VARCHAR(50) NOT NULL CHECK (company_type IN ('bank','insurance','coffee_chain','restaurant_chain','retail','other')),
  inn             VARCHAR(12),
  legal_address   TEXT,
  contact_email   VARCHAR(255) NOT NULL,
  contact_phone   VARCHAR(20),
  api_key_hash    VARCHAR(255),  -- hash API-ключа для интеграций (не сам ключ!)
  api_key_scopes  JSONB DEFAULT '[]'::jsonb,  -- массив разрешённых скоупов
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  partnership_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  partnership_ended_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_partners_user ON public.loyalty_partners(user_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_partners_type ON public.loyalty_partners(company_type);
CREATE INDEX IF NOT EXISTS idx_loyalty_partners_active ON public.loyalty_partners(is_active, is_verified);

-- ─────────────────────────────────────────────────────────────────────
-- 6. loyalty_cross_actions — кросс-акции с партнёрами
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loyalty_cross_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      UUID NOT NULL REFERENCES public.loyalty_partners(id) ON DELETE CASCADE,
  title           VARCHAR(200) NOT NULL,
  description     TEXT NOT NULL,
  discount_type   VARCHAR(20) NOT NULL CHECK (discount_type IN ('percent','fixed','bonus_points','freebie')),
  discount_value  NUMERIC(10,2) NOT NULL,
  start_at        TIMESTAMPTZ NOT NULL,
  end_at          TIMESTAMPTZ NOT NULL,
  usage_limit     INT,  -- сколько всего можно использовать
  usage_count     INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_cross_action_dates CHECK (end_at > start_at),
  CONSTRAINT chk_cross_action_usage CHECK (usage_limit IS NULL OR usage_count <= usage_limit)
);

CREATE INDEX IF NOT EXISTS idx_cross_actions_partner ON public.loyalty_cross_actions(partner_id);
CREATE INDEX IF NOT EXISTS idx_cross_actions_active ON public.loyalty_cross_actions(is_active, start_at, end_at);

-- ─────────────────────────────────────────────────────────────────────
-- 7. loyalty_point_exchanges — обмен бонусами между платформой и партнёром
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loyalty_point_exchanges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_id      UUID NOT NULL REFERENCES public.loyalty_partners(id) ON DELETE RESTRICT,
  direction       VARCHAR(10) NOT NULL CHECK (direction IN ('to_partner','from_partner')),
  points_amount   INT NOT NULL CHECK (points_amount > 0),
  external_txn_id VARCHAR(255),  -- ID транзакции во внешней системе
  status          VARCHAR(20) NOT NULL CHECK (status IN ('pending','completed','failed','reversed')),
  external_payload JSONB,  -- полный ответ от партнёра для аудита
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_loyalty_exchanges_user ON public.loyalty_point_exchanges(user_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_exchanges_partner ON public.loyalty_point_exchanges(partner_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_exchanges_status ON public.loyalty_point_exchanges(status, created_at);

-- ─────────────────────────────────────────────────────────────────────
-- 8. ai_assistant_conversations — сохранённые диалоги с AI
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_assistant_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_context    user_role NOT NULL,  -- в контексте какой роли идёт диалог
  title           VARCHAR(255),  -- авто-сгенерируется из первого сообщения
  message_count   INT NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
  metadata        JSONB DEFAULT '{}'::jsonb,  -- доп. контекст (orderId, productId, и т.д.)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON public.ai_assistant_conversations(user_id, is_archived, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_role ON public.ai_assistant_conversations(role_context);

-- ─────────────────────────────────────────────────────────────────────
-- 9. ai_assistant_logs — логи запросов к AI-помощнику (для аудита и улучшения)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_assistant_logs (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id UUID REFERENCES public.ai_assistant_conversations(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  role_context    user_role,
  request_type    VARCHAR(50) NOT NULL CHECK (request_type IN ('chat','forecast','recommendation','auto_reply','voice','other')),
  input_text     TEXT NOT NULL,
  output_text    TEXT,
  input_tokens   INT,  -- для учёта стоимости
  output_tokens  INT,
  model_used     VARCHAR(100),  -- какая LLM использовалась
  latency_ms     INT,           -- время ответа
  was_helpful    BOOLEAN,       -- пользовательская оценка (thumbs up/down)
  feedback_text  TEXT,
  error_code     VARCHAR(50),
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_conversation ON public.ai_assistant_logs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_user ON public.ai_assistant_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_type ON public.ai_assistant_logs(request_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_error ON public.ai_assistant_logs(error_code) WHERE error_code IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════
-- 10. Триггеры для updated_at (используют существующую функцию)
-- ════════════════════════════════════════════════════════════════════
-- Предполагается, что функция update_updated_at_column() уже создана в 0001_init.sql
DO $$ BEGIN
  -- Проверяем существование функции
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    CREATE TRIGGER IF NOT EXISTS trg_recipe_marketplace_updated
      BEFORE UPDATE ON public.recipe_marketplace
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

    CREATE TRIGGER IF NOT EXISTS trg_recipe_subscriptions_updated
      BEFORE UPDATE ON public.recipe_subscriptions
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

    CREATE TRIGGER IF NOT EXISTS trg_loyalty_partners_updated
      BEFORE UPDATE ON public.loyalty_partners
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

    CREATE TRIGGER IF NOT EXISTS trg_loyalty_cross_actions_updated
      BEFORE UPDATE ON public.loyalty_cross_actions
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

    CREATE TRIGGER IF NOT EXISTS trg_ai_conversations_updated
      BEFORE UPDATE ON public.ai_assistant_conversations
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 11. RLS-политики
-- ════════════════════════════════════════════════════════════════════

-- Включаем RLS на всех новых таблицах
ALTER TABLE public.recipe_marketplace        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_purchases          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_subscriptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_partners          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_cross_actions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_point_exchanges   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_assistant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_assistant_logs        ENABLE ROW LEVEL SECURITY;

-- ─ recipe_marketplace ─
-- Опубликованные рецепты видят все аутентифицированные пользователи
CREATE POLICY "recipe_marketplace_read_published"
  ON public.recipe_marketplace FOR SELECT
  TO authenticated
  USING (is_published = TRUE);

-- Автор видит все свои рецепты (опубликованные и черновики)
CREATE POLICY "recipe_marketplace_author_read"
  ON public.recipe_marketplace FOR SELECT
  TO authenticated
  USING (author_id = auth.uid());

-- Только RECIPE_DEVELOPER может создавать рецепты
CREATE POLICY "recipe_marketplace_author_insert"
  ON public.recipe_marketplace FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'RECIPE_DEVELOPER'
        AND ur.is_active
    )
  );

-- Автор может обновлять и удалять свои рецепты
CREATE POLICY "recipe_marketplace_author_update"
  ON public.recipe_marketplace FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "recipe_marketplace_author_delete"
  ON public.recipe_marketplace FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());

-- ─ recipe_purchases ─
-- Покупатель видит свои покупки, автор — покупки своих рецептов
CREATE POLICY "recipe_purchases_buyer_or_author_read"
  ON public.recipe_purchases FOR SELECT
  TO authenticated
  USING (buyer_id = auth.uid() OR recipe_id IN (
    SELECT id FROM public.recipe_marketplace WHERE author_id = auth.uid()
  ));

-- Только аутентифицированный пользователь может купить рецепт
CREATE POLICY "recipe_purchases_buyer_insert"
  ON public.recipe_purchases FOR INSERT
  TO authenticated
  WITH CHECK (buyer_id = auth.uid());

-- Обновлять может только система (через service role) или покупатель (для отмены)
CREATE POLICY "recipe_purchases_buyer_update"
  ON public.recipe_purchases FOR UPDATE
  TO authenticated
  USING (buyer_id = auth.uid())
  WITH CHECK (buyer_id = auth.uid());

-- ─ recipe_subscriptions ─
CREATE POLICY "recipe_subs_subscriber_read"
  ON public.recipe_subscriptions FOR SELECT
  TO authenticated
  USING (subscriber_id = auth.uid() OR author_id = auth.uid());

CREATE POLICY "recipe_subs_subscriber_insert"
  ON public.recipe_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (subscriber_id = auth.uid());

CREATE POLICY "recipe_subs_subscriber_update"
  ON public.recipe_subscriptions FOR UPDATE
  TO authenticated
  USING (subscriber_id = auth.uid())
  WITH CHECK (subscriber_id = auth.uid());

-- ─ loyalty_partners ─
-- Публичный каталог активных проверенных партнёров
CREATE POLICY "loyalty_partners_public_read"
  ON public.loyalty_partners FOR SELECT
  TO authenticated
  USING (is_active = TRUE AND is_verified = TRUE);

-- Партнёр видит свою запись
CREATE POLICY "loyalty_partners_self_read"
  ON public.loyalty_partners FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Только LOYALTY_PARTNER может создать запись (is_verified устанавливает ADMIN)
CREATE POLICY "loyalty_partners_self_insert"
  ON public.loyalty_partners FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'LOYALTY_PARTNER'
        AND ur.is_active
    )
  );

CREATE POLICY "loyalty_partners_self_update"
  ON public.loyalty_partners FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─ loyalty_cross_actions ─
-- Активные акции видны всем аутентифицированным
CREATE POLICY "loyalty_cross_actions_public_read"
  ON public.loyalty_cross_actions FOR SELECT
  TO authenticated
  USING (is_active = TRUE AND end_at > now());

-- Партнёр видит все свои акции
CREATE POLICY "loyalty_cross_actions_partner_read"
  ON public.loyalty_cross_actions FOR SELECT
  TO authenticated
  USING (partner_id IN (SELECT id FROM public.loyalty_partners WHERE user_id = auth.uid()));

CREATE POLICY "loyalty_cross_actions_partner_insert"
  ON public.loyalty_cross_actions FOR INSERT
  TO authenticated
  WITH CHECK (partner_id IN (
    SELECT id FROM public.loyalty_partners WHERE user_id = auth.uid() AND is_active
  ));

CREATE POLICY "loyalty_cross_actions_partner_update"
  ON public.loyalty_cross_actions FOR UPDATE
  TO authenticated
  USING (partner_id IN (SELECT id FROM public.loyalty_partners WHERE user_id = auth.uid()));

-- ─ loyalty_point_exchanges ─
-- Пользователь видит свои обмены
CREATE POLICY "loyalty_exchanges_user_read"
  ON public.loyalty_point_exchanges FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "loyalty_exchanges_user_insert"
  ON public.loyalty_point_exchanges FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ─ ai_assistant_conversations ─
-- Пользователь видит только свои диалоги
CREATE POLICY "ai_conversations_user_read"
  ON public.ai_assistant_conversations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "ai_conversations_user_insert"
  ON public.ai_assistant_conversations FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "ai_conversations_user_update"
  ON public.ai_assistant_conversations FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "ai_conversations_user_delete"
  ON public.ai_assistant_conversations FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ─ ai_assistant_logs ─
-- Логи видит только сам пользователь (для истории) и ADMIN/SUPER_ADMIN
CREATE POLICY "ai_logs_user_read"
  ON public.ai_assistant_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "ai_logs_admin_read"
  ON public.ai_assistant_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN','SUPER_ADMIN')
        AND ur.is_active
    )
  );

-- Вставлять логи может только система (service role или сам пользователь через RPC)
CREATE POLICY "ai_logs_system_insert"
  ON public.ai_assistant_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Пользователь может ставить was_helpful (thumbs up/down)
CREATE POLICY "ai_logs_user_update_feedback"
  ON public.ai_assistant_logs FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════
-- 12. Indexes for FK (для производительности JOIN-ов)
-- ════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_recipe_purchases_payment ON public.recipe_purchases(payment_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_conversation_id ON public.ai_assistant_logs(conversation_id);

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- 13. Комментарии к таблицам (для документации в psql \d+)
-- ════════════════════════════════════════════════════════════════════
COMMENT ON TABLE public.recipe_marketplace IS 'Каталог авторских рецептов от RECIPE_DEVELOPER. Роялти с продаж идёт автору.';
COMMENT ON TABLE public.recipe_purchases IS 'Покупки рецептов кондитерами. Используется для расчёта роялти.';
COMMENT ON TABLE public.recipe_subscriptions IS 'Премиум-подписки на все рецепты автора.';
COMMENT ON TABLE public.loyalty_partners IS 'Реестр внешних партнёров (банки, страховые, кофейни, ритейл).';
COMMENT ON TABLE public.loyalty_cross_actions IS 'Кросс-акции с внешними партнёрами (скидки, бонусы, freebie).';
COMMENT ON TABLE public.loyalty_point_exchanges IS 'Обмен бонусами между платформой и партнёром.';
COMMENT ON TABLE public.ai_assistant_conversations IS 'Сохранённые диалоги с AI-помощником по ролям.';
COMMENT ON TABLE public.ai_assistant_logs IS 'Логи запросов/ответов AI-помощника для аудита и улучшения модели.';

COMMENT ON COLUMN public.recipe_marketplace.royalty_rate IS 'Процент роялти автору с каждой продажи рецепта (по умолчанию 5%).';
COMMENT ON COLUMN public.loyalty_partners.api_key_hash IS 'Hash API-ключа для интеграций. Сам ключ НЕ хранится.';
COMMENT ON COLUMN public.ai_assistant_logs.was_helpful IS 'Пользовательская оценка ответа (thumbs up/down) для улучшения модели.';
