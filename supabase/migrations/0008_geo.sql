-- ====================================================================
-- 0008_geo.sql — Геоданные кондитеров (Модуль 5: Карта)
-- ====================================================================
-- Требует PostGIS extension для GEOMETRY типа.
-- Если PostGIS не установлен — можно использовать DECIMAL lat/lng вместо GEOMETRY.
-- ====================================================================

-- ===== 1. Confectioner Geo =====
CREATE TABLE IF NOT EXISTS public.confectioner_geo (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  confectioner_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Координаты (простые DECIMAL, без PostGIS)
  lat DECIMAL(10, 7),
  lng DECIMAL(10, 7),
  address TEXT,
  city TEXT,
  delivery_radius_km INTEGER DEFAULT 10,
  working_hours JSONB, -- {"mon": {"start": "09:00", "end": "21:00"}, ...}
  tasting_available BOOLEAN DEFAULT FALSE,
  tasting_price INTEGER DEFAULT 0,
  has_atelier BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.confectioner_geo IS 'Геоданные кондитеров для карты';
CREATE INDEX idx_confectioner_geo_lat_lng ON public.confectioner_geo(lat, lng) WHERE is_active = TRUE;
CREATE INDEX idx_confectioner_geo_city ON public.confectioner_geo(city) WHERE is_active = TRUE;

-- ===== 2. Ateliers (студии для мастер-классов) =====
CREATE TABLE IF NOT EXISTS public.ateliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  confectioner_geo_id UUID NOT NULL REFERENCES public.confectioner_geo(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  lat DECIMAL(10, 7),
  lng DECIMAL(10, 7),
  address TEXT,
  services TEXT[] DEFAULT '{}',
  photos TEXT[] DEFAULT '{}',
  working_hours JSONB,
  capacity INTEGER DEFAULT 10,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.ateliers IS 'Студии кондитеров для мастер-классов';
CREATE INDEX idx_ateliers_geo ON public.ateliers(confectioner_geo_id);
CREATE INDEX idx_ateliers_active ON public.ateliers(is_active) WHERE is_active = TRUE;

-- ===== 3. Tastings (дегустации) =====
CREATE TABLE IF NOT EXISTS public.tastings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  atelier_id UUID NOT NULL REFERENCES public.ateliers(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  max_participants INTEGER DEFAULT 10,
  current_participants INTEGER DEFAULT 0,
  price INTEGER DEFAULT 0,
  status TEXT DEFAULT 'scheduled', -- scheduled|full|completed|cancelled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.tastings IS 'Дегустации в ателье';
CREATE INDEX idx_tastings_atelier ON public.tastings(atelier_id);
CREATE INDEX idx_tastings_date ON public.tastings(date) WHERE status = 'scheduled';

-- ===== 4. Tasting Bookings =====
CREATE TABLE IF NOT EXISTS public.tasting_bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tasting_id UUID NOT NULL REFERENCES public.tastings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participants_count INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending', -- pending|confirmed|cancelled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tasting_id, user_id)
);

COMMENT ON TABLE public.tasting_bookings IS 'Бронирование дегустаций';
CREATE INDEX idx_tasting_bookings_tasting ON public.tasting_bookings(tasting_id);
CREATE INDEX idx_tasting_bookings_user ON public.tasting_bookings(user_id);

-- ===== 5. Delivery Zones =====
CREATE TABLE IF NOT EXISTS public.delivery_zones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  confectioner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- 'Центр Москвы' | 'СПб'
  cities TEXT[] DEFAULT '{}',
  delivery_price INTEGER DEFAULT 0,
  min_order_amount INTEGER DEFAULT 0,
  estimated_hours INTEGER DEFAULT 24,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.delivery_zones IS 'Зоны доставки кондитеров';
CREATE INDEX idx_delivery_zones_confectioner ON public.delivery_zones(confectioner_id);
CREATE INDEX idx_delivery_zones_active ON public.delivery_zones(is_active) WHERE is_active = TRUE;

-- ===== 6. RLS =====

-- confectioner_geo: public read active, confectioner write own
ALTER TABLE public.confectioner_geo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "confectioner_geo_select_public" ON public.confectioner_geo
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "confectioner_geo_write_own" ON public.confectioner_geo
  FOR ALL USING (
    confectioner_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );

-- ateliers: public read, confectioner write own
ALTER TABLE public.ateliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ateliers_select_public" ON public.ateliers
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "ateliers_write_owner" ON public.ateliers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.confectioner_geo cg
            WHERE cg.id = confectioner_geo_id AND cg.confectioner_id = auth.uid())
  );

-- tastings: public read, atelier owner write
ALTER TABLE public.tastings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tastings_select_public" ON public.tastings
  FOR SELECT USING (status IN ('scheduled', 'full'));
CREATE POLICY "tastings_write_owner" ON public.tastings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.ateliers a
            JOIN public.confectioner_geo cg ON a.confectioner_geo_id = cg.id
            WHERE a.id = atelier_id AND cg.confectioner_id = auth.uid())
  );

-- tasting_bookings: owner + atelier owner
ALTER TABLE public.tasting_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasting_bookings_select" ON public.tasting_bookings
  FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.tastings t
            JOIN public.ateliers a ON t.atelier_id = a.id
            JOIN public.confectioner_geo cg ON a.confectioner_geo_id = cg.id
            WHERE t.id = tasting_id AND cg.confectioner_id = auth.uid())
  );
CREATE POLICY "tasting_bookings_insert_own" ON public.tasting_bookings
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "tasting_bookings_update_own" ON public.tasting_bookings
  FOR UPDATE USING (user_id = auth.uid());

-- delivery_zones: public read, confectioner write
ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "delivery_zones_select_public" ON public.delivery_zones
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "delivery_zones_write_own" ON public.delivery_zones
  FOR ALL USING (
    confectioner_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );

-- ===== 7. Triggers =====
CREATE TRIGGER confectioner_geo_updated_at
  BEFORE UPDATE ON public.confectioner_geo
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER ateliers_updated_at
  BEFORE UPDATE ON public.ateliers
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER tastings_updated_at
  BEFORE UPDATE ON public.tastings
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

-- Auto-update tasting participants count
CREATE OR REPLACE FUNCTION public.update_tasting_participants()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.tastings SET
    current_participants = (
      SELECT COALESCE(SUM(participants_count), 0) FROM public.tasting_bookings
      WHERE tasting_id = NEW.tasting_id AND status IN ('pending', 'confirmed')
    ),
    status = CASE
      WHEN (SELECT COALESCE(SUM(participants_count), 0) FROM public.tasting_bookings
            WHERE tasting_id = NEW.tasting_id AND status IN ('pending', 'confirmed')) >= max_participants
      THEN 'full'
      ELSE 'scheduled'
    END
  WHERE id = NEW.tasting_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasting_bookings_update_count
  AFTER INSERT OR UPDATE OR DELETE ON public.tasting_bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_tasting_participants();

-- ===== Permissions =====
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON
  public.confectioner_geo, public.ateliers, public.tastings,
  public.tasting_bookings, public.delivery_zones
TO authenticated;
