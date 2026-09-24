-- =====================================================================
-- 0026_storage_buckets_and_confectioners_rls.sql
-- =====================================================================
-- Цели миграции:
--   1. Создать 5 storage buckets (avatars, covers, portfolio, product_images, documents)
--      с public/private политиками RLS для безопасной загрузки файлов.
--   2. Включить RLS на public.confectioners (migration 0017 создала таблицу без RLS)
--      с политикой: публичный SELECT только для verified=true, владелец может
--      INSERT/UPDATE/DELETE свою строку.
--   3. Создать индексы на slug/city/verified для быстрой выборки верифицированных.
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1. STORAGE BUCKETS
-- =====================================================================
-- 1.1. Создаём 5 buckets. public=true для тех, что отдаются через CDN.
--     private=true для документов и сообщений — доступ через signed URLs.

INSERT INTO storage.buckets (id, name, public, allowed_mime_types, created_at, updated_at)
VALUES
  ('avatars',       'avatars',       true,  ARRAY['image/jpeg','image/png','image/webp','image/gif'], now(), now()),
  ('covers',        'covers',        true,  ARRAY['image/jpeg','image/png','image/webp'],              now(), now()),
  ('portfolio',     'portfolio',     true,  ARRAY['image/jpeg','image/png','image/webp'],              now(), now()),
  ('product_images','product_images',true,  ARRAY['image/jpeg','image/png','image/webp','image/gif'], now(), now()),
  ('documents',     'documents',     false, ARRAY['application/pdf','image/jpeg','image/png'],         now(), now()),
  ('messages',      'messages',      false, ARRAY['image/jpeg','image/png','image/webp','video/mp4'], now(), now())
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      updated_at = now();

-- 1.2. Storage RLS policies — кто может читать/писать в каждый bucket.
--     Стратегия: avatars/covers/portfolio/product_images — public read, owner-write.
--     documents/messages — приватные, только owner.

-- avatars: любой может читать (нужно для отображения в карточках/марки).
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "avatars_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_write"  ON storage.objects;
DROP POLICY IF EXISTS "covers_owner_write"  ON storage.objects;
DROP POLICY IF EXISTS "portfolio_owner_write"   ON storage.objects;
DROP POLICY IF EXISTS "product_images_owner_write" ON storage.objects;
DROP POLICY IF EXISTS "documents_owner_all"  ON storage.objects;
DROP POLICY IF EXISTS "messages_owner_all"   ON storage.objects;

-- Публичное чтение всех public buckets (avatars/covers/portfolio/product_images).
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id IN ('avatars','covers','portfolio','product_images'));

-- Запись: только авторизованный пользователь, в папку с собственным user_id.
-- Путь формата: avatars/{userId}/photo.webp или avatars/{userId}-photo.webp.
-- (storage.foldername(name) возвращает первый сегмент пути.)
CREATE POLICY "avatars_owner_write" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND ((storage.foldername(name))[1] = auth.uid()::text  OR name LIKE auth.uid()::text || '%')
  );

CREATE POLICY "covers_owner_write" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'covers'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR name LIKE auth.uid()::text || '%')
  );

CREATE POLICY "portfolio_owner_write" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'portfolio'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR name LIKE auth.uid()::text || '%')
  );

CREATE POLICY "product_images_owner_write" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product_images'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR name LIKE auth.uid()::text || '%')
  );

-- UPDATE/DELETE — владелец может заменить/удалить свой файл.
CREATE POLICY "avatars_owner_update" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id IN ('avatars','covers','portfolio','product_images')
    AND ((storage.foldername(name))[1] = auth.uid()::text OR name LIKE auth.uid()::text || '%')
  );

CREATE POLICY "avatars_owner_delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id IN ('avatars','covers','portfolio','product_images')
    AND ((storage.foldername(name))[1] = auth.uid()::text OR name LIKE auth.uid()::text || '%')
  );

-- documents / messages: приватные, только владелец.
CREATE POLICY "documents_owner_all" ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR name LIKE auth.uid()::text || '%')
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR name LIKE auth.uid()::text || '%')
  );

CREATE POLICY "messages_owner_all" ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'messages'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR name LIKE auth.uid()::text || '%')
  )
  WITH CHECK (
    bucket_id = 'messages'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR name LIKE auth.uid()::text || '%')
  );

-- =====================================================================
-- 2. RLS на public.confectioners (migration 0017 создала таблицу без RLS)
-- =====================================================================

ALTER TABLE public.confectioners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.confectioners FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "confectioners_select_public" ON public.confectioners;
DROP POLICY IF EXISTS "confectioners_select_admin"  ON public.confectioners;
DROP POLICY IF EXISTS "confectioners_insert_own"    ON public.confectioners;
DROP POLICY IF EXISTS "confectioners_update_own"    ON public.confectioners;
DROP POLICY IF EXISTS "confectioners_delete_own"    ON public.confectioners;

-- Публичный SELECT: только верифицированные кондитеры видны всем (включая anon).
-- Это обеспечивает работу публичной бегущей строки, каталога, sitemap.
CREATE POLICY "confectioners_select_public" ON public.confectioners
  FOR SELECT
  USING (verified = true);

-- Админ видит все строки (включая pending/rejected).
-- Требуется, чтобы текущий пользователь имел роль ADMIN в public.user_roles.
CREATE POLICY "confectioners_select_admin" ON public.confectioners
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'ADMIN'
        AND ur.is_active = true
    )
  );

-- Создание строки кондитера: только аутентифицированный пользователь может
-- создать свою строку (userId = auth.uid()).
CREATE POLICY "confectioners_insert_own" ON public.confectioners
  FOR INSERT
  TO authenticated
  WITH CHECK ("userId" = auth.uid()::text);

-- Обновление: только владелец строки. Админ может обновлять через admin SDK.
CREATE POLICY "confectioners_update_own" ON public.confectioners
  FOR UPDATE
  TO authenticated
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);

-- Удаление: только владелец.
CREATE POLICY "confectioners_delete_own" ON public.confectioners
  FOR DELETE
  TO authenticated
  USING ("userId" = auth.uid()::text);

-- =====================================================================
-- 3. Индексы для производительности публичных запросов
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_confectioners_verified_rating
  ON public.confectioners(verified, rating DESC)
  WHERE verified = true;

CREATE INDEX IF NOT EXISTS idx_confectioners_city_verified
  ON public.confectioners(city, verified)
  WHERE verified = true;

CREATE INDEX IF NOT EXISTS idx_confectioners_slug_verified
  ON public.confectioners(slug, verified)
  WHERE verified = true;

-- =====================================================================
-- 4. Триггер на автоматическое обновление updatedAt
-- =====================================================================

-- Функция уже может существовать — используем OR REPLACE.
CREATE OR REPLACE FUNCTION public.set_confectioners_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;  -- колонка camelCase (0017), нужен quoted-доступ
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_confectioners_updated_at ON public.confectioners;
CREATE TRIGGER trg_confectioners_updated_at
  BEFORE UPDATE ON public.confectioners
  FOR EACH ROW EXECUTE FUNCTION public.set_confectioners_updated_at();

COMMIT;

-- =====================================================================
-- 5. GRANTS (на случай, если migration 0025 их не установила)
-- =====================================================================

GRANT SELECT ON public.confectioners TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.confectioners TO authenticated;

COMMENT ON TABLE public.confectioners IS
  'Верифицированные кондитеры (RLS: публичный SELECT для verified=true, владелец может INSERT/UPDATE/DELETE свою строку, админ видит все)';
