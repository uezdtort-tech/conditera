-- ============================================================================
-- 0066_recipe_children.sql — RECIPE-02 (Этап B, RB.17/RA.17.2, RB.16)
--
-- Дочерние сущности контентной модели рецепта:
--   1. recipe_steps                  — нормализация шагов (§F.5), UNIQUE(id, recipe_id)
--                                      как цель составного FK медиа (ПР-8, RA.16.2);
--   2. recipe_media                  — единая медиа-сущность (§F.2) с составным
--                                      FK (step_id, recipe_id) → recipe_steps;
--   3. recipe_ingredient_substitutes — варианты замены ингредиента (§F.4);
--   4. recipe_variants               — варианты рецепта (§F.6);
--   5. recipe_sources                — происхождение и права (§F.7, RA.13);
--   6. recipe_versions               — неизменяемые publish-снапшоты (§F.8,
--                                      RB.16 явно закрепляет за 0066);
--
-- RLS (RB.16, обязательное):
--   • ENABLE RLS на всех таблицах; GRANT anon/authenticated НЕ выдаётся
--     (дисциплина НФ-1/НФ-2, весь доступ через API-слой; платформенные
--     compat-дефолты дают ALL только service_role);
--   • SELECT — по родительскому рецепту (published/author); recipe_sources —
--     author+ADMIN; recipe_versions — author/ADMIN/покупатель (SELECT-only);
--   • мутации — автор родительского рецепта; recipe_media DELETE — автор/админ;
--   • recipe_versions — БЕЗ INSERT/UPDATE/DELETE политик вообще
--     (иммутабельные снапшоты; запись только через service_role).
--
-- Идемпотентность (НФ-3/НФ-4): CREATE TABLE IF NOT EXISTS (inline-констрейнты
-- создаются атомарно вместе с таблицей), CREATE INDEX IF NOT EXISTS,
-- политики — DO-гварды pg_policies (прецедент 0053/0054).
--
-- NOTE (интерпретация спецификации, задокументировано в отчёте RECIPE-02):
-- составной FK медиа использует ON DELETE CASCADE — частичный SET NULL
-- (только step_id) в составном FK невозможен при NOT NULL recipe_id
-- (§F.2 формулировка «SET NULL» относится к простому FK и вытеснена
-- более поздним ПР-8/RA.16.2: составной FK для целостности «шаг ↔ свой рецепт»).
-- ============================================================================

-- ============================================================================
-- 1. recipe_steps — шаги приготовления (§F.5)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recipe_steps (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id     UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  position      INT  NOT NULL,
  title         TEXT,
  description   TEXT NOT NULL,
  time_min      INT,
  time_max      INT,
  temperature_c INT,
  tips          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Цель составного FK recipe_media(step_id, recipe_id) — ПР-8/RA.16.2 (RB.13 прим.1)
  CONSTRAINT uq_recipe_steps_id_recipe UNIQUE (id, recipe_id),
  -- Целостность порядка шагов внутри рецепта (§F.5: индекс (recipe_id, position) UNIQUE)
  CONSTRAINT uq_recipe_steps_recipe_position UNIQUE (recipe_id, position)
);

COMMENT ON TABLE public.recipe_steps IS 'RECIPE-02: нормализованные шаги рецепта (нормализация steps_json, §F.5)';

ALTER TABLE public.recipe_steps ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_steps' AND policyname = 'recipe_steps_select') THEN
    CREATE POLICY recipe_steps_select ON public.recipe_steps
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_steps.recipe_id
             AND (r.status = 'published' OR r.author_id = auth.uid())
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_steps' AND policyname = 'recipe_steps_write_own') THEN
    CREATE POLICY recipe_steps_write_own ON public.recipe_steps
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_steps.recipe_id
             AND r.author_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_steps.recipe_id
             AND r.author_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recipe_steps_recipe ON public.recipe_steps (recipe_id, position);

-- ============================================================================
-- 2. recipe_media — единая медиа-сущность (§F.2, RA.16)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recipe_media (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id    UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  type         TEXT NOT NULL
               CHECK (type IN ('cover','gallery','result_photo','cross_section','step','video','ai_preview')),
  url          TEXT NOT NULL,
  storage_path TEXT,
  position     INT,
  caption      TEXT,
  origin       TEXT NOT NULL DEFAULT 'author_upload'
               CHECK (origin IN ('author_upload','imported','ai_generated')),
  ai_generated BOOLEAN NOT NULL DEFAULT false,
  -- Составной FK ПР-8: медиа можно привязать ТОЛЬКО к шагу СВОЕГО рецепта.
  -- ON DELETE CASCADE: удаление шага удаляет его медиа (частичный SET NULL
  -- невозможен при NOT NULL recipe_id — см. NOTE в шапке файла).
  step_id      UUID,
  alt_text     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_recipe_media_step_recipe
    FOREIGN KEY (step_id, recipe_id)
    REFERENCES public.recipe_steps (id, recipe_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.recipe_media IS 'RECIPE-02: единая медиа-сущность рецепта (замена URL-строк в JSONB; §F.2/RA.16)';
COMMENT ON CONSTRAINT fk_recipe_media_step_recipe ON public.recipe_media IS 'ПР-8: невозможно привязать медиа к шагу чужого рецепта';

ALTER TABLE public.recipe_media ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_media' AND policyname = 'recipe_media_select') THEN
    CREATE POLICY recipe_media_select ON public.recipe_media
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_media.recipe_id
             AND (r.status = 'published' OR r.author_id = auth.uid())
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_media' AND policyname = 'recipe_media_insert_own') THEN
    CREATE POLICY recipe_media_insert_own ON public.recipe_media
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_media.recipe_id
             AND r.author_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_media' AND policyname = 'recipe_media_update_own') THEN
    CREATE POLICY recipe_media_update_own ON public.recipe_media
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_media.recipe_id
             AND r.author_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_media.recipe_id
             AND r.author_id = auth.uid()
        )
      );
  END IF;

  -- DELETE: автор рецепта ИЛИ админ (RB.16, колонка DELETE для recipe_media)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_media' AND policyname = 'recipe_media_delete_own_admin') THEN
    CREATE POLICY recipe_media_delete_own_admin ON public.recipe_media
      FOR DELETE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_media.recipe_id
             AND (r.author_id = auth.uid()
               OR EXISTS (
                 SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = auth.uid()
                    AND ur.role IN ('ADMIN','SUPER_ADMIN')
                    AND ur.is_active
               ))
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recipe_media_recipe ON public.recipe_media (recipe_id, position);

-- Частичный индекс «ИИ-фото не считается доказательством реального блюда» (§F.2)
CREATE INDEX IF NOT EXISTS idx_recipe_media_ai_generated
  ON public.recipe_media (recipe_id) WHERE ai_generated;

-- ============================================================================
-- 3. recipe_ingredient_substitutes — замены ингредиента (§F.4)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recipe_ingredient_substitutes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ingredient_id UUID NOT NULL REFERENCES public.recipe_ingredients(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  qty           NUMERIC(12,3),
  unit          TEXT,
  position      INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.recipe_ingredient_substitutes IS 'RECIPE-02: варианты замены ингредиента (RLS по родительскому рецепту, §F.4)';

ALTER TABLE public.recipe_ingredient_substitutes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_ingredient_substitutes' AND policyname = 'recipe_ingredient_substitutes_select') THEN
    CREATE POLICY recipe_ingredient_substitutes_select ON public.recipe_ingredient_substitutes
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
            FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
           WHERE ri.id = recipe_ingredient_substitutes.ingredient_id
             AND (r.status = 'published' OR r.author_id = auth.uid())
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_ingredient_substitutes' AND policyname = 'recipe_ingredient_substitutes_write_own') THEN
    CREATE POLICY recipe_ingredient_substitutes_write_own ON public.recipe_ingredient_substitutes
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1
            FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
           WHERE ri.id = recipe_ingredient_substitutes.ingredient_id
             AND r.author_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
            FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
           WHERE ri.id = recipe_ingredient_substitutes.ingredient_id
             AND r.author_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recipe_ingredient_substitutes_ingredient
  ON public.recipe_ingredient_substitutes (ingredient_id, position);

-- ============================================================================
-- 4. recipe_variants — варианты рецепта (§F.6, прагматичное JSONB-ядро)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recipe_variants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id   UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  -- overrides = [{ingredient_id, action: replace|add|remove|set_qty, name?, qty?, unit?}]
  overrides   JSONB NOT NULL DEFAULT '[]'::jsonb,
  servings    INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.recipe_variants IS 'RECIPE-02: варианты рецепта («На халлуми»), overrides-JSONB по потребности (§F.6)';

ALTER TABLE public.recipe_variants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_variants' AND policyname = 'recipe_variants_select') THEN
    CREATE POLICY recipe_variants_select ON public.recipe_variants
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_variants.recipe_id
             AND (r.status = 'published' OR r.author_id = auth.uid())
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_variants' AND policyname = 'recipe_variants_write_own') THEN
    CREATE POLICY recipe_variants_write_own ON public.recipe_variants
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_variants.recipe_id
             AND r.author_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_variants.recipe_id
             AND r.author_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recipe_variants_recipe ON public.recipe_variants (recipe_id);

-- ============================================================================
-- 5. recipe_sources — происхождение и права (§F.7, RA.13)
--    raw_payload закрыт всем, кроме автора и админа; rights_confirmed
--    по умолчанию false — публикация импорта гейтится API-слоем (RECIPE-06)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recipe_sources (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id           UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  source_type         TEXT NOT NULL
                      CHECK (source_type IN ('telegram','vk','site','document','manual')),
  source_url          TEXT,
  source_author       TEXT,
  source_published_at TIMESTAMPTZ,
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  import_method       TEXT CHECK (import_method IN ('ai','manual')),
  -- Исходный payload для аудита; рекламные вставки живут ТОЛЬКО здесь,
  -- никогда — в steps/ingredients (§F.7)
  raw_payload         JSONB,
  rights_confirmed    BOOLEAN NOT NULL DEFAULT false,
  rights_note         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_recipe_sources_recipe_url UNIQUE (recipe_id, source_url)
);

COMMENT ON TABLE public.recipe_sources IS 'RECIPE-02: происхождение и права на контент; rights_confirmed=false по умолчанию (RA.13)';

ALTER TABLE public.recipe_sources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- SELECT: только автор и админ (RB.16; raw_payload закрыт всем прочим)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_sources' AND policyname = 'recipe_sources_select_own_admin') THEN
    CREATE POLICY recipe_sources_select_own_admin ON public.recipe_sources
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_sources.recipe_id
             AND (r.author_id = auth.uid()
               OR EXISTS (
                 SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = auth.uid()
                    AND ur.role IN ('ADMIN','SUPER_ADMIN')
                    AND ur.is_active
               ))
        )
      );
  END IF;

  -- INSERT/DELETE: только автор
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_sources' AND policyname = 'recipe_sources_insert_own') THEN
    CREATE POLICY recipe_sources_insert_own ON public.recipe_sources
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_sources.recipe_id
             AND r.author_id = auth.uid()
        )
      );
  END IF;

  -- UPDATE: автор, до публикации рецепта (RB.16 «автор (до publish)»);
  -- правки после публикации — через service_role (API)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_sources' AND policyname = 'recipe_sources_update_own_unpublished') THEN
    CREATE POLICY recipe_sources_update_own_unpublished ON public.recipe_sources
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_sources.recipe_id
             AND r.author_id = auth.uid()
             AND r.status <> 'published'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_sources.recipe_id
             AND r.author_id = auth.uid()
             AND r.status <> 'published'
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_sources' AND policyname = 'recipe_sources_delete_own') THEN
    CREATE POLICY recipe_sources_delete_own ON public.recipe_sources
      FOR DELETE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_sources.recipe_id
             AND r.author_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recipe_sources_recipe ON public.recipe_sources (recipe_id);

-- ============================================================================
-- 6. recipe_versions — неизменяемые снапшоты публикаций (§F.8, RB.16)
--    SELECT-only для authenticated (автор/админ/покупатель активной покупки);
--    INSERT/UPDATE/DELETE политик НЕТ — запись только через service_role
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recipe_versions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id  UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  version_no INT  NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changelog  TEXT,
  -- Полный normalized-снимок рецепта на момент публикации (история воспроизводима)
  snapshot   JSONB NOT NULL,
  origin     TEXT NOT NULL DEFAULT 'publish'
             CHECK (origin IN ('publish','production_approve','manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_recipe_versions_recipe_version UNIQUE (recipe_id, version_no)
);

COMMENT ON TABLE public.recipe_versions IS 'RECIPE-02: неизменяемые снапшоты рецепта; иммутабельность = отсутствие мутационных RLS-политик (§F.8, RB.13 прим.4)';

ALTER TABLE public.recipe_versions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- SELECT-only: автор / админ / покупатель активной покупки своей версии (RB.16)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_versions' AND policyname = 'recipe_versions_select') THEN
    CREATE POLICY recipe_versions_select ON public.recipe_versions
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.recipes r
           WHERE r.id = recipe_versions.recipe_id
             AND (r.author_id = auth.uid()
               OR EXISTS (
                 SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = auth.uid()
                    AND ur.role IN ('ADMIN','SUPER_ADMIN')
                    AND ur.is_active
               )
               OR EXISTS (
                 SELECT 1 FROM public.recipe_purchases p
                  WHERE p.recipe_id = recipe_versions.recipe_id
                    AND p.buyer_id = auth.uid()
                    AND p.is_active = true
               ))
        )
      );
  END IF;
  -- Намеренно НЕТ политик INSERT/UPDATE/DELETE (RB.16: «политик
  -- INSERT/UPDATE/DELETE нет (только service_role)»)
END $$;

CREATE INDEX IF NOT EXISTS idx_recipe_versions_created_by ON public.recipe_versions (created_by);

-- ============================================================================
-- ROLLBACK PLAN (RA.17; выполняется вручную, порядок обратный применению)
-- ============================================================================
-- DROP INDEX IF EXISTS idx_recipe_versions_created_by;
-- DROP POLICY IF EXISTS recipe_versions_select ON public.recipe_versions;
-- DROP TABLE IF EXISTS public.recipe_versions CASCADE;
-- DROP INDEX IF EXISTS idx_recipe_sources_recipe;
-- DROP POLICY IF EXISTS recipe_sources_select_own_admin ON public.recipe_sources;
-- DROP POLICY IF EXISTS recipe_sources_insert_own ON public.recipe_sources;
-- DROP POLICY IF EXISTS recipe_sources_update_own_unpublished ON public.recipe_sources;
-- DROP POLICY IF EXISTS recipe_sources_delete_own ON public.recipe_sources;
-- DROP TABLE IF EXISTS public.recipe_sources CASCADE;
-- DROP INDEX IF EXISTS idx_recipe_variants_recipe;
-- DROP POLICY IF EXISTS recipe_variants_select ON public.recipe_variants;
-- DROP POLICY IF EXISTS recipe_variants_write_own ON public.recipe_variants;
-- DROP TABLE IF EXISTS public.recipe_variants CASCADE;
-- DROP INDEX IF EXISTS idx_recipe_ingredient_substitutes_ingredient;
-- DROP POLICY IF EXISTS recipe_ingredient_substitutes_select ON public.recipe_ingredient_substitutes;
-- DROP POLICY IF EXISTS recipe_ingredient_substitutes_write_own ON public.recipe_ingredient_substitutes;
-- DROP TABLE IF EXISTS public.recipe_ingredient_substitutes CASCADE;
-- DROP INDEX IF EXISTS idx_recipe_media_ai_generated;
-- DROP INDEX IF EXISTS idx_recipe_media_recipe;
-- DROP POLICY IF EXISTS recipe_media_select ON public.recipe_media;
-- DROP POLICY IF EXISTS recipe_media_insert_own ON public.recipe_media;
-- DROP POLICY IF EXISTS recipe_media_update_own ON public.recipe_media;
-- DROP POLICY IF EXISTS recipe_media_delete_own_admin ON public.recipe_media;
-- DROP TABLE IF EXISTS public.recipe_media CASCADE;
-- DROP INDEX IF EXISTS idx_recipe_steps_recipe;
-- DROP POLICY IF EXISTS recipe_steps_select ON public.recipe_steps;
-- DROP POLICY IF EXISTS recipe_steps_write_own ON public.recipe_steps;
-- DROP TABLE IF EXISTS public.recipe_steps CASCADE;
