-- ====================================================================
-- 0007_tenders.sql — Тендерная площадка (Модуль 4)
-- ====================================================================

-- ===== 1. Tenders =====
CREATE TABLE IF NOT EXISTS public.tenders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT, -- 'wedding' | 'birthday' | 'corporate' | ...
  required_servings INTEGER,
  budget_min INTEGER, -- в копейках
  budget_max INTEGER,
  required_city TEXT,
  required_delivery_date DATE,
  end_date TIMESTAMPTZ NOT NULL, -- дедлайн подачи
  specifications JSONB, -- детальные требования
  status TEXT NOT NULL DEFAULT 'active', -- active|awarded|closed|cancelled
  is_public BOOLEAN DEFAULT TRUE,
  is_urgent BOOLEAN DEFAULT FALSE,
  chat_channel_id UUID, -- FK на chat_channels
  -- Метрики
  offers_count INTEGER DEFAULT 0,
  views_count INTEGER DEFAULT 0,
  -- Timestamps
  awarded_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.tenders IS 'Тендеры на кондитерские изделия';
CREATE INDEX idx_tenders_customer ON public.tenders(customer_id);
CREATE INDEX idx_tenders_status ON public.tenders(status) WHERE status = 'active';
CREATE INDEX idx_tenders_city ON public.tenders(required_city) WHERE status = 'active';
CREATE INDEX idx_tenders_end_date ON public.tenders(end_date) WHERE status = 'active';

-- ===== 2. Tender Offers =====
CREATE TABLE IF NOT EXISTS public.tender_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES public.tenders(id) ON DELETE CASCADE,
  confectioner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offer_price INTEGER NOT NULL, -- в копейках
  offer_description TEXT,
  proposed_delivery_date DATE,
  proposed_items JSONB, -- что входит в предложение
  status TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|rejected|withdrawn
  is_winner BOOLEAN DEFAULT FALSE,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tender_id, confectioner_id)
);

COMMENT ON TABLE public.tender_offers IS 'Предложения кондитеров на тендеры';
CREATE INDEX idx_tender_offers_tender ON public.tender_offers(tender_id);
CREATE INDEX idx_tender_offers_confectioner ON public.tender_offers(confectioner_id);
CREATE INDEX idx_tender_offers_winner ON public.tender_offers(tender_id) WHERE is_winner = TRUE;

-- ===== 3. Tender Invitations (закрытые тендеры) =====
CREATE TABLE IF NOT EXISTS public.tender_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES public.tenders(id) ON DELETE CASCADE,
  confectioner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending', -- pending|accepted|declined
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  UNIQUE (tender_id, confectioner_id)
);

COMMENT ON TABLE public.tender_invitations IS 'Приглашения на закрытые тендеры';
CREATE INDEX idx_tender_invitations_tender ON public.tender_invitations(tender_id);
CREATE INDEX idx_tender_invitations_confectioner ON public.tender_invitations(confectioner_id);

-- ===== 4. Tender Reviews =====
CREATE TABLE IF NOT EXISTS public.tender_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES public.tenders(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tender_id, reviewer_id, target_user_id)
);

COMMENT ON TABLE public.tender_reviews IS 'Отзывы по тендерам';
CREATE INDEX idx_tender_reviews_tender ON public.tender_reviews(tender_id);

-- ===== 5. RLS =====

-- tenders: public read active, customer write own
ALTER TABLE public.tenders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenders_select_public" ON public.tenders
  FOR SELECT USING (
    is_public = TRUE OR customer_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );
CREATE POLICY "tenders_insert_own" ON public.tenders
  FOR INSERT WITH CHECK (
    auth.uid() = customer_id AND
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('CUSTOMER','CORPORATE_CLIENT','ADMIN') AND ur.is_active)
  );
CREATE POLICY "tenders_update_own" ON public.tenders
  FOR UPDATE USING (
    customer_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );

-- tender_offers: tender participants + confectioner
ALTER TABLE public.tender_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tender_offers_select_participants" ON public.tender_offers
  FOR SELECT USING (
    confectioner_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.tenders t WHERE t.id = tender_id AND t.customer_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );
CREATE POLICY "tender_offers_insert_confectioner" ON public.tender_offers
  FOR INSERT WITH CHECK (
    confectioner_id = auth.uid() AND
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('CONFECTIONER','ADMIN') AND ur.is_active)
  );
CREATE POLICY "tender_offers_update_own" ON public.tender_offers
  FOR UPDATE USING (
    confectioner_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.tenders t WHERE t.id = tender_id AND t.customer_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );

-- tender_invitations: invited confectioner + tender owner
ALTER TABLE public.tender_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tender_invitations_select" ON public.tender_invitations
  FOR SELECT USING (
    confectioner_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.tenders t WHERE t.id = tender_id AND t.customer_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );
CREATE POLICY "tender_invitations_update_own" ON public.tender_invitations
  FOR UPDATE USING (confectioner_id = auth.uid());

-- tender_reviews: all participants
ALTER TABLE public.tender_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tender_reviews_select" ON public.tender_reviews
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tenders t WHERE t.id = tender_id AND (
      t.customer_id = auth.uid() OR t.is_public = TRUE
    )) OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );
CREATE POLICY "tender_reviews_insert_participant" ON public.tender_reviews
  FOR INSERT WITH CHECK (
    reviewer_id = auth.uid() AND
    EXISTS (SELECT 1 FROM public.tenders t WHERE t.id = tender_id AND (
      t.customer_id = auth.uid() OR
      EXISTS (SELECT 1 FROM public.tender_offers to WHERE to.tender_id = tender_id AND to.confectioner_id = auth.uid())
    ))
  );

-- ===== 6. Triggers =====
CREATE TRIGGER tenders_updated_at
  BEFORE UPDATE ON public.tenders
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER tender_offers_updated_at
  BEFORE UPDATE ON public.tender_offers
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

-- Auto-update offers_count
CREATE OR REPLACE FUNCTION public.update_tender_offers_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.tenders SET
    offers_count = (SELECT COUNT(*) FROM public.tender_offers WHERE tender_id = NEW.tender_id)
  WHERE id = NEW.tender_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tender_offers_update_count
  AFTER INSERT OR DELETE ON public.tender_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_tender_offers_count();

-- Auto-close expired tenders (cleanup)
CREATE OR REPLACE FUNCTION public.close_expired_tenders()
RETURNS VOID AS $$
BEGIN
  UPDATE public.tenders
  SET status = 'closed', closed_at = NOW()
  WHERE status = 'active' AND end_date < NOW();
END;
$$ LANGUAGE plpgsql;

-- ===== Permissions =====
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON
  public.tenders, public.tender_offers, public.tender_invitations, public.tender_reviews
TO authenticated;
