-- 0016_channel_moderation.sql
-- Модерация публикаций кондитеров и авто-публикация в Telegram-канал.
-- (ПЕРЕИМЕНОВАНО из 0016_channel_moderation.sql: выполняется ПОСЛЕ 0017_sync_missing_tables.sql,
--  т.к. channel_posts создаётся в 0017, а эта миграция делает ALTER TABLE над ним.)
-- Добавляем поля модерации в channel_posts
ALTER TABLE public.channel_posts ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'approved';
ALTER TABLE public.channel_posts ADD COLUMN IF NOT EXISTS moderated_by TEXT;
ALTER TABLE public.channel_posts ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;
ALTER TABLE public.channel_posts ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE public.channel_posts ADD COLUMN IF NOT EXISTS telegram_message_id BIGINT;
ALTER TABLE public.channel_posts ADD COLUMN IF NOT EXISTS telegram_posted_at TIMESTAMPTZ;
ALTER TABLE public.channel_posts ADD COLUMN IF NOT EXISTS telegram_post_error TEXT;

-- Индекс для быстрого поиска pending постов
CREATE INDEX IF NOT EXISTS idx_channel_posts_moderation ON public.channel_posts(moderation_status)
  WHERE moderation_status = 'pending';

COMMENT ON COLUMN public.channel_posts.moderation_status IS 'pending | approved | rejected';
COMMENT ON COLUMN public.channel_posts.telegram_message_id IS 'ID сообщения в Telegram-канале (если опубликовано)';
