-- ============================================================================
-- 0027_confectioner_identity_unification.sql
--
-- ЗАДАЧА 13 (v3 ТЗ): schema audit split-brain FK.
--
-- Проблема: confectioner identity моделировалась двумя способами:
--   A) migration 0006/0007/0008: confectioner_id UUID REFERENCES auth.users(id)
--   B) migration 0017: public.confectioners (id TEXT PK, userId TEXT) — Prisma-совместимая
-- Результат: две «правды» о том, КТО такой кондитер. Join'ы между моделями
-- невозможны без кастов, RLS-политики смешивают uuid = text.
--
-- РЕШЕНИЕ (рекомендация ТЗ): 0017 — источник правды. Таблицы из 0006/0007/0008
-- переводятся на confectioner_id TEXT REFERENCES public.confectioners(id).
--
-- В СКОПЕ (5 таблиц):
--   favorite_confectioners, tender_offers, tender_invitations,
--   confectioner_geo, delivery_zones
--
-- ВНЕ СКОПА (остаются FK → auth.users как ссылки на ПОЛЬЗОВАТЕЛЯ, не на
-- бизнес-профиль кондитера — унификация возможна отдельной миграцией):
--   orders, products, negotiations, payouts, split_payments, lessons,
--   franchise_points, cakes-таблицы 0004.
--
-- Idempotent: повторный запуск безопасен.
-- Data-safe: FK добавляется только если нет «осиротевших» строк; иначе
--             колонка остаётся TEXT без FK и пишется WARNING.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Удаление старых FK → auth.users (ДО смены типа: иначе ALTER TYPE
--    пытается пересобрать uuid-FK как text против uuid — "cannot be implemented")
-- ---------------------------------------------------------------------------
ALTER TABLE public.favorite_confectioners DROP CONSTRAINT IF EXISTS favorite_confectioners_confectioner_id_fkey;
ALTER TABLE public.tender_offers          DROP CONSTRAINT IF EXISTS tender_offers_confectioner_id_fkey;
ALTER TABLE public.tender_invitations     DROP CONSTRAINT IF EXISTS tender_invitations_confectioner_id_fkey;
ALTER TABLE public.confectioner_geo       DROP CONSTRAINT IF EXISTS confectioner_geo_confectioner_id_fkey;
ALTER TABLE public.delivery_zones         DROP CONSTRAINT IF EXISTS delivery_zones_confectioner_id_fkey;

-- Политики, сравнивающие confectioner_id, БЛОКИРУЮТ смену типа
-- ("cannot alter type of a column used in a policy definition") — сносим,
-- пересоздадим с ::text-кастами в разделе 4.
DROP POLICY IF EXISTS "tender_offers_select_participants" ON public.tender_offers;
DROP POLICY IF EXISTS "tender_offers_insert_confectioner" ON public.tender_offers;
DROP POLICY IF EXISTS "tender_offers_update_own" ON public.tender_offers;
DROP POLICY IF EXISTS "tender_invitations_select" ON public.tender_invitations;
DROP POLICY IF EXISTS "tender_invitations_update_own" ON public.tender_invitations;
DROP POLICY IF EXISTS "confectioner_geo_write_own" ON public.confectioner_geo;
DROP POLICY IF EXISTS "delivery_zones_write_own" ON public.delivery_zones;
DROP POLICY IF EXISTS "tender_reviews_insert" ON public.tender_reviews;
DROP POLICY IF EXISTS "tender_reviews_insert_participant" ON public.tender_reviews;
DROP POLICY IF EXISTS "ateliers_write_owner" ON public.ateliers;
DROP POLICY IF EXISTS "tastings_write_owner" ON public.tastings;
DROP POLICY IF EXISTS "tasting_bookings_select" ON public.tasting_bookings;

-- ---------------------------------------------------------------------------
-- 2. Конвертация колонок UUID → TEXT
--    (ALTER TYPE пересоздаёт зависимые индексы/UNIQUE автоматически)
-- ---------------------------------------------------------------------------
ALTER TABLE public.favorite_confectioners
  ALTER COLUMN confectioner_id TYPE TEXT USING confectioner_id::text;
ALTER TABLE public.tender_offers
  ALTER COLUMN confectioner_id TYPE TEXT USING confectioner_id::text;
ALTER TABLE public.tender_invitations
  ALTER COLUMN confectioner_id TYPE TEXT USING confectioner_id::text;
ALTER TABLE public.confectioner_geo
  ALTER COLUMN confectioner_id TYPE TEXT USING confectioner_id::text;
ALTER TABLE public.delivery_zones
  ALTER COLUMN confectioner_id TYPE TEXT USING confectioner_id::text;

-- ---------------------------------------------------------------------------
-- 3. Перенос FK: auth.users → public.confectioners (orphan-safe)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_orphans INTEGER;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('favorite_confectioners', 'favorite_confectioners_confectioner_id_fkey', 'CASCADE'),
      ('tender_offers',          'tender_offers_confectioner_id_fkey',          'CASCADE'),
      ('tender_invitations',     'tender_invitations_confectioner_id_fkey',     'CASCADE'),
      ('confectioner_geo',       'confectioner_geo_confectioner_id_fkey',       'CASCADE'),
      ('delivery_zones',         'delivery_zones_confectioner_id_fkey',         'CASCADE')
    ) AS t(tbl, conname, on_delete)
  LOOP
    -- Orphan-проверка: ссылки на confectioners.id, которых нет в бизнес-профиле
    EXECUTE format(
      'SELECT COUNT(*) FROM public.%I t LEFT JOIN public.confectioners c ON t.confectioner_id = c.id WHERE c.id IS NULL',
      r.tbl
    ) INTO v_orphans;

    IF v_orphans = 0 THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (confectioner_id) REFERENCES public.confectioners(id) ON DELETE %s',
        r.tbl, r.conname, r.on_delete
      );
      RAISE NOTICE '0027: FK % добавлен', r.conname;
    ELSE
      RAISE WARNING '0027: таблица % содержит % строк с confectioner_id вне confectioners.id — FK НЕ добавлен (см. ТЗ задача 13)', r.tbl, v_orphans;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Пересоздание RLS-политик: сравнения confectioner_id = auth.uid()
--    становятся confectioner_id = auth.uid()::text (колонка теперь TEXT)
-- ---------------------------------------------------------------------------

-- ── tender_offers ──
CREATE POLICY "tender_offers_select_participants" ON public.tender_offers
  FOR SELECT USING (
    confectioner_id = auth.uid()::text OR
    EXISTS (SELECT 1 FROM public.tenders t WHERE t.id = tender_id AND t.customer_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );

CREATE POLICY "tender_offers_insert_confectioner" ON public.tender_offers
  FOR INSERT WITH CHECK (
    confectioner_id = auth.uid()::text AND
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('CONFECTIONER','ADMIN') AND ur.is_active)
  );

CREATE POLICY "tender_offers_update_own" ON public.tender_offers
  FOR UPDATE USING (
    confectioner_id = auth.uid()::text OR
    EXISTS (SELECT 1 FROM public.tenders t WHERE t.id = tender_id AND t.customer_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );

-- ── tender_invitations ──
CREATE POLICY "tender_invitations_select" ON public.tender_invitations
  FOR SELECT USING (
    confectioner_id = auth.uid()::text OR
    EXISTS (SELECT 1 FROM public.tenders t WHERE t.id = tender_id AND t.customer_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );

CREATE POLICY "tender_invitations_update_own" ON public.tender_invitations
  FOR UPDATE USING (confectioner_id = auth.uid()::text);

-- ── tender_reviews (вложенный EXISTS по tender_offers.confectioner_id) ──
CREATE POLICY "tender_reviews_insert" ON public.tender_reviews
  FOR INSERT WITH CHECK (
    reviewer_id = auth.uid() AND
    EXISTS (SELECT 1 FROM public.tenders t WHERE t.id = tender_id AND (
      t.customer_id = auth.uid() OR
      EXISTS (SELECT 1 FROM public.tender_offers tor WHERE tor.tender_id = tender_id AND tor.confectioner_id = auth.uid()::text)
    ))
  );

-- ── confectioner_geo ──
CREATE POLICY "confectioner_geo_write_own" ON public.confectioner_geo
  FOR ALL USING (
    confectioner_id = auth.uid()::text OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );

-- ── ateliers (EXISTS по confectioner_geo.confectioner_id) ──
CREATE POLICY "ateliers_write_owner" ON public.ateliers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.confectioner_geo cg
            WHERE cg.id = confectioner_geo_id AND cg.confectioner_id = auth.uid()::text)
  );

-- ── tastings ──
CREATE POLICY "tastings_write_owner" ON public.tastings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.ateliers a
            JOIN public.confectioner_geo cg ON a.confectioner_geo_id = cg.id
            WHERE a.id = atelier_id AND cg.confectioner_id = auth.uid()::text)
  );

-- ── tasting_bookings (SELECT-политика ссылается на cg.confectioner_id) ──
CREATE POLICY "tasting_bookings_select" ON public.tasting_bookings
  FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.tastings t
            JOIN public.ateliers a ON t.atelier_id = a.id
            JOIN public.confectioner_geo cg ON a.confectioner_geo_id = cg.id
            WHERE t.id = tasting_id AND cg.confectioner_id = auth.uid()::text)
  );

-- ── delivery_zones ──
CREATE POLICY "delivery_zones_write_own" ON public.delivery_zones
  FOR ALL USING (
    confectioner_id = auth.uid()::text OR
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );

-- ---------------------------------------------------------------------------
-- 5. Комментарий-документация
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.favorite_confectioners.confectioner_id IS
  'Confectioner identity: TEXT → public.confectioners(id) (0027, унификация с 0017)';
COMMENT ON COLUMN public.confectioner_geo.confectioner_id IS
  'Confectioner identity: TEXT → public.confectioners(id) (0027, унификация с 0017)';

COMMIT;

-- ---------------------------------------------------------------------------
-- 6. Верификация: типы колонок и FK-цели
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_uuid_left INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_uuid_left
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND column_name = 'confectioner_id'
    AND table_name IN ('favorite_confectioners','tender_offers','tender_invitations','confectioner_geo','delivery_zones')
    AND udt_name <> 'text';

  IF v_uuid_left > 0 THEN
    RAISE EXCEPTION '0027: % колонок не конвертированы в TEXT', v_uuid_left;
  END IF;
  RAISE NOTICE '0027: OK — confectioner identity унифицирована (5 таблиц)';
END $$;
