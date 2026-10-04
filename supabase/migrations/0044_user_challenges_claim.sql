-- 0044_user_challenges_claim.sql
--
-- consumer: src/app/api/gamification/challenges/[id]/claim/route.ts,
--           src/app/api/gamification/challenges/route.ts
-- Семантика «получить награду» требует флага выдачи: без него повторный
-- POST начислял бы бонусные баллы бесконечно. Возвращает bool по именованному
-- флагу, чтобы гонка двух параллельных claim была исключена на уровне API
-- (условный update ... where claimed = false).

ALTER TABLE public.user_challenges
  ADD COLUMN IF NOT EXISTS claimed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

COMMENT ON COLUMN public.user_challenges.claimed IS
  'Награда за челлендж выдана (защита от повторного начисления)';

CREATE INDEX IF NOT EXISTS idx_user_challenges_open
  ON public.user_challenges(user_id)
  WHERE claimed = false;
