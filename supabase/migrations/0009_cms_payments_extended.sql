-- ====================================================================
-- 0009_cms_payments_extended.sql — CMS Media, Design, Payouts, Refunds
-- ====================================================================

-- ===== 1. CMS Media Library =====
CREATE TABLE IF NOT EXISTS public.cms_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL, -- image|video|document|audio
  size_bytes BIGINT,
  mime_type TEXT,
  alt_text TEXT,
  width INTEGER,
  height INTEGER,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_public BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.cms_media IS 'Медиатека (загруженные файлы)';
CREATE INDEX idx_cms_media_type ON public.cms_media(type);
CREATE INDEX idx_cms_media_uploaded_by ON public.cms_media(uploaded_by);

-- ===== 2. CMS Page History (версионирование) =====
CREATE TABLE IF NOT EXISTS public.cms_page_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_id UUID NOT NULL REFERENCES public.cms_pages(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  change_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.cms_page_history IS 'История версий CMS страниц';
CREATE INDEX idx_cms_page_history_page ON public.cms_page_history(page_id);

-- ===== 3. Design Settings =====
CREATE TABLE IF NOT EXISTS public.design_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theme TEXT DEFAULT 'default', -- default|dark|custom
  primary_color TEXT DEFAULT '#8B2942',
  accent_color TEXT DEFAULT '#D97706',
  background_color TEXT DEFAULT '#FFFFFF',
  text_color TEXT DEFAULT '#1F2937',
  font_heading TEXT DEFAULT 'Brokgauz_amp_Efron-Italic',
  font_body TEXT DEFAULT 'Geist',
  layout_style TEXT DEFAULT 'classic', -- classic|modern|minimal
  max_width INTEGER DEFAULT 1280,
  animations_enabled BOOLEAN DEFAULT TRUE,
  custom_css TEXT,
  custom_js TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.design_settings IS 'Настройки дизайна сайта';
INSERT INTO public.design_settings DEFAULT VALUES ON CONFLICT DO NOTHING;

-- ===== 4. Payout Requests =====
CREATE TABLE IF NOT EXISTS public.payout_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL, -- в копейках
  status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected|paid
  method TEXT DEFAULT 'card', -- card|sbp|invoice
  bank_details JSONB,
  -- Обработка
  processed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  payment_id TEXT, -- ID платежа в платёжной системе
  rejection_reason TEXT,
  -- Метаданные
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.payout_requests IS 'Запросы на выплаты кондитерам/поставщикам';
CREATE INDEX idx_payouts_user ON public.payout_requests(user_id);
CREATE INDEX idx_payouts_status ON public.payout_requests(status) WHERE status = 'pending';

-- ===== 5. Refunds =====
CREATE TABLE IF NOT EXISTS public.refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL, -- в копейках
  reason TEXT, -- customer_request|quality_issue|damaged|not_delivered|other
  status TEXT NOT NULL DEFAULT 'requested', -- requested|approved|processed|rejected
  initiated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  yookassa_refund_id TEXT,
  processed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.refunds IS 'Возвраты платежей';
CREATE INDEX idx_refunds_payment ON public.refunds(payment_id);
CREATE INDEX idx_refunds_order ON public.refunds(order_id);
CREATE INDEX idx_refunds_status ON public.refunds(status) WHERE status IN ('requested', 'approved');

-- ===== 6. Chat Message Reactions =====
CREATE TABLE IF NOT EXISTS public.chat_message_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (message_id, user_id, emoji)
);

COMMENT ON TABLE public.chat_message_reactions IS 'Реакции на сообщения в чате';
CREATE INDEX idx_chat_reactions_message ON public.chat_message_reactions(message_id);

-- ===== 7. RLS =====

-- cms_media: public read, authenticated write
ALTER TABLE public.cms_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cms_media_select_public" ON public.cms_media
  FOR SELECT USING (is_public = TRUE OR uploaded_by = auth.uid());
CREATE POLICY "cms_media_insert_auth" ON public.cms_media
  FOR INSERT WITH CHECK (uploaded_by = auth.uid());
CREATE POLICY "cms_media_update_own" ON public.cms_media
  FOR UPDATE USING (uploaded_by = auth.uid() OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active));
CREATE POLICY "cms_media_delete_own" ON public.cms_media
  FOR DELETE USING (uploaded_by = auth.uid() OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active));

-- cms_page_history: admin/copywriter
ALTER TABLE public.cms_page_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cms_page_history_select_admin" ON public.cms_page_history
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN','COPYWRITER') AND ur.is_active)
  );
CREATE POLICY "cms_page_history_insert_admin" ON public.cms_page_history
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN','COPYWRITER') AND ur.is_active)
  );

-- design_settings: public read, admin write
ALTER TABLE public.design_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "design_settings_select_public" ON public.design_settings
  FOR SELECT USING (TRUE);
CREATE POLICY "design_settings_write_admin" ON public.design_settings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );

-- payout_requests: owner + admin
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payouts_select_own_or_admin" ON public.payout_requests
  FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN','INSPECTOR') AND ur.is_active)
  );
CREATE POLICY "payouts_insert_own" ON public.payout_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "payouts_update_admin" ON public.payout_requests
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN','INSPECTOR') AND ur.is_active)
  );

-- refunds: order participants + admin
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "refunds_select_participants" ON public.refunds
  FOR SELECT USING (
    initiated_by = auth.uid() OR
    EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND (
      o.user_id = auth.uid() OR o.confectioner_id = auth.uid()
    )) OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN','INSPECTOR') AND ur.is_active)
  );
CREATE POLICY "refunds_insert_own" ON public.refunds
  FOR INSERT WITH CHECK (initiated_by = auth.uid());
CREATE POLICY "refunds_update_admin" ON public.refunds
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );

-- chat_message_reactions: channel members
ALTER TABLE public.chat_message_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_reactions_select_member" ON public.chat_message_reactions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.chat_messages cm
            JOIN public.chat_channel_members ccm ON ccm.channel_id = cm.channel_id
            WHERE cm.id = message_id AND ccm.user_id = auth.uid())
  );
CREATE POLICY "chat_reactions_insert_own" ON public.chat_message_reactions
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "chat_reactions_delete_own" ON public.chat_message_reactions
  FOR DELETE USING (user_id = auth.uid());

-- ===== 8. Triggers =====
CREATE TRIGGER cms_media_updated_at
  BEFORE UPDATE ON public.cms_media
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER payout_requests_updated_at
  BEFORE UPDATE ON public.payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER refunds_updated_at
  BEFORE UPDATE ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER design_settings_updated_at
  BEFORE UPDATE ON public.design_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

-- Auto-save page version on update
CREATE OR REPLACE FUNCTION public.save_page_version()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.cms_page_history (page_id, content, version, changed_by)
  VALUES (OLD.id, OLD.content,
    COALESCE((SELECT MAX(version) FROM public.cms_page_history WHERE page_id = OLD.id), 0) + 1,
    auth.uid());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER cms_pages_save_version
  AFTER UPDATE OF content ON public.cms_pages
  FOR EACH ROW EXECUTE FUNCTION public.save_page_version();

-- ===== Permissions =====
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON
  public.cms_media, public.cms_page_history, public.design_settings,
  public.payout_requests, public.refunds, public.chat_message_reactions
TO authenticated;
