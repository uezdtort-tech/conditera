-- ============================================================
-- 0028_profiles_registration_columns.sql
-- Недостающие колонки public.profiles, ожидаемые auth/TFA/payouts кодом.
--
-- Обнаружено E2E-тестом onboarding-flow (register → 500
-- "Could not find the 'is_verified' column of 'profiles'"):
-- миграция 0001 создавала profiles в минимальном составе, а код использует:
--
--   Auth-флоу (register/login/password):
--   - password_hash:  Argon2id (src/lib/auth.ts hashPassword/verifyPassword)
--   - is_verified:    флаг верификации (login возвращает isVerified)
--   - legal_info:     JSONB юр.информация из регистрации (ИП/ООО)
--   - last_login_at:  обновляется при login (non-blocking update)
--
--   2FA (src/app/api/auth/2fa/*, login 2FA-gate):
--   - two_factor_enabled, two_factor_secret, two_factor_backup_codes
--
--   Legacy 2FA (src/app/api/payouts/request — параллельная система):
--   - tfa_enabled, tfa_secret, tfa_backup_codes, tfa_required_for
--
-- Все колонки nullable/с дефолтами — безопасно для существующих строк.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS legal_info JSONB,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS two_factor_secret TEXT,
  ADD COLUMN IF NOT EXISTS two_factor_backup_codes TEXT[],
  ADD COLUMN IF NOT EXISTS tfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tfa_secret TEXT,
  ADD COLUMN IF NOT EXISTS tfa_backup_codes TEXT[],
  ADD COLUMN IF NOT EXISTS tfa_required_for TEXT[];

COMMENT ON COLUMN public.profiles.password_hash IS 'Argon2id hash для email+password аутентификации (OAuth-пользователи — NULL)';
COMMENT ON COLUMN public.profiles.legal_info IS 'Юридическая информация (ИНН/ОГРН/наименование) из регистрации';
COMMENT ON COLUMN public.profiles.is_verified IS 'Подтверждённый профиль (email/админ-верификация)';
COMMENT ON COLUMN public.profiles.two_factor_enabled IS 'Включённая TOTP 2FA (auth/2fa routes)';
COMMENT ON COLUMN public.profiles.tfa_required_for IS 'Операции, требующие 2FA (например payout) — legacy-система payouts';
