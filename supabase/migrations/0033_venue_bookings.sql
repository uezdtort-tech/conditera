-- 0033_venue_bookings.sql
-- ============================================================================
-- Реальная система бронирования площадок (замена audit_log-заглушки).
-- Жизненный цикл: pending → confirmed | rejected → cancelled (клиентом) /
-- completed (после мероприятия). Депозит — ручной/через YooKassa в будущем.
-- Соглашение: snake_case (как venues из 0008/0011), FK на auth.users.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.venue_bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_date      DATE NOT NULL,
  start_time      TEXT,                              -- 'HH:MM', null = целый день
  end_time        TEXT,                              -- 'HH:MM'
  hours           INTEGER,                           -- расчётное кол-во часов (снапшот)
  guests          INTEGER,
  contact_name    TEXT,
  contact_phone   TEXT,
  message         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','rejected','cancelled','completed')),
  price_snapshot  INTEGER,                           -- price_per_hour на момент брони
  deposit_amount  INTEGER NOT NULL DEFAULT 0,
  deposit_paid    BOOLEAN NOT NULL DEFAULT false,
  owner_reply     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venue_bookings_venue      ON public.venue_bookings(venue_id);
CREATE INDEX IF NOT EXISTS idx_venue_bookings_user       ON public.venue_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_venue_bookings_status     ON public.venue_bookings(status);
CREATE INDEX IF NOT EXISTS idx_venue_bookings_event_date ON public.venue_bookings(event_date);
CREATE INDEX IF NOT EXISTS idx_venue_bookings_venue_status ON public.venue_bookings(venue_id, status);

-- ===== updated_at trigger =====
CREATE OR REPLACE FUNCTION public.update_venue_bookings_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_venue_bookings_updated ON public.venue_bookings;
CREATE TRIGGER trg_venue_bookings_updated
  BEFORE UPDATE ON public.venue_bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_venue_bookings_updated_at();

-- ===== RLS =====
ALTER TABLE public.venue_bookings ENABLE ROW LEVEL SECURITY;

-- создающий видит свои брони; владелец площадки — брони своих площадок; staff — все
DROP POLICY IF EXISTS venue_bookings_select_own_or_owner ON public.venue_bookings;
CREATE POLICY venue_bookings_select_own_or_owner
  ON public.venue_bookings FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id = venue_id AND v.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN','SUPER_ADMIN','MODERATOR','SUPPORT')
        AND ur.is_active = true
    )
  );

-- аутентифицированный может создать бронь только от своего имени
DROP POLICY IF EXISTS venue_bookings_insert_own ON public.venue_bookings;
CREATE POLICY venue_bookings_insert_own
  ON public.venue_bookings FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- владелец площадки управляет статусом; клиент может отменить свою бронь
DROP POLICY IF EXISTS venue_bookings_update_own_or_owner ON public.venue_bookings;
CREATE POLICY venue_bookings_update_own_or_owner
  ON public.venue_bookings FOR UPDATE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id = venue_id AND v.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN','SUPER_ADMIN')
        AND ur.is_active = true
    )
  );

DROP POLICY IF EXISTS venue_bookings_delete_own ON public.venue_bookings;
CREATE POLICY venue_bookings_delete_own
  ON public.venue_bookings FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN','SUPER_ADMIN')
        AND ur.is_active = true
    )
  );

-- ===== grants (PostgREST) =====
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_bookings TO anon, authenticated, service_role;

-- PostgREST: перечитать схему
NOTIFY pgrst, 'reload schema';
