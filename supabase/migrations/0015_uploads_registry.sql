-- 0015_uploads_registry.sql
-- Реестр загруженных файлов — отслеживает все загруженные изображения.
-- Файлы хранятся в public/uploads/{category}/, а метаданные — в этой таблице.

CREATE TABLE IF NOT EXISTS public.uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  original_name TEXT,
  url TEXT NOT NULL,
  thumb_url TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  original_size_bytes BIGINT,
  category TEXT NOT NULL DEFAULT 'temp',
  uploaded_by TEXT,
  has_watermark BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_uploads_url ON public.uploads(url);
CREATE INDEX IF NOT EXISTS idx_uploads_category ON public.uploads(category);
CREATE INDEX IF NOT EXISTS idx_uploads_uploaded_by ON public.uploads(uploaded_by);

COMMENT ON TABLE public.uploads IS 'Реестр загруженных файлов (изображения, документы)';

ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;

-- Публичное чтение (URL нужны всем для отображения)
CREATE POLICY "uploads_read_all" ON public.uploads FOR SELECT USING (true);

-- Запись — только аутентифицированные пользователи
CREATE POLICY "uploads_insert_auth" ON public.uploads FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Удаление — владелец или админ
CREATE POLICY "uploads_delete_owner" ON public.uploads FOR DELETE
  USING (uploaded_by = auth.uid()::text OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
      AND ur.is_active = true
  ));
