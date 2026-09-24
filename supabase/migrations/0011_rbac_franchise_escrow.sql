-- ====================================================================
-- 0011_rbac_franchise_escrow.sql — RBAC, Franchise, Split Payment, Escrow
-- ====================================================================

-- ===== 1. Permissions (RBAC) =====
CREATE TABLE IF NOT EXISTS public.permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  module TEXT NOT NULL, -- catalog|orders|finance|users|content|delivery|suppliers|services|franchise|analytics|notifications|messaging
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 2. Role Permissions =====
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role TEXT NOT NULL, -- UserRole enum value
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (role, permission_id)
);

CREATE INDEX idx_role_permissions_role ON public.role_permissions(role);

-- ===== 3. Escrow Accounts =====
CREATE TABLE IF NOT EXISTS public.escrow_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  held_amount INTEGER NOT NULL, -- в копейках
  confectioner_amount INTEGER NOT NULL DEFAULT 0,
  platform_amount INTEGER NOT NULL DEFAULT 0,
  courier_amount INTEGER NOT NULL DEFAULT 0,
  partner_amount INTEGER DEFAULT 0, -- для партнёров (платщадки, аниматоры)
  commission_rate DECIMAL(4,2) DEFAULT 10.00, -- % комиссии платформы
  status TEXT NOT NULL DEFAULT 'held', -- held|released|refunded
  held_at TIMESTAMPTZ DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  release_scheduled_at TIMESTAMPTZ, -- +7 дней после доставки
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_escrow_order ON public.escrow_accounts(order_id);
CREATE INDEX idx_escrow_status ON public.escrow_accounts(status) WHERE status = 'held';

-- ===== 4. Split Payments (детализация сплитования) =====
CREATE TABLE IF NOT EXISTS public.split_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  -- Получатели
  confectioner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  courier_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  partner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Суммы (в копейках)
  total_amount INTEGER NOT NULL,
  confectioner_amount INTEGER NOT NULL DEFAULT 0,
  platform_amount INTEGER NOT NULL DEFAULT 0,
  courier_amount INTEGER DEFAULT 0,
  partner_amount INTEGER DEFAULT 0,
  -- Комиссии
  commission_rate DECIMAL(4,2) DEFAULT 10.00,
  -- Статус
  status TEXT NOT NULL DEFAULT 'pending', -- pending|processed|failed
  processed_at TIMESTAMPTZ,
  -- Metadata
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_split_payment_order ON public.split_payments(order_id);
CREATE INDEX idx_split_payment_confectioner ON public.split_payments(confectioner_id);

-- ===== 5. Franchise Networks =====
CREATE TABLE IF NOT EXISTS public.franchise_networks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  franchiser_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  region TEXT,
  description TEXT,
  -- Финансы
  royalty_rate DECIMAL(4,2) DEFAULT 5.00, -- % роялти с продаж сети
  monthly_fee INTEGER DEFAULT 0, -- паушальный взнос (копейки)
  -- Статус
  is_active BOOLEAN DEFAULT TRUE,
  contract_start DATE,
  contract_end DATE,
  -- Метрики
  total_confectioners INTEGER DEFAULT 0,
  total_sales INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_franchise_networks_franchiser ON public.franchise_networks(franchiser_id);

-- ===== 6. Franchise Points =====
CREATE TABLE IF NOT EXISTS public.franchise_points (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  network_id UUID NOT NULL REFERENCES public.franchise_networks(id) ON DELETE CASCADE,
  confectioner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending', -- pending|active|suspended|left
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  UNIQUE (network_id, confectioner_id)
);

CREATE INDEX idx_franchise_points_network ON public.franchise_points(network_id);

-- ===== 7. Royalty Payments =====
CREATE TABLE IF NOT EXISTS public.royalty_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  network_id UUID NOT NULL REFERENCES public.franchise_networks(id) ON DELETE CASCADE,
  period_month DATE NOT NULL, -- первый день месяца
  total_sales INTEGER NOT NULL DEFAULT 0, -- общая выручка сети за месяц (копейки)
  royalty_rate DECIMAL(4,2) NOT NULL,
  royalty_amount INTEGER NOT NULL DEFAULT 0, -- роялти к выплате (копейки)
  status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|paid
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_royalty_network ON public.royalty_payments(network_id);
CREATE INDEX idx_royalty_period ON public.royalty_payments(period_month);

-- ===== 8. Analytics Materialized Views =====
CREATE MATERIALIZED VIEW IF NOT EXISTS public.analytics_sales_by_day AS
SELECT
  DATE(o.created_at) AS sale_date,
  COUNT(*) AS order_count,
  SUM(o.total) AS total_revenue,
  AVG(o.total) AS avg_order_value,
  COUNT(DISTINCT o.user_id) AS unique_customers,
  COUNT(DISTINCT o.confectioner_id) AS unique_confectioners
FROM public.orders o
WHERE o.status IN ('COMPLETED', 'DELIVERED')
GROUP BY DATE(o.created_at)
WITH DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.analytics_top_confectioners AS
SELECT
  o.confectioner_id,
  COUNT(*) AS order_count,
  SUM(o.total) AS total_revenue,
  AVG(o.total) AS avg_order_value
FROM public.orders o
WHERE o.status = 'COMPLETED' AND o.confectioner_id IS NOT NULL
GROUP BY o.confectioner_id
WITH DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.analytics_popular_fillings AS
SELECT
  f.name AS filling_name,
  f.flavor_group,
  COUNT(cbd.filling) AS selection_count
FROM public.cake_builder_drafts cbd
JOIN public.fillings f ON f.name = cbd.filling
WHERE cbd.filling IS NOT NULL
GROUP BY f.name, f.flavor_group
WITH DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.analytics_delivery_performance AS
SELECT
  d.courier_id,
  COUNT(*) AS total_deliveries,
  AVG(EXTRACT(EPOCH FROM (d.delivered_at - d.created_at))/3600) AS avg_delivery_hours,
  COUNT(*) FILTER (WHERE d.status = 'failed') AS failed_count
FROM public.deliveries d
WHERE d.status = 'delivered' OR d.status = 'failed'
GROUP BY d.courier_id
WITH DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.analytics_financial_summary AS
SELECT
  DATE_TRUNC('month', p.created_at) AS month,
  SUM(p.amount) AS total_payments,
  SUM(p.amount) FILTER (WHERE p.status = 'succeeded') AS successful_payments,
  SUM(p.amount) FILTER (WHERE p.status = 'refunded') AS refunded_amount,
  COUNT(*) FILTER (WHERE p.status = 'succeeded') AS successful_count
FROM public.payments p
GROUP BY DATE_TRUNC('month', p.created_at)
WITH DATA;

-- ===== 9. System Configs =====
CREATE TABLE IF NOT EXISTS public.configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'general',
  is_public BOOLEAN DEFAULT TRUE,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 10. RLS =====

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "permissions_select_public" ON public.permissions FOR SELECT USING (TRUE);
CREATE POLICY "permissions_write_admin" ON public.permissions FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role_perms_select_public" ON public.role_permissions FOR SELECT USING (TRUE);
CREATE POLICY "role_perms_write_admin" ON public.role_permissions FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
);

ALTER TABLE public.escrow_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "escrow_select_participants" ON public.escrow_accounts FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND (
    o.user_id = auth.uid() OR o.confectioner_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN','INSPECTOR') AND ur.is_active)
  ))
);
CREATE POLICY "escrow_write_admin" ON public.escrow_accounts FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN','ADMIN') AND ur.is_active)
);

ALTER TABLE public.split_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "split_select_participants" ON public.split_payments FOR SELECT USING (
  confectioner_id = auth.uid() OR courier_id = auth.uid() OR partner_id = auth.uid() OR
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN','INSPECTOR') AND ur.is_active)
);
CREATE POLICY "split_write_admin" ON public.split_payments FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN','ADMIN') AND ur.is_active)
);

ALTER TABLE public.franchise_networks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "franchise_select_own_or_admin" ON public.franchise_networks FOR SELECT USING (
  franchiser_id = auth.uid() OR
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
);
CREATE POLICY "franchise_write_own_or_admin" ON public.franchise_networks FOR ALL USING (
  franchiser_id = auth.uid() OR
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
);

ALTER TABLE public.franchise_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "franchise_points_select" ON public.franchise_points FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.franchise_networks fn WHERE fn.id = network_id AND fn.franchiser_id = auth.uid()) OR
  confectioner_id = auth.uid() OR
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
);

ALTER TABLE public.royalty_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "royalty_select" ON public.royalty_payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.franchise_networks fn WHERE fn.id = network_id AND fn.franchiser_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN','INSPECTOR') AND ur.is_active)
);

ALTER TABLE public.configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "configs_select_public" ON public.configs FOR SELECT USING (is_public = TRUE);
CREATE POLICY "configs_write_admin" ON public.configs FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
);

-- ===== 11. Triggers =====
CREATE TRIGGER escrow_updated_at BEFORE UPDATE ON public.escrow_accounts FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();
CREATE TRIGGER split_updated_at BEFORE UPDATE ON public.split_payments FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();
CREATE TRIGGER franchise_networks_updated_at BEFORE UPDATE ON public.franchise_networks FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();
CREATE TRIGGER royalty_updated_at BEFORE UPDATE ON public.royalty_payments FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();
CREATE TRIGGER configs_updated_at BEFORE UPDATE ON public.configs FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

-- ===== 12. Escrow Release Function =====
CREATE OR REPLACE FUNCTION public.release_escrow_after_delivery()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'DELIVERED' AND OLD.status != 'DELIVERED' THEN
    UPDATE public.escrow_accounts SET
      release_scheduled_at = NOW() + INTERVAL '7 days'
    WHERE order_id = NEW.id AND status = 'held';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER orders_release_escrow
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.release_escrow_after_delivery();

-- ===== 13. Auto-assign Confectioner Function =====
CREATE OR REPLACE FUNCTION public.auto_assign_confectioner(
  p_order_id UUID,
  p_city TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_confectioner_id UUID;
BEGIN
  SELECT c.id INTO v_confectioner_id
  FROM public.products p
  JOIN public.order_items oi ON oi.product_id = p.id
  WHERE oi.order_id = p_order_id
  LIMIT 1;

  IF v_confectioner_id IS NOT NULL THEN
    UPDATE public.orders SET confectioner_id = v_confectioner_id, status = 'CONFIRMED'
    WHERE id = p_order_id;
  END IF;

  RETURN v_confectioner_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ===== Permissions =====
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON
  public.escrow_accounts, public.split_payments,
  public.franchise_networks, public.franchise_points, public.royalty_payments,
  public.configs, public.permissions, public.role_permissions
TO authenticated;
