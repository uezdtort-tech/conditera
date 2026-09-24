-- ============================================================================
-- 0031_org_verifications_schema.sql
--
-- Schema drift fix: migration 0010 создала organization_verifications с 13
-- колонками, а src/lib/dadata.ts (verifyOrganization) эволюционировал и пишет
-- 22. Любая вставка падала с "column ... does not exist" → история верификаций
-- пустая, консоль админи-таба ловила "Failed to load".
--
-- Добавляем недостающие колонки (все IF NOT EXISTS — идемпотентно):
--   confectioner_id TEXT  — confectioners.id имеет тип TEXT (схема 0017)
--   management_* / legal_address / registered_at / liquidated_at — DaData party
--   success / error_message / raw_data / action_taken / verified_by — аудит
-- Плюс индексы по горячим путям (фильтры админ-таба, cron findNeedingRecheck).
-- ============================================================================

ALTER TABLE public.organization_verifications
  ADD COLUMN IF NOT EXISTS confectioner_id TEXT,
  ADD COLUMN IF NOT EXISTS management_name TEXT,
  ADD COLUMN IF NOT EXISTS management_post TEXT,
  ADD COLUMN IF NOT EXISTS legal_address TEXT,
  ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS liquidated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS success BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS raw_data JSONB,
  ADD COLUMN IF NOT EXISTS action_taken TEXT,
  ADD COLUMN IF NOT EXISTS verified_by UUID;

CREATE INDEX IF NOT EXISTS idx_org_verif_user_id      ON public.organization_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_org_verif_conf_id      ON public.organization_verifications(confectioner_id);
CREATE INDEX IF NOT EXISTS idx_org_verif_created_at   ON public.organization_verifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_verif_inn          ON public.organization_verifications(inn);

-- Антидрейф-комментарий: перечень колонок, которые ожидает dadata.ts.
COMMENT ON TABLE public.organization_verifications IS
  'История верификаций организаций (DaData). Полная схема: id, user_id, confectioner_id, inn, ogrn, kpp, company_name, full_name, opf_code, opf_short, status, management_name, management_post, legal_address, registered_at, liquidated_at, trigger, success, error_message, raw_data, action_taken, verified_by, verified_at, created_at';
