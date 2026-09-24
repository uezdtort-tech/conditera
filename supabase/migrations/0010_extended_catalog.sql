-- ====================================================================
-- 0010_extended_catalog.sql — Расширенный каталог (45 начинок, подписки, сертификаты)
-- ====================================================================
-- Дополняет существующие таблицы и создаёт недостающие
-- ====================================================================

-- ===== 1. Fillings (45 начинок с группами вкуса) =====
CREATE TABLE IF NOT EXISTS public.fillings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  base_sponge TEXT NOT NULL DEFAULT 'classic', -- milk|chocolate|classic|caramel
  flavor_group TEXT NOT NULL DEFAULT 'cream', -- berry|fruit|chocolate|caramel|nut|cream|mousse
  dietary_tags TEXT[] DEFAULT '{}',
  price_multiplier DECIMAL(3,2) DEFAULT 1.0, -- 1.0-1.4
  is_seasonal BOOLEAN DEFAULT FALSE,
  season_months INT[] DEFAULT '{}', -- [1,2,12] для зимних
  color_code TEXT DEFAULT '#F5DEB3', -- для визуальной маркировки
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.fillings IS '45 начинок с группами вкуса для конструктора';
CREATE INDEX idx_fillings_flavor_group ON public.fillings(flavor_group);
CREATE INDEX idx_fillings_active ON public.fillings(is_active) WHERE is_active = TRUE;

-- ===== 2. Coatings & Decor =====
CREATE TABLE IF NOT EXISTS public.coatings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'cream', -- mastic|cream|ganache|mirror_glaze|velvet|chocolate
  price_modifier INTEGER DEFAULT 0,
  color_code TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.decor_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'edible', -- edible|tool|ingredient|packaging
  price_modifier INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0
);

-- ===== 3. Subscriptions =====
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'monthly', -- weekly|biweekly|monthly
  product_template JSONB, -- параметры торта для повторения
  next_delivery_date DATE NOT NULL,
  delivery_day_of_week INT DEFAULT 1, -- 1=Пн ... 7=Вс
  status TEXT NOT NULL DEFAULT 'active', -- active|paused|cancelled
  paused_until DATE,
  -- Финансы
  price_per_delivery INTEGER NOT NULL,
  discount_percent INTEGER DEFAULT 10, -- скидка подписки
  -- Метаданные
  total_deliveries INTEGER DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.subscriptions IS 'Подписки на регулярную доставку тортов';
CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_active ON public.subscriptions(status) WHERE status = 'active';

-- ===== 4. Gift Certificates =====
CREATE TABLE IF NOT EXISTS public.gift_certificates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  purchaser_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_email TEXT,
  recipient_name TEXT,
  -- Номинал
  amount INTEGER NOT NULL, -- 500, 1000, 3000, 5000, 10000 (в рублях)
  -- Статус
  status TEXT NOT NULL DEFAULT 'purchased', -- purchased|activated|used|expired
  activated_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '365 days',
  -- Связь
  payment_id UUID REFERENCES public.payments(id),
  applied_to_order_id UUID REFERENCES public.orders(id),
  -- PDF
  pdf_url TEXT,
  is_personalized BOOLEAN DEFAULT FALSE,
  message TEXT,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.gift_certificates IS 'Подарочные сертификаты 500-10000₽';
CREATE INDEX idx_gift_certs_code ON public.gift_certificates(code);
CREATE INDEX idx_gift_certs_purchaser ON public.gift_certificates(purchaser_id);

-- ===== 5. Recipes (блог/рецепты) =====
CREATE TABLE IF NOT EXISTS public.recipes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL, -- MDX content with steps
  -- Метаданные
  difficulty TEXT DEFAULT 'easy', -- easy|medium|hard
  prep_time_minutes INTEGER,
  cook_time_minutes INTEGER,
  servings INTEGER DEFAULT 8,
  calories_per_serving INTEGER,
  protein_g DECIMAL(5,1),
  fat_g DECIMAL(5,1),
  carb_g DECIMAL(5,1),
  -- Категоризация
  tags TEXT[] DEFAULT '{}',
  category TEXT,
  -- Медиа
  image_url TEXT,
  video_url TEXT,
  -- SEO
  slug TEXT UNIQUE,
  -- Статус
  status TEXT DEFAULT 'draft', -- draft|published|archived
  -- Метрики
  views_count INTEGER DEFAULT 0,
  likes_count INTEGER DEFAULT 0,
  -- Timestamps
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.recipes IS 'Рецепты с пошаговыми инструкциями, фото/видео, БЖУ';
CREATE INDEX idx_recipes_author ON public.recipes(author_id);
CREATE INDEX idx_recipes_status ON public.recipes(status) WHERE status = 'published';
CREATE INDEX idx_recipes_tags ON public.recipes USING GIN(tags);

-- ===== 6. Recipe Acceptances (отметки о приготовлении) =====
CREATE TABLE IF NOT EXISTS public.recipe_acceptances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (recipe_id, user_id)
);

CREATE INDEX idx_recipe_acceptances_recipe ON public.recipe_acceptances(recipe_id);

-- ===== 7. Lessons (мастер-классы) =====
CREATE TABLE IF NOT EXISTS public.lessons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  confectioner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  atelier_id UUID REFERENCES public.ateliers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  topic TEXT, -- 'biscuits'|'cream'|'mastic'|'flowers'|'painting'
  difficulty TEXT DEFAULT 'beginner', -- beginner|intermediate|advanced
  duration_minutes INTEGER DEFAULT 180,
  max_participants INTEGER DEFAULT 10,
  price INTEGER NOT NULL,
  -- Расписание
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'scheduled', -- scheduled|completed|cancelled
  -- Медиа
  image_url TEXT,
  -- Метрики
  enrolled_count INTEGER DEFAULT 0,
  rating FLOAT DEFAULT 0,
  reviews_count INTEGER DEFAULT 0,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lessons_confectioner ON public.lessons(confectioner_id);
CREATE INDEX idx_lessons_scheduled ON public.lessons(scheduled_at) WHERE status = 'scheduled';

-- ===== 8. Lesson Enrollments =====
CREATE TABLE IF NOT EXISTS public.lesson_enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending', -- pending|confirmed|cancelled|completed
  payment_id UUID REFERENCES public.payments(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (lesson_id, user_id)
);

CREATE INDEX idx_lesson_enrollments_lesson ON public.lesson_enrollments(lesson_id);

-- ===== 9. Holiday Reminders =====
CREATE TABLE IF NOT EXISTS public.holiday_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- birthday|anniversary|nameday|holiday|custom
  date DATE NOT NULL,
  remind_days_before INT DEFAULT 7,
  is_recurring BOOLEAN DEFAULT TRUE,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_holiday_reminders_user ON public.holiday_reminders(user_id);
CREATE INDEX idx_holiday_reminders_date ON public.holiday_reminders(date);

-- ===== 10. Inventory Items (склад) =====
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT, -- ingredients|packaging|equipment|tools
  quantity DECIMAL(10,2) DEFAULT 0,
  unit TEXT DEFAULT 'kg',
  min_quantity DECIMAL(10,2) DEFAULT 0,
  cost_per_unit INTEGER DEFAULT 0,
  supplier TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inventory_owner ON public.inventory_items(owner_id);

-- ===== 11. Stock Movements =====
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inventory_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- purchase|consumption|adjustment|writeoff
  quantity DECIMAL(10,2) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stock_movements_inventory ON public.stock_movements(inventory_id);

-- ===== 12. Loyalty Transactions =====
CREATE TABLE IF NOT EXISTS public.loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- earn|redeem|expire|refund|adjust|welcome|birthday|referral
  amount INTEGER NOT NULL,
  order_id UUID REFERENCES public.orders(id),
  expires_at TIMESTAMPTZ,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_loyalty_user ON public.loyalty_transactions(user_id);

-- ===== 13. Gamification =====
CREATE TABLE IF NOT EXISTS public.badges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  category TEXT, -- orders|reviews|social|milestone
  requirement JSONB,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.user_badges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_id UUID NOT NULL REFERENCES public.badges(id) ON DELETE CASCADE,
  awarded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS public.challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT, -- order_count|spend_amount|review_count|referral_count
  target_value INTEGER NOT NULL,
  reward_type TEXT, -- bonus|discount|badge
  reward_value INTEGER,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.user_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  progress INTEGER DEFAULT 0,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, challenge_id)
);

-- ===== 14. Notifications =====
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- order_created|order_status_changed|new_message|promotion|etc
  title TEXT NOT NULL,
  body TEXT,
  channel TEXT DEFAULT 'in_app', -- email|push|telegram|in_app|sms
  status TEXT DEFAULT 'queued', -- queued|sent|delivered|failed|read|dismissed
  metadata JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON public.notifications(user_id);
CREATE INDEX idx_notifications_unread ON public.notifications(user_id, status) WHERE status NOT IN ('read', 'dismissed');

-- ===== 15. Financial Audit Log =====
CREATE TABLE IF NOT EXISTS public.financial_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- payout_request|refund_processed|tax_report|commission_change
  entity_type TEXT,
  entity_id UUID,
  old_value JSONB,
  new_value JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user ON public.financial_audit_log(user_id);
CREATE INDEX idx_audit_log_created ON public.financial_audit_log(created_at DESC);

-- ===== 16. Operator Escalations =====
CREATE TABLE IF NOT EXISTS public.operator_escalations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  priority TEXT DEFAULT 'high',
  status TEXT DEFAULT 'pending', -- pending|resolved
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 17. Canned Responses =====
CREATE TABLE IF NOT EXISTS public.canned_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 18. Moderation Rules =====
CREATE TABLE IF NOT EXISTS public.moderation_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL, -- regex|keywords|url_pattern|email_pattern
  pattern TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'flag', -- reject|flag|warn
  category TEXT, -- product|review|chat|user_profile
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 19. Organization Verification =====
CREATE TABLE IF NOT EXISTS public.organization_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  inn TEXT NOT NULL,
  ogrn TEXT,
  kpp TEXT,
  company_name TEXT,
  full_name TEXT,
  opf_code TEXT,
  opf_short TEXT,
  status TEXT DEFAULT 'unknown', -- active|liquidating|liquidated|reorganizing|unknown
  trigger TEXT DEFAULT 'registration', -- registration|profile_update|invoice_issue|payout_request|cron_periodic|admin_manual
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 20. Maintenance Log =====
CREATE TABLE IF NOT EXISTS public.maintenance_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL, -- backup_full|backup_incremental|cleanup_logs|cleanup_sessions|cleanup_notifications|cleanup_carts|vacuum
  status TEXT DEFAULT 'queued', -- queued|running|success|failed|partial
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  records_affected INTEGER,
  backup_path TEXT,
  backup_size_bytes BIGINT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 21. Push Subscriptions =====
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  keys JSONB NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_push_subs_user ON public.push_subscriptions(user_id);

-- ===== RLS для новых таблиц =====
-- fillings: public read, admin write
ALTER TABLE public.fillings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fillings_select_public" ON public.fillings FOR SELECT USING (is_active = TRUE);
CREATE POLICY "fillings_write_admin" ON public.fillings FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
);
ALTER TABLE public.coatings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coatings_select_public" ON public.coatings FOR SELECT USING (is_active = TRUE);
CREATE POLICY "coatings_write_admin" ON public.coatings FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
);
ALTER TABLE public.decor_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "decor_select_public" ON public.decor_items FOR SELECT USING (is_active = TRUE);
CREATE POLICY "decor_write_admin" ON public.decor_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
);

-- subscriptions: own
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subs_select_own" ON public.subscriptions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "subs_insert_own" ON public.subscriptions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "subs_update_own" ON public.subscriptions FOR UPDATE USING (user_id = auth.uid());

-- gift_certificates: purchaser or recipient
ALTER TABLE public.gift_certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gift_certs_select_own" ON public.gift_certificates FOR SELECT USING (purchaser_id = auth.uid());
CREATE POLICY "gift_certs_insert_own" ON public.gift_certificates FOR INSERT WITH CHECK (purchaser_id = auth.uid());
CREATE POLICY "gift_certs_update_admin" ON public.gift_certificates FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
);

-- recipes: public read published, author write
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recipes_select_public" ON public.recipes FOR SELECT USING (status = 'published' OR author_id = auth.uid());
CREATE POLICY "recipes_insert_own" ON public.recipes FOR INSERT WITH CHECK (author_id = auth.uid());
CREATE POLICY "recipes_update_own" ON public.recipes FOR UPDATE USING (author_id = auth.uid());

-- recipe_acceptances: own
ALTER TABLE public.recipe_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acceptances_select_public" ON public.recipe_acceptances FOR SELECT USING (TRUE);
CREATE POLICY "acceptances_insert_own" ON public.recipe_acceptances FOR INSERT WITH CHECK (user_id = auth.uid());

-- lessons: public read, confectioner write
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lessons_select_public" ON public.lessons FOR SELECT USING (status IN ('scheduled','completed'));
CREATE POLICY "lessons_write_own" ON public.lessons FOR ALL USING (confectioner_id = auth.uid());

-- lesson_enrollments: own + confectioner
ALTER TABLE public.lesson_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "enrollments_select" ON public.lesson_enrollments FOR SELECT USING (
  user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.lessons l WHERE l.id = lesson_id AND l.confectioner_id = auth.uid())
);
CREATE POLICY "enrollments_insert_own" ON public.lesson_enrollments FOR INSERT WITH CHECK (user_id = auth.uid());

-- holiday_reminders: own
ALTER TABLE public.holiday_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reminders_own" ON public.holiday_reminders FOR ALL USING (user_id = auth.uid());

-- inventory_items: own
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inventory_own" ON public.inventory_items FOR ALL USING (owner_id = auth.uid());

-- stock_movements: through inventory
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_own" ON public.stock_movements FOR ALL USING (
  EXISTS (SELECT 1 FROM public.inventory_items i WHERE i.id = inventory_id AND i.owner_id = auth.uid())
);

-- loyalty_transactions: own + admin
ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "loyalty_select_own" ON public.loyalty_transactions FOR SELECT USING (
  user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
);
CREATE POLICY "loyalty_insert_admin" ON public.loyalty_transactions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN','ADMIN') AND ur.is_active)
);

-- badges: public read, admin write
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "badges_select_public" ON public.badges FOR SELECT USING (is_active = TRUE);
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_badges_own" ON public.user_badges FOR SELECT USING (user_id = auth.uid());

-- challenges: public read
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "challenges_select_public" ON public.challenges FOR SELECT USING (is_active = TRUE);
ALTER TABLE public.user_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_challenges_own" ON public.user_challenges FOR SELECT USING (user_id = auth.uid());

-- notifications: own
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_own" ON public.notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "notifications_insert_admin" ON public.notifications FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN','ADMIN') AND ur.is_active)
);
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE USING (user_id = auth.uid());

-- financial_audit_log: admin only
ALTER TABLE public.financial_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_admin" ON public.financial_audit_log FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN','INSPECTOR') AND ur.is_active)
);

-- operator_escalations: admin/support
ALTER TABLE public.operator_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "escalations_admin" ON public.operator_escalations FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN','SUPPORT') AND ur.is_active)
);

-- canned_responses: admin/support
ALTER TABLE public.canned_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "canned_admin" ON public.canned_responses FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN','SUPPORT') AND ur.is_active)
);

-- moderation_rules: admin/moderator
ALTER TABLE public.moderation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mod_rules_admin" ON public.moderation_rules FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN','MODERATOR') AND ur.is_active)
);

-- organization_verifications: admin
ALTER TABLE public.organization_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_verif_admin" ON public.organization_verifications FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
);

-- maintenance_log: admin
ALTER TABLE public.maintenance_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "maintenance_admin" ON public.maintenance_log FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
);

-- push_subscriptions: own
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "push_subs_own" ON public.push_subscriptions FOR ALL USING (user_id = auth.uid());

-- Triggers
CREATE TRIGGER fillings_updated_at BEFORE UPDATE ON public.fillings FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();
CREATE TRIGGER gift_certs_updated_at BEFORE UPDATE ON public.gift_certificates FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();
CREATE TRIGGER recipes_updated_at BEFORE UPDATE ON public.recipes FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();
CREATE TRIGGER lessons_updated_at BEFORE UPDATE ON public.lessons FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();
CREATE TRIGGER inventory_updated_at BEFORE UPDATE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();
CREATE TRIGGER canned_updated_at BEFORE UPDATE ON public.canned_responses FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON
  public.fillings, public.coatings, public.decor_items,
  public.subscriptions, public.gift_certificates,
  public.recipes, public.recipe_acceptances,
  public.lessons, public.lesson_enrollments,
  public.holiday_reminders,
  public.inventory_items, public.stock_movements,
  public.loyalty_transactions,
  public.user_badges, public.user_challenges,
  public.notifications, public.push_subscriptions
TO authenticated;
