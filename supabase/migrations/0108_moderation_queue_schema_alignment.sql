-- 0108_moderation_queue_schema_alignment.sql
-- Согласование фактической таблицы moderation_queue с Content Moderation Engine
-- и API очереди модерации. Старые поля сохраняются для обратной совместимости.

ALTER TABLE public.moderation_queue
  ADD COLUMN IF NOT EXISTS author_name TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS content TEXT,
  ADD COLUMN IF NOT EXISTS images TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS auto_score NUMERIC(6,5) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS violations TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS idx_moderation_queue_author_name
  ON public.moderation_queue(author_name)
  WHERE author_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_moderation_queue_auto_score
  ON public.moderation_queue(auto_score DESC);

COMMENT ON COLUMN public.moderation_queue.author_name IS
  'Имя автора для поиска и отображения в очереди модерации.';
COMMENT ON COLUMN public.moderation_queue.title IS
  'Заголовок проверяемого материала.';
COMMENT ON COLUMN public.moderation_queue.content IS
  'Текст проверяемого материала; используется для поиска и предпросмотра.';
COMMENT ON COLUMN public.moderation_queue.images IS
  'URL изображений, переданных на автоматическую модерацию.';
COMMENT ON COLUMN public.moderation_queue.auto_score IS
  'Максимальная оценка риска автоматической модерации в диапазоне 0..1.';
COMMENT ON COLUMN public.moderation_queue.violations IS
  'Коды категорий нарушений, обнаруженных автоматической модерацией.';

NOTIFY pgrst, 'reload schema';
