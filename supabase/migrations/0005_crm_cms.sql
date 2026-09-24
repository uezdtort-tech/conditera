-- ====================================================================
-- 0005_crm_cms.sql — CRM (тикеты, лиды, клиенты) + CMS (страницы, баннеры)
-- ====================================================================
-- Создаёт таблицы:
--   1. support_tickets — тикеты поддержки
--   2. ticket_messages — сообщения в тикетах
--   3. leads — лиды (Kanban: new → contacted → qualified → won/lost)
--   4. lead_activities — активности по лиду (звонки, письма, встречи)
--   5. customer_interactions — timeline всех взаимодействий
--   6. cms_pages — динамические страницы (slug, title, content MDX)
--   7. cms_banners — баннеры (с датами показа)
--   8. cms_nav_menu — пункты меню (header, footer, mobile)
--   9. cms_site_settings — настройки сайта (key-value)
--   10. promo_codes — промокоды
--   11. promo_code_usages — использования промокодов
--   12. moderation_queue — очередь модерации контента
--   13. content_reports — жалобы на контент
--   14. scheduled_jobs — запланированные задачи (v2.0 замена n8n)
-- ====================================================================

-- ===== 1. Support Tickets =====
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  number TEXT UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other', -- order_issue|payment|delivery|refund|product_quality|confectioner|account|technical|other
  priority TEXT NOT NULL DEFAULT 'medium', -- low|medium|high|urgent
  status TEXT NOT NULL DEFAULT 'open', -- open|in_progress|waiting|resolved|closed
  -- Связи
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  -- Метрики
  messages_count INTEGER DEFAULT 0,
  first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  -- Metadata
  metadata JSONB,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.support_tickets IS 'Тикеты поддержки';
CREATE INDEX idx_tickets_user ON public.support_tickets(user_id);
CREATE INDEX idx_tickets_assigned ON public.support_tickets(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_tickets_status ON public.support_tickets(status) WHERE status IN ('open', 'in_progress', 'waiting');
CREATE INDEX idx_tickets_priority ON public.support_tickets(priority) WHERE priority IN ('high', 'urgent');

-- ===== 2. Ticket Messages =====
CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  attachments JSONB,
  is_internal BOOLEAN DEFAULT FALSE, -- internal note (only support can see)
  is_system BOOLEAN DEFAULT FALSE,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

COMMENT ON TABLE public.ticket_messages IS 'Сообщения в тикетах поддержки';
CREATE INDEX idx_ticket_messages_ticket ON public.ticket_messages(ticket_id);
CREATE INDEX idx_ticket_messages_sender ON public.ticket_messages(sender_id);

-- ===== 3. Leads (Kanban) =====
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Источник
  source TEXT NOT NULL DEFAULT 'other', -- website|phone|email|social_media|referral|b2b_inquiry|event|advertising|other
  -- Контакт
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  -- Контекст
  inquiry TEXT, -- что хочет клиент
  budget INTEGER, -- в копейках
  event_date DATE,
  city TEXT,
  -- Статус Kanban
  status TEXT NOT NULL DEFAULT 'new', -- new|contacted|qualified|won|lost
  stage TEXT DEFAULT 'awareness', -- awareness|interest|consideration|intent|evaluation|decision
  -- Assignment
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Metadata
  metadata JSONB,
  -- Timestamps
  contacted_at TIMESTAMPTZ,
  qualified_at TIMESTAMPTZ,
  won_at TIMESTAMPTZ,
  lost_at TIMESTAMPTZ,
  lost_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.leads IS 'Лиды в Kanban-доске';
CREATE INDEX idx_leads_status ON public.leads(status);
CREATE INDEX idx_leads_assigned ON public.leads(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_leads_source ON public.leads(source);
CREATE INDEX idx_leads_created ON public.leads(created_at DESC);

-- ===== 4. Lead Activities =====
CREATE TABLE IF NOT EXISTS public.lead_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- call|email|meeting|note|status_change
  description TEXT,
  outcome TEXT, -- результат взаимодействия
  scheduled_at TIMESTAMPTZ, -- запланированная дата
  completed_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.lead_activities IS 'Активности по лиду (звонки, письма, встречи)';
CREATE INDEX idx_lead_activities_lead ON public.lead_activities(lead_id);
CREATE INDEX idx_lead_activities_scheduled ON public.lead_activities(scheduled_at) WHERE scheduled_at IS NOT NULL;

-- ===== 5. Customer Interactions (timeline) =====
CREATE TABLE IF NOT EXISTS public.customer_interactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- order|ticket|chat|call|email|review|referral|payment|refund|dispute|note|other
  description TEXT,
  related_id UUID, -- ID связанной сущности (order, ticket, etc.)
  related_type TEXT, -- 'order' | 'ticket' | 'chat_message' | etc.
  initiated_by UUID REFERENCES auth.users(id), -- кто инициировал
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.customer_interactions IS 'Timeline всех взаимодействий с клиентом';
CREATE INDEX idx_interactions_user ON public.customer_interactions(user_id);
CREATE INDEX idx_interactions_created ON public.customer_interactions(user_id, created_at DESC);

-- ===== 6. CMS Pages =====
CREATE TABLE IF NOT EXISTS public.cms_pages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL, -- MDX content
  -- SEO
  seo_title TEXT,
  seo_description TEXT,
  seo_keywords TEXT[],
  -- Статус
  status TEXT NOT NULL DEFAULT 'draft', -- draft|published|archived
  is_in_menu BOOLEAN DEFAULT FALSE,
  menu_order INTEGER DEFAULT 0,
  -- Связи
  parent_id UUID REFERENCES public.cms_pages(id) ON DELETE CASCADE,
  -- Timestamps
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

COMMENT ON TABLE public.cms_pages IS 'Динамические CMS страницы (about, faq, legal, etc.)';
CREATE INDEX idx_cms_pages_slug ON public.cms_pages(slug);
CREATE INDEX idx_cms_pages_status ON public.cms_pages(status) WHERE status = 'published';
CREATE INDEX idx_cms_pages_parent ON public.cms_pages(parent_id);

-- ===== 7. CMS Banners =====
CREATE TABLE IF NOT EXISTS public.cms_banners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  image_url TEXT,
  link_url TEXT,
  position TEXT NOT NULL DEFAULT 'home_hero', -- home_hero|catalog_top|sidebar|footer|mobile
  text TEXT,
  cta_text TEXT,
  -- Расписание показа
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  -- Таргетинг
  target_audience TEXT[], -- ['CUSTOMER', 'CONFECTIONER', ...]
  -- Статус
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  -- Метрики
  impressions_count INTEGER DEFAULT 0,
  clicks_count INTEGER DEFAULT 0,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.cms_banners IS 'Баннеры для главной и каталога';
CREATE INDEX idx_banners_position ON public.cms_banners(position);
CREATE INDEX idx_banners_active ON public.cms_banners(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_banners_dates ON public.cms_banners(starts_at, ends_at);

-- ===== 8. CMS Nav Menu =====
CREATE TABLE IF NOT EXISTS public.cms_nav_menu (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location TEXT NOT NULL DEFAULT 'header', -- header|footer|mobile
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  icon TEXT,
  parent_id UUID REFERENCES public.cms_nav_menu(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  -- Условия показа
  show_for_roles TEXT[], -- пусто = для всех
  show_for_authenticated BOOLEAN, -- true = только залогиненным, false = только гостям
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.cms_nav_menu IS 'Пункты меню (header, footer, mobile)';
CREATE INDEX idx_nav_location ON public.cms_nav_menu(location);
CREATE INDEX idx_nav_active ON public.cms_nav_menu(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_nav_parent ON public.cms_nav_menu(parent_id);

-- ===== 9. CMS Site Settings =====
CREATE TABLE IF NOT EXISTS public.cms_site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  value_type TEXT DEFAULT 'string', -- string|number|boolean|json
  description TEXT,
  category TEXT DEFAULT 'general', -- general|contacts|social|seo|analytics|features
  is_public BOOLEAN DEFAULT TRUE, -- видна на клиенте?
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.cms_site_settings IS 'Настройки сайта (key-value)';
CREATE INDEX idx_settings_category ON public.cms_site_settings(category);
CREATE INDEX idx_settings_public ON public.cms_site_settings(is_public) WHERE is_public = TRUE;

-- ===== 10. Promo Codes =====
CREATE TABLE IF NOT EXISTS public.promo_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  -- Тип скидки
  type TEXT NOT NULL DEFAULT 'percent', -- percent|fixed|free_delivery
  value INTEGER NOT NULL DEFAULT 0, -- процент или сумма в копейках
  -- Условия
  min_order_amount INTEGER DEFAULT 0,
  max_uses INTEGER, -- NULL = безлимит
  used_count INTEGER DEFAULT 0,
  -- Срок действия
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_to TIMESTAMPTZ,
  -- Таргетинг
  applies_to TEXT DEFAULT 'all', -- all|first_order|specific_category|specific_confectioner
  target_id UUID, -- category_id или confectioner_id
  -- Статус
  is_active BOOLEAN DEFAULT TRUE,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.promo_codes IS 'Промокоды';
CREATE INDEX idx_promo_code ON public.promo_codes(code);
CREATE INDEX idx_promo_active ON public.promo_codes(is_active) WHERE is_active = TRUE;

-- ===== 11. Promo Code Usages =====
CREATE TABLE IF NOT EXISTS public.promo_code_usages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  promo_code_id UUID NOT NULL REFERENCES public.promo_codes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  discount_amount INTEGER NOT NULL, -- в копейках
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (promo_code_id, user_id, order_id)
);

COMMENT ON TABLE public.promo_code_usages IS 'Использования промокодов';
CREATE INDEX idx_promo_usages_code ON public.promo_code_usages(promo_code_id);
CREATE INDEX idx_promo_usages_user ON public.promo_code_usages(user_id);

-- ===== 12. Moderation Queue =====
CREATE TABLE IF NOT EXISTS public.moderation_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_type TEXT NOT NULL, -- product|product_review|confectioner_review|chat_message|broadcast|venue|service_product|event|user_profile|comment
  content_id UUID NOT NULL,
  -- Автор
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Авто-модерация
  auto_status TEXT DEFAULT 'pending', -- approved|pending|rejected
  auto_reason TEXT,
  flagged_keywords TEXT[],
  -- Ручная модерация
  manual_status TEXT, -- approved|pending|rejected|flagged
  moderated_by UUID REFERENCES auth.users(id),
  moderated_at TIMESTAMPTZ,
  moderation_comment TEXT,
  -- Snapshot content для превью
  content_snapshot JSONB,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.moderation_queue IS 'Очередь модерации контента';
CREATE INDEX idx_moderation_content ON public.moderation_queue(content_type, content_id);
CREATE INDEX idx_moderation_status ON public.moderation_queue(auto_status, manual_status);
CREATE INDEX idx_moderation_pending ON public.moderation_queue(created_at) WHERE auto_status = 'pending' OR manual_status = 'pending';

-- ===== 13. Content Reports (жалобы) =====
CREATE TABLE IF NOT EXISTS public.content_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  content_id UUID NOT NULL,
  reason TEXT NOT NULL, -- adult_content|violence|extremism|drugs|weapons|spam|scam|insult|hate_speech|illegal_goods|copyright|personal_data
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|reviewing|resolved|dismissed
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  resolution_comment TEXT,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.content_reports IS 'Жалобы на контент';
CREATE INDEX idx_reports_status ON public.content_reports(status) WHERE status IN ('pending', 'reviewing');
CREATE INDEX idx_reports_content ON public.content_reports(content_type, content_id);

-- ===== 14. Scheduled Jobs (замена n8n) =====
CREATE TABLE IF NOT EXISTS public.scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  -- Тип задачи
  type TEXT NOT NULL, -- edge_function|sql|cleanup|backup|notification
  -- Что запустить
  function_name TEXT, -- для edge_function: имя функции (например 'abandoned-cart')
  sql_query TEXT, -- для sql: SQL запрос
  -- Расписание (cron format)
  cron_expression TEXT NOT NULL, -- '0 * * * *' (каждый час)
  timezone TEXT DEFAULT 'Europe/Moscow',
  -- Статус
  is_active BOOLEAN DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  -- Метрики
  runs_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  last_error TEXT,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.scheduled_jobs IS 'Запланированные задачи (замена n8n через pg_cron)';
CREATE INDEX idx_jobs_active ON public.scheduled_jobs(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_jobs_next_run ON public.scheduled_jobs(next_run_at) WHERE is_active = TRUE;

-- ===== 15. RLS политики =====

-- 15.1. support_tickets — user видит свои, support/admin видят все
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tickets_select_own_or_admin" ON public.support_tickets
  FOR SELECT USING (
    auth.uid() = user_id OR
    auth.uid() = assigned_to OR
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'MODERATOR')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "tickets_insert_own" ON public.support_tickets
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tickets_update_admin_support" ON public.support_tickets
  FOR UPDATE USING (
    auth.uid() = user_id OR
    auth.uid() = assigned_to OR
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
            AND ur.is_active = TRUE)
  );

-- 15.2. ticket_messages — участники видят (кроме internal notes — только support)
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ticket_messages_select_participants" ON public.ticket_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.support_tickets t
            WHERE t.id = ticket_id AND (
              t.user_id = auth.uid() OR
              t.assigned_to = auth.uid() OR
              EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = auth.uid()
                      AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'MODERATOR')
                      AND ur.is_active = TRUE)
            )) AND
    (NOT is_internal OR EXISTS (SELECT 1 FROM public.user_roles ur
                                 WHERE ur.user_id = auth.uid()
                                 AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
                                 AND ur.is_active = TRUE))
  );
CREATE POLICY "ticket_messages_insert_participants" ON public.ticket_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (SELECT 1 FROM public.support_tickets t
            WHERE t.id = ticket_id AND (
              t.user_id = auth.uid() OR
              t.assigned_to = auth.uid() OR
              EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = auth.uid()
                      AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
                      AND ur.is_active = TRUE)
            ))
  );

-- 15.3. leads — только admin/support/CONFECTIONER (могут получить лидов)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads_select_crm" ON public.leads
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'MODERATOR', 'CONFECTIONER')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "leads_insert_crm" ON public.leads
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "leads_update_crm" ON public.leads
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
            AND ur.is_active = TRUE)
  );

-- 15.4. lead_activities — через lead_id (только CRM роли)
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lead_activities_select_crm" ON public.lead_activities
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "lead_activities_insert_crm" ON public.lead_activities
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
            AND ur.is_active = TRUE)
  );

-- 15.5. customer_interactions — владелец видит свои, admin/support все
ALTER TABLE public.customer_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "interactions_select_own_or_crm" ON public.customer_interactions
  FOR SELECT USING (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "interactions_insert_crm" ON public.customer_interactions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'ADMIN')
            AND ur.is_active = TRUE)
  );

-- 15.6. cms_pages — public read published, admin write
ALTER TABLE public.cms_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cms_pages_select_public" ON public.cms_pages
  FOR SELECT USING (status = 'published' OR deleted_at IS NOT NULL);
CREATE POLICY "cms_pages_write_admin" ON public.cms_pages
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'COPYWRITER')
            AND ur.is_active = TRUE)
  );

-- 15.7. cms_banners — public read active, admin write
ALTER TABLE public.cms_banners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cms_banners_select_public" ON public.cms_banners
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "cms_banners_write_admin" ON public.cms_banners
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            AND ur.is_active = TRUE)
  );

-- 15.8. cms_nav_menu — public read active, admin write
ALTER TABLE public.cms_nav_menu ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cms_nav_select_public" ON public.cms_nav_menu
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "cms_nav_write_admin" ON public.cms_nav_menu
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            AND ur.is_active = TRUE)
  );

-- 15.9. cms_site_settings — public read public settings, admin write all
ALTER TABLE public.cms_site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cms_settings_select_public" ON public.cms_site_settings
  FOR SELECT USING (is_public = TRUE);
CREATE POLICY "cms_settings_select_admin" ON public.cms_site_settings
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "cms_settings_write_admin" ON public.cms_site_settings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            AND ur.is_active = TRUE)
  );

-- 15.10. promo_codes — public read active, admin write
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "promo_codes_select_public" ON public.promo_codes
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "promo_codes_write_admin" ON public.promo_codes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            AND ur.is_active = TRUE)
  );

-- 15.11. promo_code_usages — user видит свои, admin все
ALTER TABLE public.promo_code_usages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "promo_usages_select_own_or_admin" ON public.promo_code_usages
  FOR SELECT USING (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "promo_usages_insert_own" ON public.promo_code_usages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 15.12. moderation_queue — admin/moderator только
ALTER TABLE public.moderation_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "moderation_select_admin_moderator" ON public.moderation_queue
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'MODERATOR')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "moderation_write_admin_moderator" ON public.moderation_queue
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'MODERATOR')
            AND ur.is_active = TRUE)
  );

-- 15.13. content_reports — user видит свои, admin/moderator все
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports_select_own_or_admin" ON public.content_reports
  FOR SELECT USING (
    auth.uid() = reporter_id OR
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'MODERATOR')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "reports_insert_own" ON public.content_reports
  FOR INSERT WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "reports_update_admin_moderator" ON public.content_reports
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'MODERATOR')
            AND ur.is_active = TRUE)
  );

-- 15.14. scheduled_jobs — admin only
ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jobs_admin_all" ON public.scheduled_jobs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            AND ur.is_active = TRUE)
  );

-- ===== 16. Triggers =====

CREATE TRIGGER support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER cms_pages_updated_at
  BEFORE UPDATE ON public.cms_pages
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER cms_banners_updated_at
  BEFORE UPDATE ON public.cms_banners
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER cms_nav_menu_updated_at
  BEFORE UPDATE ON public.cms_nav_menu
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER promo_codes_updated_at
  BEFORE UPDATE ON public.promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER moderation_queue_updated_at
  BEFORE UPDATE ON public.moderation_queue
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER content_reports_updated_at
  BEFORE UPDATE ON public.content_reports
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER scheduled_jobs_updated_at
  BEFORE UPDATE ON public.scheduled_jobs
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

-- Auto-generate ticket number
CREATE OR REPLACE FUNCTION public.generate_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.number IS NULL THEN
    SELECT 'TKT-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' ||
           LPAD((COALESCE(MAX(SUBSTRING(number FROM 5 FOR 4))::INTEGER, 0) + 1)::TEXT, 4, '0')
    INTO NEW.number
    FROM public.support_tickets
    WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_generate_number
  BEFORE INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.generate_ticket_number();

-- Auto-update ticket messages_count + status при INSERT message
CREATE OR REPLACE FUNCTION public.update_ticket_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.support_tickets SET
    messages_count = messages_count + 1,
    updated_at = NOW(),
    status = CASE
      WHEN status = 'open' THEN 'in_progress'
      ELSE status
    END,
    first_response_at = COALESCE(first_response_at, NOW())
  WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ticket_messages_update_ticket
  AFTER INSERT ON public.ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_ticket_on_message();

-- Settings updated_by trigger
CREATE OR REPLACE FUNCTION public.update_settings_updated_by()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_by = auth.uid();
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER cms_settings_updated_by
  BEFORE UPDATE ON public.cms_site_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_settings_updated_by();

-- ===== 17. Permissions =====
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON
  public.support_tickets, public.ticket_messages,
  public.leads, public.lead_activities, public.customer_interactions,
  public.cms_pages, public.cms_banners, public.cms_nav_menu, public.cms_site_settings,
  public.promo_codes, public.promo_code_usages,
  public.moderation_queue, public.content_reports, public.scheduled_jobs
TO authenticated;

-- ===== Готово =====
-- Тест: SELECT * FROM public.support_tickets LIMIT 5;
--       SELECT * FROM public.leads LIMIT 5;
--       SELECT * FROM public.cms_pages LIMIT 5;
