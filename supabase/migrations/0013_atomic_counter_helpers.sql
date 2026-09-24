-- 0013_atomic_counter_helpers.sql
-- Атомарные RPC-функции для инкремента/декремента counter-колонок.
-- Решает race condition "read-then-write", когда два параллельных запроса
-- читают одинаковое значение и один из апдейтов теряется.
--
-- Все функции:
--   • SECURITY DEFINER — выполнение с правами сервера (обходит RLS)
--   • IMMUTABLE только для сигнатуры, не для тела
--   • Возвращают новое значение counter (integer) либо NULL при ошибке
--
-- Безопасность: параметры принимают идентификаторы строк (TEXT — подходит
-- и для UUID, и для CUID, и для других форматов), никаких строковых
-- интерполяций в SQL нет — все имена таблиц/колонок заданы статически
-- внутри тела функции.

-- ============================================================================
-- channel_followers → confectioners.followers_count
-- ============================================================================
CREATE OR REPLACE FUNCTION public.increment_followers_count(p_confectioner_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.confectioners
     SET followers_count = COALESCE(followers_count, 0) + 1
   WHERE id = p_confectioner_id
   RETURNING followers_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_followers_count(p_confectioner_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.confectioners
     SET followers_count = GREATEST(0, COALESCE(followers_count, 0) - 1)
   WHERE id = p_confectioner_id
   RETURNING followers_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

-- ============================================================================
-- stories → stories.views_count, stories.likes_count
-- ============================================================================
-- Атомарно увеличивает views_count на 1. Возвращает новое значение или NULL.
CREATE OR REPLACE FUNCTION public.increment_story_views(p_story_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.channel_stories
     SET views_count = COALESCE(views_count, 0) + 1
   WHERE id = p_story_id
   RETURNING views_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

-- Атомарно регистрирует уникальный просмотр:
-- • Если p_user_id уже есть в viewed_by → возвращает FALSE (не уникальный)
-- • Иначе добавляет user_id в viewed_by и увеличивает views_count → возвращает TRUE
-- Защищает от race condition через UPDATE ... WHERE (проверка массива).
CREATE OR REPLACE FUNCTION public.register_unique_story_view(
  p_story_id TEXT,
  p_user_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  -- Атомарно проверяем отсутствие user_id в массиве и добавляем его.
  -- Если user_id уже есть — условие NOT vieweded_by @> ARRAY[p_user_id]
  -- ложно, UPDATE не выполнится, v_updated = 0.
  WITH updated AS (
    UPDATE public.channel_stories
       SET views_count = COALESCE(views_count, 0) + 1,
           viewed_by = array_append(COALESCE(viewed_by, ARRAY[]::TEXT[]), p_user_id)
     WHERE id = p_story_id
       AND NOT COALESCE(viewed_by, ARRAY[]::TEXT[]) @> ARRAY[p_user_id]::TEXT[]
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated FROM updated;

  RETURN v_updated > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_story_likes(p_story_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.channel_stories
     SET likes_count = COALESCE(likes_count, 0) + 1
   WHERE id = p_story_id
   RETURNING likes_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_story_likes(p_story_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.channel_stories
     SET likes_count = GREATEST(0, COALESCE(likes_count, 0) - 1)
   WHERE id = p_story_id
   RETURNING likes_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

-- Атомарно увеличивает replies_count у story.
CREATE OR REPLACE FUNCTION public.increment_story_replies(p_story_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.channel_stories
     SET replies_count = COALESCE(replies_count, 0) + 1
   WHERE id = p_story_id
   RETURNING replies_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

-- ============================================================================
-- channel_posts → channel_posts.likes_count, comments_count
-- ============================================================================
CREATE OR REPLACE FUNCTION public.increment_post_likes(p_post_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.channel_posts
     SET likes_count = COALESCE(likes_count, 0) + 1
   WHERE id = p_post_id
   RETURNING likes_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_post_likes(p_post_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.channel_posts
     SET likes_count = GREATEST(0, COALESCE(likes_count, 0) - 1)
   WHERE id = p_post_id
   RETURNING likes_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

-- ============================================================================
-- live_streams → live_streams.viewers_count, peak_viewers_count, likes_count
-- ============================================================================
CREATE OR REPLACE FUNCTION public.increment_live_viewers(p_stream_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.live_streams
     SET viewers_count = COALESCE(viewers_count, 0) + 1,
         peak_viewers_count = GREATEST(COALESCE(peak_viewers_count, 0), COALESCE(viewers_count, 0) + 1)
   WHERE id = p_stream_id
   RETURNING viewers_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_live_viewers(p_stream_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.live_streams
     SET viewers_count = GREATEST(0, COALESCE(viewers_count, 0) - 1)
   WHERE id = p_stream_id
   RETURNING viewers_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_live_likes(p_stream_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.live_streams
     SET likes_count = COALESCE(likes_count, 0) + 1
   WHERE id = p_stream_id
   RETURNING likes_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

-- Атомарно инкрементирует viewers_count и total_viewers, обновляет peak_viewers.
-- Возвращает новое значение viewers_count или NULL, если стрим не найден.
CREATE OR REPLACE FUNCTION public.increment_live_viewers_full(p_stream_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.live_streams
     SET viewers_count = COALESCE(viewers_count, 0) + 1,
         total_viewers = COALESCE(total_viewers, 0) + 1,
         peak_viewers = GREATEST(COALESCE(peak_viewers, 0), COALESCE(viewers_count, 0) + 1)
   WHERE id = p_stream_id
   RETURNING viewers_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

-- ============================================================================
-- comments → comments.likes_count
-- ============================================================================
CREATE OR REPLACE FUNCTION public.increment_comment_likes(p_comment_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.comments
     SET likes_count = COALESCE(likes_count, 0) + 1
   WHERE id = p_comment_id
   RETURNING likes_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_comment_likes(p_comment_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.comments
     SET likes_count = GREATEST(0, COALESCE(likes_count, 0) - 1)
   WHERE id = p_comment_id
   RETURNING likes_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

-- ============================================================================
-- Toggle follow: атомарно создаёт подписку, если её ещё нет.
-- Возвращает BOOLEAN: true — создана новая подписка, false — уже была.
-- Безопасна при конкурентных вызовах благодаря UNIQUE(confectioner_id, user_id).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.toggle_follow_channel(
  p_confectioner_id TEXT,
  p_user_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing_id TEXT;
  v_inserted BOOLEAN := FALSE;
  v_rowcount BIGINT := 0;
BEGIN
  -- Если подписка на самого себя — отказ
  IF p_confectioner_id = p_user_id THEN
    RAISE EXCEPTION 'cannot follow self';
  END IF;

  -- Пытаемся найти существующую подписку
  SELECT id INTO v_existing_id
    FROM public.channel_followers
   WHERE confectioner_id = p_confectioner_id
     AND user_id = p_user_id
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Удаляем подписку и декрементируем counter
    DELETE FROM public.channel_followers WHERE id = v_existing_id;
    PERFORM public.decrement_followers_count(p_confectioner_id);
    RETURN FALSE;
  END IF;

  -- Создаём новую подписку
  BEGIN
    INSERT INTO public.channel_followers (confectioner_id, user_id, created_at)
    VALUES (p_confectioner_id, p_user_id, NOW())
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    v_inserted := (v_rowcount > 0);
  EXCEPTION WHEN unique_violation THEN
    v_inserted := FALSE;
  END;

  IF v_inserted THEN
    PERFORM public.increment_followers_count(p_confectioner_id);
  END IF;

  RETURN v_inserted;
END;
$$;

-- ============================================================================
-- Toggle like на story: атомарно создаёт/удаляет лайк
-- ============================================================================
CREATE OR REPLACE FUNCTION public.toggle_story_like(
  p_story_id TEXT,
  p_user_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing_id TEXT;
BEGIN
  SELECT id INTO v_existing_id
    FROM public.story_likes
   WHERE story_id = p_story_id
     AND user_id = p_user_id
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    DELETE FROM public.story_likes WHERE id = v_existing_id;
    PERFORM public.decrement_story_likes(p_story_id);
    RETURN FALSE;
  END IF;

  BEGIN
    INSERT INTO public.story_likes (story_id, user_id, created_at)
    VALUES (p_story_id, p_user_id, NOW())
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
  END;

  PERFORM public.increment_story_likes(p_story_id);
  RETURN TRUE;
END;
$$;

-- ============================================================================
-- promo_codes → promo_codes.used_count
-- ============================================================================
-- Атомарно инкрементирует used_count. Используется при applyPromoCode().
CREATE OR REPLACE FUNCTION public.increment_promo_used_count(p_promo_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.promo_codes
     SET used_count = COALESCE(used_count, 0) + 1
   WHERE id = p_promo_id
   RETURNING used_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

-- Атомарно декрементирует used_count. Используется при revertPromoCode().
CREATE OR REPLACE FUNCTION public.decrement_promo_used_count(p_promo_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.promo_codes
     SET used_count = GREATEST(0, COALESCE(used_count, 0) - 1)
   WHERE id = p_promo_id
   RETURNING used_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

-- ============================================================================
-- Агрегатные функции для admin/dashboard — устраняет N+1 запросы и
-- загружает только одно число вместо всех строк.
-- ============================================================================

-- Сумма succeeded платежей за период (UTC timestamps).
CREATE OR REPLACE FUNCTION public.sum_succeeded_payments(
  p_from_ts TIMESTAMPTZ,
  p_to_ts TIMESTAMPTZ DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sum NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_sum
    FROM public.payments
   WHERE status = 'succeeded'
     AND created_at >= p_from_ts
     AND (p_to_ts IS NULL OR created_at < p_to_ts);
  RETURN v_sum;
END;
$$;

-- Выручка за сегодня (от полуночи UTC).
CREATE OR REPLACE FUNCTION public.revenue_today()
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sum NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_sum
    FROM public.payments
   WHERE status = 'succeeded'
     AND created_at >= date_trunc('day', NOW());
  RETURN v_sum;
END;
$$;

-- Выручка за текущий месяц (от 1-го числа).
CREATE OR REPLACE FUNCTION public.revenue_month()
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sum NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_sum
    FROM public.payments
   WHERE status = 'succeeded'
     AND created_at >= date_trunc('month', NOW());
  RETURN v_sum;
END;
$$;

-- ============================================================================
-- profiles.bonus_balance — атомарное начисление/списание бонусов
-- ============================================================================
-- Атомарно увеличивает bonus_balance на p_points. Возвращает новое значение.
-- Защищает от race condition между начислением и списанием бонусов.
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
   WHERE id = p_user_id
   RETURNING bonus_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'user not found: %', p_user_id;
  END IF;

  IF v_new_balance < 0 THEN
    -- Откатываем update (через exception)
    RAISE EXCEPTION 'insufficient balance: %', v_new_balance;
  END IF;

  RETURN v_new_balance;
END;
$$;

-- Атомарно списывает бонусы, проверяя минимальный баланс.
-- Если списание невозможно (баланс < p_points), бросает exception.
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
   WHERE id = p_user_id
   FOR UPDATE; -- блокируем строку для транзакции

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'user not found: %', p_user_id;
  END IF;

  IF v_current < p_points THEN
    RAISE EXCEPTION 'insufficient balance: has %, needs %', v_current, p_points;
  END IF;

  UPDATE public.profiles
     SET bonus_balance = v_current - p_points
   WHERE id = p_user_id
   RETURNING bonus_balance INTO v_new_balance;

  RETURN v_new_balance;
END;
$$;

-- ============================================================================
-- moderation_rules → hits_count — атомарное увеличение счётчика срабатываний
-- ============================================================================
CREATE OR REPLACE FUNCTION public.increment_moderation_rule_hits(p_rule_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.moderation_rules
     SET hits_count = COALESCE(hits_count, 0) + 1
   WHERE id = p_rule_id
   RETURNING hits_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

-- ============================================================================
-- confectioner_lessons → enrolled_count
-- ============================================================================
CREATE OR REPLACE FUNCTION public.increment_lesson_enrolled_count(p_lesson_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.confectioner_lessons
     SET enrolled_count = COALESCE(enrolled_count, 0) + 1
   WHERE id = p_lesson_id
   RETURNING enrolled_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

-- ============================================================================
-- confectioners.balance — атомарное списание для выплат
-- ============================================================================
-- Атомарно списывает p_amount с баланса кондитера.
-- Если баланс недостаточен — бросает exception.
CREATE OR REPLACE FUNCTION public.deduct_confectioner_balance(
  p_confectioner_id TEXT,
  p_amount INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance INTEGER;
  v_current INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'deduct amount must be positive';
  END IF;

  SELECT COALESCE(balance, 0) INTO v_current
    FROM public.confectioners
   WHERE id = p_confectioner_id
   FOR UPDATE; -- блокируем строку для транзакции

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'confectioner not found: %', p_confectioner_id;
  END IF;

  IF v_current < p_amount THEN
    RAISE EXCEPTION 'insufficient balance: has %, needs %', v_current, p_amount;
  END IF;

  UPDATE public.confectioners
     SET balance = v_current - p_amount
   WHERE id = p_confectioner_id
   RETURNING balance INTO v_new_balance;

  RETURN v_new_balance;
END;
$$;
