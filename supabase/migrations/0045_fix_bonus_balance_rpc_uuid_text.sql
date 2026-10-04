-- 0045_fix_bonus_balance_rpc_uuid_text.sql
--
-- Исправление add_bonus_balance / deduct_bonus_balance (0013): параметр
-- p_user_id TEXT сравнивался с profiles.id UUID напрямую — `uuid = text`.
-- На современном PostgreSQL (18, embedded) неявного приведения нет →
-- «operator does not exist: uuid = text», начисление бонусов падало.
--
-- Фикс: явный ::uuid-каст внутри функции. Сигнатура (TEXT) не меняется —
-- все вызывающие (loyalty.ts rpc) продолжают работать без правок кода.

CREATE OR REPLACE FUNCTION public.add_bonus_balance(
  p_user_id TEXT,
  p_points INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  IF p_points = 0 THEN
    RAISE EXCEPTION 'points must be non-zero';
  END IF;

  UPDATE public.profiles
     SET bonus_balance = COALESCE(bonus_balance, 0) + p_points
   WHERE id = p_user_id::uuid
   RETURNING bonus_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'user not found: %', p_user_id;
  END IF;

  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'insufficient balance: %', v_new_balance;
  END IF;

  RETURN v_new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.deduct_bonus_balance(
  p_user_id TEXT,
  p_points INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance INTEGER;
  v_current INTEGER;
BEGIN
  IF p_points <= 0 THEN
    RAISE EXCEPTION 'deduct points must be positive';
  END IF;

  SELECT COALESCE(bonus_balance, 0) INTO v_current
    FROM public.profiles
   WHERE id = p_user_id::uuid
   FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'user not found: %', p_user_id;
  END IF;

  IF v_current < p_points THEN
    RAISE EXCEPTION 'insufficient balance: has %, needs %', v_current, p_points;
  END IF;

  UPDATE public.profiles
     SET bonus_balance = v_current - p_points
   WHERE id = p_user_id::uuid
   RETURNING bonus_balance INTO v_new_balance;

  RETURN v_new_balance;
END;
$$;
