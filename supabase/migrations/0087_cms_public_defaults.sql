-- ============================================================================
-- 0087_cms_public_defaults.sql — CMS: публичные дефолты настроек и чистка
-- данных (план «CMS-доработки», шаги 1–3).
--
-- Контекст: публичный рендер cms_pages (use-published-cms-page),
-- блоков главной (use-published-home-blocks) и навигации
-- (use-published-nav-menu), а также бренд-ключи site_settings
-- (brand_accent_color/brand_logo_url → BrandThemeApplier) уже подключены в
-- коде и API (/api/cms/*). Эта миграция приводит ДАННЫЕ в состояние, при
-- котором админ видит редактируемые ключи, а публичка осмысленно деградирует
-- на системные фолбэки, пока значения пустые:
--
--   1) cms_pages: сиды ранних миграций вставляли контент с ЛИТЕРАЛЬНЫМИ
--      '\n' (backslash + n вместо перевода строки) — react-markdown рендерил
--      страницу одной строкой. Чиним на настоящий LF (chr(10)).
--      Идемпотентно: после первого прогона strpos не находит вхождений.
--   2) cms_pages: жёстко удаляем soft-deleted артефакт e2e-прогона
--      (slug 'e2e-test-page').
--   3) site_settings: чистим тестовые значения e2e-прогонов (тестовый акцент
--      #047857, unsplash-лого, тестовый hero_title) и досеиваем ДЕФОЛТНЫЕ
--      ключи публичных потребителей (hero_*, brand_*) с ПУСТЫМИ значениями:
--      пустое значение = «используется системный фолбэк», админ заполняет
--      ключ в админке («Настройки сайта») и публикует версию.
--   4) cms_versions: если ОПУБЛИКОВАННЫЙ документ настроек ПУСТ (0 строк),
--      он заслоняет легаси-таблицу — GET /api/cms/settings читает ТОЛЬКО
--      опубликованную версию (фолбэк на site_settings не выполняется), и
--      админка показывает «Настройки не найдены». Такой пустой снимок
--      переводим в superseded и публикуем новую версию из актуального
--      снимка site_settings. Публичка после этого по-прежнему показывает
--      фолбэки (значения пустые), но ключи видны и редактируемы.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. cms_pages: литеральные '\n' → настоящие переводы строк.
--    strpos/replace (НЕ LIKE: backslash в LIKE-паттерне — escape-символ).
-- ---------------------------------------------------------------------------
UPDATE public.cms_pages
   SET content = replace(content, chr(92) || 'n', chr(10)),
       updated_at = now()
 WHERE deleted_at IS NULL
   AND strpos(content, chr(92) || 'n') > 0;

-- ---------------------------------------------------------------------------
-- 2. cms_pages: жёсткое удаление soft-deleted e2e-артефакта.
-- ---------------------------------------------------------------------------
DELETE FROM public.cms_pages
 WHERE slug = 'e2e-test-page'
   AND deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. site_settings: чистка e2e-значений + дефолтные ключи публичных
--    потребителей (hero_*, brand_*). Пустое значение — легитимное состояние
--    «фолбэк» (coerceSettingValue сохраняет '', публичные хуки трактуют
--    пустую строку как «ключ не задан»).
-- ---------------------------------------------------------------------------
DELETE FROM public.site_settings
 WHERE (key = 'hero_title'         AND value = 'CMS-заголовок: торты от уездных кондитеров')
    OR (key = 'brand_accent_color' AND value = '#047857')
    OR (key = 'brand_logo_url'     AND value LIKE 'https://images.unsplash.com/%');

INSERT INTO public.site_settings ("id", "key", "value", "category", "description", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'hero_title',
   '', 'general',
   'Заголовок hero-блока главной. Заполните и опубликуйте — включится CMS-герой (пусто: системный герой)',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'hero_subtitle',
   '', 'general',
   'Подзаголовок hero-блока главной',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'hero_cta_label',
   '', 'general',
   'Текст кнопки hero (работает вместе с hero_cta_href)',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'hero_cta_href',
   '', 'general',
   'Ссылка кнопки hero: имя раздела (catalog, promotions) или полный URL',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'hero_image',
   '', 'general',
   'URL изображения hero-блока',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'brand_accent_color',
   '', 'general',
   'Акцентный цвет сайта в формате HEX #rrggbb (пусто: тема по умолчанию). Применяется ко всем кнопкам/ссылкам',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'brand_logo_url',
   '', 'general',
   'URL логотипа для шапки и футера (пусто: системный /logo.png)',
   CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. cms_versions: починка «пустой опубликованной версии, заслоняющей
--    легаси-таблицу». Только если существует published-версия с 0 строками:
--    supersede её и опубликовать снимок site_settings новой версией.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  empty_published_count integer;
  next_version integer;
BEGIN
  SELECT count(*) INTO empty_published_count
    FROM public.cms_versions
   WHERE entity_type = 'site_settings'
     AND entity_id = 'global'
     AND status = 'published'
     AND COALESCE(jsonb_array_length(data -> 'settings'), 0) = 0;

  IF empty_published_count > 0 THEN
    -- 4a. Все пустые published-версии → superseded.
    UPDATE public.cms_versions
       SET status = 'superseded'
     WHERE entity_type = 'site_settings'
       AND entity_id = 'global'
       AND status = 'published'
       AND COALESCE(jsonb_array_length(data -> 'settings'), 0) = 0;

    -- 4b. Новая published-версия = актуальный снимок site_settings.
    SELECT COALESCE(MAX(version), 0) + 1 INTO next_version
      FROM public.cms_versions
     WHERE entity_type = 'site_settings'
       AND entity_id = 'global';

    INSERT INTO public.cms_versions
      (entity_type, entity_id, version, data, status, comment)
    SELECT
      'site_settings',
      'global',
      next_version,
      jsonb_build_object(
        'settings',
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id',          gen_random_uuid()::text,
              'key',         s."key",
              'value',       s."value",
              'category',    s."category",
              'description', s."description"
            )
            ORDER BY s."key"
          ),
          '[]'::jsonb
        )
      ),
      'published',
      'Миграция 0087: публикация дефолтных ключей настроек (снимок site_settings)'
    FROM public.site_settings s;
  END IF;
END $$;
