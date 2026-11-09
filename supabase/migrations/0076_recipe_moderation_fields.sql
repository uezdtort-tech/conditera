-- ============================================================================
-- 0076_recipe_moderation_fields.sql — RELEASE-02 §7 / RELEASE-03 §6
-- ============================================================================

-- 0076: Персистентность модерации рецептов (RELEASE-02 §7 / RELEASE-03 §6)
-- moderated_by/moderated_at/moderation_reason: аудиторский след модераторских
-- решений (approve/reject), персистентный reason. Rerun-safe: IF NOT EXISTS.
-- GRANT не выдаются и не отзываются.
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS moderated_by UUID REFERENCES auth.users (id) ON DELETE SET NULL;
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
COMMENT ON COLUMN public.recipes.moderated_by IS 'Модератор, выполнивший последнее решение (approve/reject)';
COMMENT ON COLUMN public.recipes.moderated_at IS 'Время последнего модераторского решения';
COMMENT ON COLUMN public.recipes.moderation_reason IS 'Причина решения модератора (persist для reject/approve)';
