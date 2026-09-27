-- ============================================================================
-- 0034_money_path_identity.sql — замыкание цепочки «оплата → баланс → выплата»
--
-- Источник: аудит БД и целостности цепочек @ 3f4ba40 (сессия db1).
--
-- КЛЮЧЕВАЯ МОДЕЛЬ (вариант A «быстрее», см. аудит §7 п.4):
--   orders/products.confectioner_id — UUID → auth.users (0002): ссылка на
--   ПОЛЬЗОВАТЕЛЯ. Бизнес-профиль кондитера — public.confectioners (0017):
--   PK «id» TEXT (conf_*-cuid), связь с пользователем — «userId» TEXT
--   (UNIQUE confectioners_userId_key уже в 0017 — доп. индекс не нужен).
--   Правила для кода money-path:
--     • профиль кондитера искать ТОЛЬКО по «userId»;
--     • eligible-заказы фильтровать ТОЛЬКО по orders.confectioner_id
--       (= auth-UUID = confectioners."userId");
--     • колонки confectioners — camelCase («balance», «totalEarnings»).
--   Вариант B (перевод orders/products на FK → confectioners(id)) —
--   отдельно, вместе с ledger-миграцией PAY-2.
--
-- ЧТО ЧИНИЛА ЭТА МИГРАЦИЯ (по убыванию тяжести):
--   1) CRITICAL: orders НЕ имел колонок payment_status / escrow_released_at /
--      payout_transferred_at / tariff_snapshot / commission_rate_snapshot —
--      они есть только в Prisma-схеме (PGlite dev), но ни одна Supabase-
--      миграция их не создавала. Следствие: webhook не мог пометить заказ
--      escrow (PGRST204), cron escrow-release падал на выборке, выплаты не
--      находили eligible-заказов. Весь escrow-контур на канонической БД
--      был мёртв. Здесь колонки создаются (snake_case, как в коде PAY-0).
--   2) HIGH: SECURITY DEFINER RPC deduct_conference_balance (0013) был
--      доступен PUBLIC/anon/authenticated (EXECUTE по умолчанию) — единственный
--      серверный вызывающий это payouts/request через service_role. Остальные
--      RPC 0013 (loyalty/channel) пока не трогаем — среди них есть вызовы
--      с серверных роутов под anon/authenticated; их сужение — PAY-2.
--   3) MEDIUM: ложные комментарии «в копейках» — все суммы пишутся в РУБЛЯХ
--      (целые рубли; провайдеру передаются строкой toFixed(2)). Вердикт
--      верификации единиц — см. аддендум отчёта ПЛАТЕЖНЫЙ_КОНТУР.
--   4) MEDIUM: отсутствовали CHECK на положительность сумм и индексы под
--      cron-выборки.
--
-- ИДЕМПОТЕНТНОСТЬ: apply-migrations.ts не ведёт журнал применённых файлов,
-- поэтому каждый шаг ниже безопасен при повторном запуске.
--
-- БЭКФИЛЛ ДЕНЕЖНЫХ СТАТУСОВ — СОЗНАТЕЛЬНО НЕ ВКЛЮЧЁН (см. конец файла).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. CRITICAL: money-колонки orders, которых не было в 0002/0011
--    (enum payment_status создан в 0001; snake_case — как в коде PAY-0)
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status payment_status DEFAULT 'pending';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS escrow_released_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payout_transferred_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tariff_snapshot TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS commission_rate_snapshot DOUBLE PRECISION;

COMMENT ON COLUMN public.orders.payment_status IS
  'Денежная машина состояний заказа: pending → escrow → released | cancelled | refunded. Пишется webhook''ом (payment.succeeded → escrow; canceled → cancelled; refund.succeeded → refunded) и cron escrow-release (escrow → released). НЕ путать с payments.status (статус платежа провайдера).';
COMMENT ON COLUMN public.orders.escrow_released_at IS
  'Момент релиза эскроу кондитеру (cron /api/cron/escrow-release, холд 24ч). NULL = ещё в холде.';
COMMENT ON COLUMN public.orders.payout_transferred_at IS
  'Момент фактической выплаты кондитеру (payout_requests → paid).';
COMMENT ON COLUMN public.orders.tariff_snapshot IS
  'Снапшот тарифа кондитера на момент заказа (BASIC/PRO/...). Резерв под дифференцированные комиссии.';
COMMENT ON COLUMN public.orders.commission_rate_snapshot IS
  'Снапшот ставки комиссии площадки (доля от 0 до 1) на момент заказа. NULL → дефолт 0.15 в коде. ВАЖНО: единая таблица тарифов — бизнес-решение в PAY-2 (orders 0.15 vs finance 0.12).';

-- Индексы под cron-выборки (partial — маленькие и точные)
CREATE INDEX IF NOT EXISTS idx_orders_escrow_hold
  ON public.orders (created_at)
  WHERE payment_status = 'escrow' AND escrow_released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_payout_batch
  ON public.orders (confectioner_id)
  WHERE payment_status = 'released' AND payout_transferred_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Единицы денег: суммы В РУБЛЯХ (целые рубли), комментарии 0002/0009/0019
--    «в копейках» ложные. Перекрываем COMMENT'ами.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.payments.amount IS
  'Сумма платежа в РУБЛЯХ (целые рубли, без копеек). Провайдеру передаётся строкой amount.toFixed(2); webhook сверяет wire-копейки = amount*100.';
COMMENT ON COLUMN public.payments.refund_amount IS
  'Суммарно возвращённая сумма в РУБЛЯХ (накопительно, частичные возвраты суммируются).';
COMMENT ON COLUMN public.orders.subtotal IS 'Сумма позиций заказа в РУБЛЯХ (целые рубли).';
COMMENT ON COLUMN public.orders.delivery_cost IS 'Стоимость доставки в РУБЛЯХ (целые рубли).';
COMMENT ON COLUMN public.orders.discount IS 'Скидка в РУБЛЯХ (целые рубли).';
COMMENT ON COLUMN public.orders.total IS 'Итог заказа в РУБЛЯХ: subtotal + delivery_cost − discount. Проверка webhook''а: payments.amount = orders.total.';
COMMENT ON COLUMN public.order_items.unit_price IS 'Цена позиции в РУБЛЯХ (целые рубли, snapshot на момент заказа).';
COMMENT ON COLUMN public.order_items.total IS 'Сумма позиции в РУБЛЯХ: unit_price × quantity.';
COMMENT ON COLUMN public.refunds.amount IS 'Сумма возврата в РУБЛЯХ (целые рубли). Частичный возврат ≤ payments.amount − уже возвращённое.';
COMMENT ON COLUMN public.payout_requests.amount IS
  'Сумма выплаты в РУБЛЯХ (целые рубли). Выплата — на полную доступную сумму батча (см. payouts/request).';
COMMENT ON COLUMN public.payouts.amount IS 'Сумма выплаты в РУБЛЯХ (целые рубли). Таблица payouts (0019) — legacy-контур, см. ниже.';
COMMENT ON COLUMN public.payouts.fee_amount IS 'Комиссия провайдера выплаты в РУБЛЯХ.';
COMMENT ON COLUMN public.payouts.net_amount IS 'Сумма выплаты «на руки» в РУБЛЯХ (amount − fee_amount).';
COMMENT ON COLUMN public.escrow_accounts.held_amount IS 'Замороженная сумма в РУБЛЯХ (целые рубли).';

-- ---------------------------------------------------------------------------
-- 3. CHECK на суммы: NOT VALID (не сканирует существующие строки —
--    легаси-данные не уронят миграцию), проверяет все НОВЫЕ записи.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_amount_positive') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_amount_nonnegative') THEN
    ALTER TABLE public.refunds ADD CONSTRAINT refunds_amount_nonnegative CHECK (amount >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payout_requests_amount_positive') THEN
    ALTER TABLE public.payout_requests ADD CONSTRAINT payout_requests_amount_positive CHECK (amount > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payouts_amount_positive') THEN
    ALTER TABLE public.payouts ADD CONSTRAINT payouts_amount_positive CHECK (amount > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_total_nonnegative') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_total_nonnegative CHECK (total >= 0) NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. HIGH: EXECUTE на deduct_conference_balance — только service_role.
--    Единственный вызывающий в коде — /api/payouts/request (supabaseAdmin).
--    Сигнатурно-независимо (по proname) — переживает изменение аргументов.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'deduct_confectioner_balance'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated;', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', fn.sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Отладочно-админский view для сверки money-path (аудит §7 п.10).
--    Доступ только service_role (join по confectioners — superuser-owner,
--    RLS не применяется; не светим кондитерам/покупателям).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_order_money AS
SELECT
  o.id                AS order_id,
  o.number            AS order_number,
  o.status            AS order_status,
  o.payment_status    AS order_payment_status,
  o.total,
  o.subtotal,
  o.delivery_cost,
  o.discount,
  o.payout_transferred_at,
  o.created_at,
  o.confectioner_id   AS confectioner_auth_uid,
  c.id                AS confectioner_pk,
  c."businessName"    AS confectioner_business_name,
  c."balance"         AS confectioner_balance,
  c."totalEarnings"   AS confectioner_total_earnings,
  p.id                AS payment_id,
  p.yookassa_payment_id,
  p.status            AS payment_provider_status,
  p.amount            AS payment_amount,
  p.refund_amount
FROM public.orders o
LEFT JOIN public.confectioners c ON c."userId" = o.confectioner_id::text
LEFT JOIN public.payments p ON p.order_id = o.id;

REVOKE ALL ON public.v_order_money FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_order_money TO service_role;
COMMENT ON VIEW public.v_order_money IS
  'Money-path сверка: заказ + платежи + профиль кондитера (join по «userId», т.к. orders.confectioner_id — auth-UUID). Для админки и отладки; сироты видны как confectioner_pk IS NULL.';

COMMIT;

-- ============================================================================
-- БЭКФИЛЛ ДЕНЕЖНЫХ СТАТУСОВ — ВЫПОЛНЯТЬ ВРУЧНУЮ ПОСЛЕ ПРОВЕРКИ (см.
-- scripts/verify-money-path.ts, проверка №4). НЕ ЗАПУСКАТЬ ВСЛЕПУЮ:
--
-- Исторические оплаченные заказы остались payment_status='pending' (webhook
-- падал с PGRST204 до этой миграции). Их можно перевести в escrow — дальше
-- штатный cron релизнет с дефолтной комиссией 0.15 (снапшоты NULL):
--
--   UPDATE public.orders o
--      SET payment_status = 'escrow'
--    WHERE o.payment_status = 'pending'
--      AND o.status NOT IN ('CANCELLED', 'REFUNDED')
--      AND EXISTS (SELECT 1 FROM public.payments p
--                   WHERE p.order_id = o.id AND p.status = 'succeeded');
--
-- ТРЕБУЕТ ПОДТВЕРЖДЕНИЯ ВЛАДЕЛЬЦА ПРОДУКТА: двигает деньги (запускает
-- начисления балансов после 24ч холда).
-- ============================================================================
