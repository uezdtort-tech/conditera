-- ============================================================================
-- 0072_recipe_purchases_entitlement.sql — RECIPE-02 (Этап B, RB.17/RA.17.8)
--
-- Entitlement-схема покупок рецептов (РЕШ-6, RB.13 прим.5):
--   • UNIQUE (recipe_id, buyer_id)      — одно право доступа на рецепт и
--     покупателя (финансовая история при этом живёт в orders/payments/refunds —
--     entitlement переживает несколько платежей, реактивация РЕШ-6.2);
--   • recipe_version_id — фиксация приобретённой версии (Q-3.2 default:
--     доступ на зафиксированную версию; nullable — исторические строки);
--   • payment_id → payments(id) FK — связь с подтверждённым платежом
--     (мост ORDERS↔RECIPE_PURCHASES: 1 акт покупки = 1 order(type='recipe')
--     + 1 payment; выдача entitlement — только после серверного подтверждения
--     платежа, RA.10);
--   • CHECK royalty_amount + commission_amount <= price_paid — целостность
--     финансовых связей (существующий chk_recipe_purchase_payment сохраняется).
--
-- Перенос данных: НЕТ (0 строк; исторические NULL-версии допустимы — RB.17).
--
-- Идемпотентность: уникальности — CREATE UNIQUE INDEX IF NOT EXISTS;
-- FK/CHECK — DO-гварды pg_constraint. На 0 строк конфликт невозможен, но
-- гварды всё равно ставятся; конфликт реальных данных = fail-fast (не прятать).
-- ============================================================================

-- ============================================================================
-- 1. recipe_version_id — привязка к приобретённой версии (Q-3.2/РЕШ-6)
-- ============================================================================
ALTER TABLE public.recipe_purchases
  ADD COLUMN IF NOT EXISTS recipe_version_id UUID;

COMMENT ON COLUMN public.recipe_purchases.recipe_version_id IS
  'RECIPE-02: зафиксированная приобретённая версия рецепта (Q-3.2 default); NULL — исторические строки до RECIPE-02';

-- FK → recipe_versions — DO-гварда pg_constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_recipe_purchases_recipe_version'
       AND conrelid = 'public.recipe_purchases'::regclass
  ) THEN
    ALTER TABLE public.recipe_purchases
      ADD CONSTRAINT fk_recipe_purchases_recipe_version
      FOREIGN KEY (recipe_version_id)
      REFERENCES public.recipe_versions (id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- 2. payment_id → payments(id) FK — связь с подтверждённым платежом
--    (колонка существует с 0012 без FK; RB.13: «payment_id FK (новый, 0072)»)
-- ============================================================================
DO $$
DECLARE
  v_bad INT;
BEGIN
  -- fail-fast: FK навешивается только если все существующие payment_id валидны
  SELECT count(*) INTO v_bad
    FROM public.recipe_purchases p
   WHERE p.payment_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.payments pay WHERE pay.id = p.payment_id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION '[0072] % строк recipe_purchases ссылаются на несуществующие payments — FK не навешан', v_bad
      USING HINT = 'Требуется ручное разрешение ссылочной целостности до применения 0072';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_recipe_purchases_payment'
       AND conrelid = 'public.recipe_purchases'::regclass
  ) THEN
    ALTER TABLE public.recipe_purchases
      ADD CONSTRAINT fk_recipe_purchases_payment
      FOREIGN KEY (payment_id)
      REFERENCES public.payments (id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- 3. UNIQUE (recipe_id, buyer_id) — одно право доступа (РЕШ-6, RB.13 прим.1)
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_recipe_purchases_recipe_buyer
  ON public.recipe_purchases (recipe_id, buyer_id);

-- ============================================================================
-- 4. CHECK royalty_amount + commission_amount <= price_paid
-- ============================================================================
DO $$
DECLARE
  v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.recipe_purchases
   WHERE price_paid < royalty_amount + commission_amount;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '[0072] % строк нарушают royalty+commission <= price_paid', v_bad
      USING HINT = 'Требуется ручная коррекция финансовых данных до применения 0072';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_recipe_purchases_price_split'
       AND conrelid = 'public.recipe_purchases'::regclass
  ) THEN
    ALTER TABLE public.recipe_purchases
      ADD CONSTRAINT chk_recipe_purchases_price_split
      CHECK (price_paid >= royalty_amount + commission_amount);
  END IF;
END $$;

-- ============================================================================
-- ROLLBACK PLAN (RA.17; выполняется вручную)
-- ============================================================================
-- ALTER TABLE public.recipe_purchases DROP CONSTRAINT IF EXISTS chk_recipe_purchases_price_split;
-- DROP INDEX IF EXISTS uq_recipe_purchases_recipe_buyer;
-- ALTER TABLE public.recipe_purchases DROP CONSTRAINT IF EXISTS fk_recipe_purchases_payment;
-- ALTER TABLE public.recipe_purchases DROP CONSTRAINT IF EXISTS fk_recipe_purchases_recipe_version;
-- ALTER TABLE public.recipe_purchases DROP COLUMN IF EXISTS recipe_version_id;
