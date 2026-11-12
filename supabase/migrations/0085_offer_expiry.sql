-- ============================================================================
-- 0085_offer_expiry.sql — Z-v32 Этап 8: срок действия индивидуальных предложений
--
-- Инвестигация (PR-5):
--   • negotiations (0004) — индивидуальное предложение кондитера по inquiry:
--     quoted_price в КОПЕЙКАХ, revisions (prior-value snapshot), статус
--     'pending_confectioner'|'quoted'|'accepted'|'declined'|'counter_offered'|'expired'.
--     expires_at (48h от создания) — окно ОТВЕТА на переговоры, а НЕ срок
--     действия самого предложения кондитера.
--   • confectioner_quotes (0023) — ценовое предложение кондитера в потоке
--     конструктора (quote_requests). Экспирации НЕТ вовсе (status 'expired'
--     в CHECK есть, но колонки срока и механизма нет).
--   • quote_requests — ЗАПРОС (не предложение), у него уже есть expires_at —
--     не трогаем.
--   • Accept-эндпоинт существует ТОЛЬКО у negotiations (PATCH action=accept);
--     приём истёкшего предложения сегодня не блокируется ничем.
--
-- Решение: valid_until = срок действия ТЕКУЩЕГО предложения.
--   NULL  — предложения ещё нет (pending_confectioner) / срок не задан;
--   дата  — срок, после которого принятие блокируется (410 OFFER_EXPIRED).
-- Принятие (accept) фиксирует цену; после accept valid_until больше не
-- ограничивает оформление (фиксация произошла до истечения — гарант:
-- роут + триггер-бэкстоп ниже).
--
-- Дефолты (документировано): сервер ставит valid_until = now() + 14 дней
-- при quote/respone; кондитер может передать custom срок — кламп 1..60 дней.
-- Cron/lazy-гард не нужен: проверка в момент accept (документировано PR-5).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. negotiations.valid_until
-- ---------------------------------------------------------------------------
ALTER TABLE public.negotiations
  ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.negotiations.valid_until IS
  'Z-v32 (0085): срок действия ТЕКУЩЕГО предложения кондитера. NULL — предложения нет. '
  'Сервер: now() + 14 дней при quote (custom клампится 1..60). Accept после истечения -> 410 OFFER_EXPIRED.';

-- Backfill: строки с фактическим предложением (quoted_at) получают
-- документированный дефолт 14 дней от момента предложения. Строкам без
-- предложения (quoted_at IS NULL) valid_until не ставим — предложения нет.
UPDATE public.negotiations
   SET valid_until = COALESCE(quoted_at, created_at) + INTERVAL '14 days'
 WHERE valid_until IS NULL
   AND quoted_at IS NOT NULL;

-- CHECK: valid_until не может быть раньше создания переговоров
-- (обе колонки в этой же таблице).
ALTER TABLE public.negotiations
  DROP CONSTRAINT IF EXISTS negotiations_valid_until_after_created;
ALTER TABLE public.negotiations
  ADD CONSTRAINT negotiations_valid_until_after_created
  CHECK (valid_until IS NULL OR valid_until >= created_at);

-- CHECK: статус-машина переговоров (значения из 0004 + фактических записей кода:
-- inquiries route, negotiations route, use-cake-builder — других нет).
ALTER TABLE public.negotiations
  DROP CONSTRAINT IF EXISTS negotiations_status_check;
ALTER TABLE public.negotiations
  ADD CONSTRAINT negotiations_status_check
  CHECK (status IS NULL OR status IN (
    'pending_confectioner', 'quoted', 'accepted', 'declined',
    'counter_offered', 'expired'
  ));

-- ---------------------------------------------------------------------------
-- 2. Триггер-бэкстоп: принятие истёкшего/отсутствующего предложения запрещено
--    на уровне БД (закрывает и прямой клиентский путь supabase из
--    use-cake-builder.ts, и будущие пути). Роут дополнительно отвечает
--    честным 410 OFFER_EXPIRED до UPDATE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_negotiation_offer_expiry_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    IF NEW.quoted_price IS NULL THEN
      RAISE EXCEPTION 'NEGOTIATION_ACCEPT_NO_OFFER: нельзя принимать переговоры без предложения кондитера';
    END IF;
    IF NEW.valid_until IS NOT NULL AND NEW.valid_until < now() THEN
      RAISE EXCEPTION 'NEGOTIATION_OFFER_EXPIRED: срок действия предложения истёк (%)', NEW.valid_until;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_negotiation_offer_expiry_guard ON public.negotiations;
CREATE TRIGGER trg_negotiation_offer_expiry_guard
  BEFORE UPDATE ON public.negotiations
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_negotiation_offer_expiry_guard();

COMMENT ON FUNCTION public.fn_negotiation_offer_expiry_guard() IS
  'Z-v32 (0085): бэкстоп — UPDATE status->accepted запрещён при quoted_price IS NULL или valid_until < now().';

-- ---------------------------------------------------------------------------
-- 3. confectioner_quotes.valid_until (второй транспорт индивидуальных
--    предложений — поток конструктора). Accept-эндпоинта для них сегодня НЕТ
--    (gap задокументирован в PR-5), колонка подготавливает срок на момент
--    отправки предложения.
-- ---------------------------------------------------------------------------
ALTER TABLE public.confectioner_quotes
  ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.confectioner_quotes.valid_until IS
  'Z-v32 (0085): срок действия ценового предложения конструктора. Сервер: now() + 14 дней при respond (custom клампится 1..60).';

UPDATE public.confectioner_quotes
   SET valid_until = created_at + INTERVAL '14 days'
 WHERE valid_until IS NULL;

ALTER TABLE public.confectioner_quotes
  DROP CONSTRAINT IF EXISTS confectioner_quotes_valid_until_after_created;
ALTER TABLE public.confectioner_quotes
  ADD CONSTRAINT confectioner_quotes_valid_until_after_created
  CHECK (valid_until IS NULL OR valid_until >= created_at);

COMMIT;
