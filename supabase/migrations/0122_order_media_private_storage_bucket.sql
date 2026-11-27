-- 0122_order_media_private_storage_bucket.sql
-- Приватный Supabase Storage bucket для оригинальных фото готовых заказов.
-- Доступ только через серверный API: он проверяет владельца заказа и назначенного участника.
-- service_role загружает файлы и выдаёт короткоживущие signed URLs; публичный доступ запрещён.

BEGIN;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  allowed_mime_types,
  created_at,
  updated_at
)
VALUES (
  'order_media',
  'order_media',
  false,
  ARRAY['image/jpeg', 'image/png', 'image/webp'],
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  updated_at = now();

COMMIT;
