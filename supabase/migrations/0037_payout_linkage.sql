-- 0037_payout_linkage.sql — PAY-3b (payout-раунд, аудит pay3 @ 3eb6066+pay3)
--
-- Закрывает находки аудита, которые 0036 не покрывала:
--
-- P0-B (чужой резерв): резерв заказа не был связан с заявкой — только
--   timestamp payout_reserved_at. admin reject снимал резерв blanket'ом
--   (.not(payout_reserved_at IS NULL)) и мог снять резерв КОНКУРЕНТНОЙ
--   новой заявки; complete маркировал заказы по устаревшему
--   metadata.orders без привязки. Теперь orders.payout_request_id —
--   жёсткая связь «заказ ⇔ заявка», все снятия/маркировки — по ней.
--
-- P0-A (деньги из воздуха) закрывается КОДОМ admin/payouts (reject
--   возвращает резерв только при metadata.orders); здесь ничего не меняем.
--
-- P1-D (гонка 2FA backup-кода): consume_tfa_backup_code — атомарное
--   списание одного кода (UPDATE ... WHERE codes @> ARRAY[hash]) вместо
--   read-verify-filter-write; два параллельных запроса с одним кодом —
--   проходит ровно один.
--
-- P2-G (crash-window двойного начисления эскроу): release_escrow_order —
--   claim заказа (CAS) и начисление баланса в ОДНОЙ транзакции. Падение
--   между шагами больше не даёт повторного начисления на ретрае крона;
--   ручная компенсация и CAS-ретраи в JS не нужны (fallback сохранён).
--
-- P2-H: payout_requests.status без CHECK — добавляем CHECK (NOT VALID:
--   новые/обновляемые строки валидируются, старые строки не трогаем —
--   на живой БД могут быть легаси-статусы; их разбор — ops).
--
-- Идемпотентно: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / DO-гварды.
-- Apply на живую БД ОДНИМ окном с 0034/0035/0036 (см. worklog).
-- One-shot валидация: bun scripts/verify-payout-0037-pglite.ts

-- === 1. orders.payout_request_id — связь резерва с заявкой ===
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payout_request_id UUID;

COMMENT ON COLUMN public.orders.payout_request_id IS
  'payout_requests.id, под которую заказ зарезервирован (payout_reserved_at NOT NULL). Заполняется /api/payouts/request при CAS-резерве; снимается (NULL) при компенсации/reserve-reject и admin reject. Все снятия резерва и финальная маркировка (admin complete) обязаны фильтровать по этой колонке — защита от снятия/маркировки чужого резерва при конкурентных заявках.';

CREATE INDEX IF NOT EXISTS idx_orders_payout_request
  ON public.orders (payout_request_id)
  WHERE payout_request_id IS NOT NULL;

-- === 2. payout_requests.status — CHECK (NOT VALID) ===
-- NOT VALID: constraint применяется к новым INSERT/UPDATE; существующие
-- строки с легаси-статусами не валидируются (их разбор — ops).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payout_requests_status_check'
       AND conrelid = 'public.payout_requests'::regclass
  ) THEN
    ALTER TABLE public.payout_requests
      ADD CONSTRAINT payout_requests_status_check
      CHECK (status IN ('pending', 'approved', 'paid', 'rejected'))
      NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT payout_requests_status_check ON public.payout_requests IS
  'PAY-3b: стейт-машина выплат на уровне БД (NOT VALID — только новые записи). pending → approved → paid | rejected; прямой pending → paid запрещён приложением (CAS в /api/admin/payouts).';

-- === 3. consume_tfa_backup_code — атомарное списание 2FA backup-кода ===
-- Закрывает гонку read-verify-filter-write: два параллельных запроса с
-- одним кодом — обновление проходит ровно у одного (guard @> в WHERE).
CREATE OR REPLACE FUNCTION public.consume_tfa_backup_code(
  p_user_id UUID,
  p_code_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_code_hash IS NULL OR length(p_code_hash) = 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE public.profiles
     SET tfa_backup_codes = array_remove(tfa_backup_codes, p_code_hash),
         updated_at = now()
   WHERE id = p_user_id
     AND tfa_backup_codes @> ARRAY[p_code_hash]::text[]
  RETURNING id INTO v_id;

  RETURN v_id IS NOT NULL;
END;
$$;

-- === 4. release_escrow_order — атомарный claim эскроу + начисление ===
-- Возвращает: 1 — заказ клеймен и баланс начислен (одна транзакция);
--             0 — заказ уже релизнут конкурентным запуском (0 изменений);
-- RAISE — p_payout < 0 или кондитер не найден (транзакция откатывается
--         ЦЕЛИКОМ: claim заказа не останется без начисления).
CREATE OR REPLACE FUNCTION public.release_escrow_order(
  p_order_id UUID,
  p_conf_id TEXT,
  p_payout INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed INTEGER;
BEGIN
  IF p_payout IS NULL OR p_payout < 0 THEN
    RAISE EXCEPTION 'payout must be >= 0';
  END IF;

  -- CAS-claim заказа: только один конкурентный воркер выигрывает.
  -- ВАЖНО (pay3b): RETURNING ... INTO при 0 строк присваивает NULL
  -- (не оставляет прежнее значение) — проверяем IS NULL, иначе
  -- проигравший конкурентный вызов начислил бы баланс повторно.
  UPDATE public.orders
     SET escrow_released_at = now(),
         payment_status = 'released'
   WHERE id = p_order_id
     AND payment_status = 'escrow'
     AND escrow_released_at IS NULL
   RETURNING 1 INTO v_claimed;

  IF v_claimed IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.confectioners
     SET balance = COALESCE(balance, 0) + p_payout,
         "totalEarnings" = COALESCE("totalEarnings", 0) + p_payout
   WHERE id = p_conf_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'confectioner not found: %', p_conf_id;
  END IF;

  RETURN 1;
END;
$$;

-- === 5. Гранты новых RPC — только service_role ===
-- Сигнатурно-независимо (по proname) — как 0034/0036.
DO $$
DECLARE
  fn record;
  fname TEXT;
BEGIN
  FOREACH fname IN ARRAY ARRAY[
    'consume_tfa_backup_code',
    'release_escrow_order'
  ] LOOP
    FOR fn IN
      SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = fname
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated;', fn.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', fn.sig);
    END LOOP;
  END LOOP;
END $$;
