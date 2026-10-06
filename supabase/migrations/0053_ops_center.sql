-- 0053_ops_center.sql — P0-ядро «операционного центра» (Task 2-a).
--
-- 1) public.domain_events      — append-only event log (order.*/media.*/inventory.* и т.д.)
-- 2) public.ops_tasks          — очередь задач «Требуют действия» (rule engine материализует)
-- 3) public.purchase_drafts / purchase_draft_items — черновики закупок (low-stock auto)
-- 4) public.recipe_ingredients — структурированные ингредиенты рецепта (для разбора заказа)
--
-- Всё идемпотентно (IF NOT EXISTS / CREATE OR REPLACE / DO $$ guard).
-- RLS по образцу product_media (0052): ENABLE + SELECT для authenticated;
-- запись — только service role (BYPASSRLS), API пишет через getPool() от postgres.
-- updated_at-триггер — общий handle_marketplace_updated_at (0002:498).

-- ============================================================================
-- 1. domain_events — append-only лог доменных событий
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.domain_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  type text NOT NULL,                      -- order.created|order.paid|order.status_changed|order.cancelled|media.uploaded|media.approved|media.rejected|inventory.low_stock|chat.unanswered|ops.task_created ...
  entity_type text,                        -- order|product|product_media|inventory_item|chat_channel
  entity_id text,
  actor_id uuid,                           -- кто вызвал (если человек)
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'app',      -- app|n8n|cron|engine
  occurred_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.domain_events IS 'Append-only лог доменных событий (event log ops-center)';

CREATE INDEX IF NOT EXISTS idx_domain_events_type ON public.domain_events (type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_entity ON public.domain_events (entity_type, entity_id);

ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'domain_events' AND policyname = 'domain_events_select') THEN
    CREATE POLICY domain_events_select ON public.domain_events
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ============================================================================
-- 2. ops_tasks — очередь задач «Требуют действия»
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ops_tasks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  dedup_key text NOT NULL UNIQUE,          -- '<type>:<entity_id>' или агрегатный 'MEDIA_PENDING:aggregate'
  type text NOT NULL,                      -- ORDER_UNASSIGNED|ORDER_OVERDUE|MEDIA_PENDING|LOW_STOCK|CHAT_UNANSWERED|ORDER_REVIEW_REQUEST
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('critical','important','info')),
  title text NOT NULL,
  description text,
  entity_type text,
  entity_id text,
  assignee_role text,                      -- ADMIN|MODERATOR|CONFECTIONER (null = всем)
  assignee_id uuid,                        -- конкретный юзер (кондитер) или null
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_label text,
  action_url text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  source text NOT NULL DEFAULT 'engine',   -- engine|manual (engine-задачи авто-resolve при исчезновении условия)
  due_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz,
  resolve_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ops_tasks IS 'Очередь задач «Требуют действия» (rule engine ops-center)';

CREATE INDEX IF NOT EXISTS idx_ops_tasks_queue ON public.ops_tasks (status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_tasks_assignee ON public.ops_tasks (assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_ops_tasks_role ON public.ops_tasks (assignee_role, status);

ALTER TABLE public.ops_tasks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ops_tasks' AND policyname = 'ops_tasks_select') THEN
    CREATE POLICY ops_tasks_select ON public.ops_tasks
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ============================================================================
-- 3. purchase_drafts / purchase_draft_items — черновики закупок
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.purchase_drafts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','received','cancelled')),
  source text NOT NULL DEFAULT 'manual',   -- low_stock_auto|order_shortage|manual
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.purchase_drafts IS 'Черновики закупок склада (low_stock_auto|order_shortage|manual)';

CREATE TABLE IF NOT EXISTS public.purchase_draft_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  draft_id uuid NOT NULL REFERENCES public.purchase_drafts(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  name text NOT NULL,
  quantity numeric(12,2) NOT NULL,
  unit text NOT NULL,
  estimated_cost integer,                  -- руб, cost_per_unit * qty (если известен)
  supplier text
);

CREATE INDEX IF NOT EXISTS idx_purchase_drafts_owner ON public.purchase_drafts (owner_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_draft_items_draft ON public.purchase_draft_items (draft_id);

ALTER TABLE public.purchase_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_draft_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_drafts' AND policyname = 'purchase_drafts_select') THEN
    CREATE POLICY purchase_drafts_select ON public.purchase_drafts
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_draft_items' AND policyname = 'purchase_draft_items_select') THEN
    CREATE POLICY purchase_draft_items_select ON public.purchase_draft_items
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ============================================================================
-- 4. recipe_ingredients — структурированные ингредиенты рецепта
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  name text NOT NULL,
  qty numeric(12,3) NOT NULL,              -- количество в единицах unit НА ОДНУ ЕДИНИЦУ товара (1 порцию/1 шт)
  unit text NOT NULL,                      -- г|мл|шт
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.recipe_ingredients IS 'Структурированные ингредиенты рецепта (норма на 1 единицу товара)';

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON public.recipe_ingredients (recipe_id);

ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_ingredients' AND policyname = 'recipe_ingredients_select') THEN
    CREATE POLICY recipe_ingredients_select ON public.recipe_ingredients
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ============================================================================
-- 5. updated_at-триггеры (общий хендлер из 0002)
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_marketplace_updated_at') THEN
    -- domain_events — append-only, updated_at-колонки нет (триггер не нужен)

    DROP TRIGGER IF EXISTS trg_ops_tasks_updated_at ON public.ops_tasks;
    CREATE TRIGGER trg_ops_tasks_updated_at BEFORE UPDATE ON public.ops_tasks
      FOR EACH ROW EXECUTE FUNCTION handle_marketplace_updated_at();

    DROP TRIGGER IF EXISTS trg_purchase_drafts_updated_at ON public.purchase_drafts;
    CREATE TRIGGER trg_purchase_drafts_updated_at BEFORE UPDATE ON public.purchase_drafts
      FOR EACH ROW EXECUTE FUNCTION handle_marketplace_updated_at();
  END IF;
END $$;
