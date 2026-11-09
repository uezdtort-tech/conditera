-- ============================================================================
-- 0069_recipe_jsonb_normalization.sql — RECIPE-02 (Этап B, RB.17/RA.17.5)
--
-- Скрипт двойной записи: нормализация замороженного JSONB-состава офферов в
-- дочерние сущности 0066/0053 — ТОЛЬКО для строк с recipe_id (после 0068).
--
-- Идемпотентность: каждая фаза обрабатывает только рецепты БЕЗ соответствующих
-- детей (WHERE NOT EXISTS по children) — повторный прогон no-op; частично
-- обработанное состояние самолечится (фазы независимы, у каждой своя гварда).
--
-- Порядок шагов — по позиции элемента массива (WITH ORDINALITY), без кастов
-- step_number (защита от нечисловых значений и дублей).
--
-- D5-заглушки (quality_flag='stub' по RB.17): строки, чей состав является
-- заглушкой формы разработчика (audit D5: пустые имена ингредиентов или
-- пустые описания шагов) — НЕ нормализуются и снимаются с публикации:
-- status='draft' (носитель маркировки БЕЗ DDL-изменений: RB.17 0069
-- «без DDL-изменений»; legacy_content_mdx уже true с 0068). Исходный JSONB
-- не изменяется — контролируемое восстановление возможно (ROLLBACK PLAN).
-- Интерпретация задокументирована в отчёте RECIPE-02.
-- ============================================================================

-- ============================================================================
-- 1. steps_json → recipe_steps (гварда: у рецепта ещё нет шагов)
-- ============================================================================
INSERT INTO public.recipe_steps (recipe_id, position, title, description)
SELECT
  m.recipe_id,
  s.ord,                       -- позиция = порядковый номер элемента массива
  NULL,
  s.e->>'description'
FROM public.recipe_marketplace m
CROSS JOIN LATERAL (
  SELECT e, ord
  FROM jsonb_array_elements(COALESCE(m.steps_json, '[]'::jsonb))
       WITH ORDINALITY AS t(e, ord)
) s
WHERE m.recipe_id IS NOT NULL
  AND NULLIF(btrim(COALESCE(s.e->>'description', '')), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.recipe_steps rs
     WHERE rs.recipe_id = m.recipe_id
  );

-- ============================================================================
-- 2. Шаговые медиа (image/video_url) → recipe_media, type='step',
--    origin='imported'. Связка по позиции элемента (той же, что в фазе 1).
--    Гварда: у рецепта ещё нет шаговых медиа.
-- ============================================================================
INSERT INTO public.recipe_media (recipe_id, step_id, type, url, origin, position)
SELECT
  st.recipe_id,
  st.id,
  'step',
  v.url,
  'imported',
  st.position
FROM public.recipe_marketplace m
JOIN public.recipe_steps st
  ON st.recipe_id = m.recipe_id
CROSS JOIN LATERAL (
  SELECT e
  FROM jsonb_array_elements(COALESCE(m.steps_json, '[]'::jsonb))
       WITH ORDINALITY AS t(e, ord)
  WHERE ord = st.position
) se
CROSS JOIN LATERAL (
  SELECT COALESCE(
           NULLIF(btrim(COALESCE(se.e->>'image', '')), ''),
           NULLIF(btrim(COALESCE(se.e->>'video_url', '')), '')
         ) AS url
) v
WHERE m.recipe_id IS NOT NULL
  AND v.url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.recipe_media rm
     WHERE rm.recipe_id = m.recipe_id
       AND rm.type = 'step'
  );

-- ============================================================================
-- 3. ingredients_json → recipe_ingredients
--    Гварда: у рецепта ещё нет ингредиентов.
--    qty: безопасный разбор (число / числовая строка; иначе NULL — «по вкусу»).
--    unit: как в источнике, fallback 'шт' (канон г/мл/шт; display-only единицы
--    сохраняются как есть — автоконверсия запрещена, Q-2 RESOLVED).
-- ============================================================================
INSERT INTO public.recipe_ingredients
  (recipe_id, name, qty, unit, sort_order, position)
SELECT
  m.recipe_id,
  i.e->>'name',
  CASE
    WHEN i.e->>'qty' IS NULL THEN NULL
    WHEN btrim(i.e->>'qty') ~ '^[0-9]+([.,][0-9]+)?$'
      THEN replace(btrim(i.e->>'qty'), ',', '.')::numeric
    ELSE NULL
  END,
  COALESCE(NULLIF(btrim(COALESCE(i.e->>'unit', '')), ''), 'шт'),
  i.ord - 1,
  i.ord
FROM public.recipe_marketplace m
CROSS JOIN LATERAL (
  SELECT e, ord
  FROM jsonb_array_elements(COALESCE(m.ingredients_json, '[]'::jsonb))
       WITH ORDINALITY AS t(e, ord)
) i
WHERE m.recipe_id IS NOT NULL
  AND NULLIF(btrim(COALESCE(i.e->>'name', '')), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.recipe_ingredients ri
     WHERE ri.recipe_id = m.recipe_id
  );

-- ============================================================================
-- 4. D5-заглушки: маркировка quality_flag='stub' → (status='draft');
--    дети не создаются (гварды фаз 1–3 отсекли пустой состав).
-- ============================================================================
WITH stub_offers AS (
  SELECT m.recipe_id
  FROM public.recipe_marketplace m
  WHERE m.recipe_id IS NOT NULL
    AND (
      (COALESCE(m.ingredients_json, '[]'::jsonb) = '[]'::jsonb
       OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(m.ingredients_json,'[]'::jsonb)) e
          WHERE NULLIF(btrim(COALESCE(e->>'name','')), '') IS NOT NULL
       ))
      OR
      (COALESCE(m.steps_json, '[]'::jsonb) = '[]'::jsonb
       OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(m.steps_json,'[]'::jsonb)) e
          WHERE NULLIF(btrim(COALESCE(e->>'description','')), '') IS NOT NULL
       ))
    )
)
UPDATE public.recipes r
   SET status = 'draft'
 WHERE r.id IN (SELECT recipe_id FROM stub_offers)
   AND r.legacy_content_mdx = true;

-- ============================================================================
-- ROLLBACK PLAN (RA.17; контролируемое восстановление исходного состояния)
-- ============================================================================
-- Исходный JSONB сохранён (не очищался) — восстановление = удаление созданных
-- детей у legacy-строк бэкфилла + ручной возврат статусов:
-- DELETE FROM public.recipe_media rm
--  USING public.recipes r
--  WHERE rm.recipe_id = r.id AND r.legacy_content_mdx = true AND r.slug LIKE 'offer-%';
-- DELETE FROM public.recipe_ingredients ri
--  USING public.recipes r
--  WHERE ri.recipe_id = r.id AND r.legacy_content_mdx = true AND r.slug LIKE 'offer-%';
-- DELETE FROM public.recipe_steps rs
--  USING public.recipes r
--  WHERE rs.recipe_id = r.id AND r.legacy_content_mdx = true AND r.slug LIKE 'offer-%';
-- UPDATE public.recipes r SET status = 'published'
--  FROM public.recipe_marketplace m
--  WHERE m.recipe_id = r.id AND r.legacy_content_mdx = true AND m.is_published = true;
