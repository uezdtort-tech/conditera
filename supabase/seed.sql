-- ====================================================================
-- seed.sql — начальные данные (28 категорий)
-- ====================================================================

-- 28 категорий (20 кондитерских + 8 сопутствующих)
INSERT INTO public.product_categories (slug, name, icon, group_name, link, sort_order)
VALUES
  -- 20 кондитерских изделий
  ('cakes', 'Торты', '🎂', 'Кондитерские изделия', NULL, 1),
  ('cupcakes', 'Капкейки', '🧁', 'Кондитерские изделия', NULL, 2),
  ('pastries', 'Пирожные', '🥮', 'Кондитерские изделия', NULL, 3),
  ('cookies', 'Печенье', '🍪', 'Кондитерские изделия', NULL, 4),
  ('chocolate', 'Шоколад', '🍫', 'Кондитерские изделия', NULL, 5),
  ('macarons', 'Макаронс', '🌸', 'Кондитерские изделия', NULL, 6),
  ('bento', 'Бенто-торты', '🍱', 'Кондитерские изделия', NULL, 7),
  ('desserts', 'Десерты', '🍰', 'Кондитерские изделия', NULL, 8),
  ('zephyr_bouquets', 'Зефирные букеты', '💐', 'Кондитерские изделия', NULL, 9),
  ('pies', 'Пироги', '🥧', 'Кондитерские изделия', NULL, 10),
  ('patties', 'Пирожки', '🥟', 'Кондитерские изделия', NULL, 11),
  ('rolls', 'Рулеты', '🍰', 'Кондитерские изделия', NULL, 12),
  ('healthy', 'ПП изделия', '🥗', 'Кондитерские изделия', NULL, 13),
  ('pastila', 'Пастила', '🍬', 'Кондитерские изделия', NULL, 14),
  ('oriental_sweets', 'Восточные сладости', '🍯', 'Кондитерские изделия', NULL, 15),
  ('candies', 'Конфеты', '🍫', 'Кондитерские изделия', NULL, 16),
  ('marmalade', 'Мармелад', '🍊', 'Кондитерские изделия', NULL, 17),
  ('lollipops', 'Леденцы', '🍭', 'Кондитерские изделия', NULL, 18),
  ('gingerbread', 'Пряники', '🍪', 'Кондитерские изделия', NULL, 19),
  ('realistic_cakes', 'Реалистичные пирожные', '🎭', 'Кондитерские изделия', NULL, 20),
  -- 8 сопутствующих товаров
  ('decor', 'Декор для тортов', '🎀', 'Сопутствующие товары', 'decor-shop', 21),
  ('packaging', 'Упаковка', '📦', 'Сопутствующие товары', 'decor-shop', 22),
  ('ingredients', 'Ингредиенты', '🧂', 'Сопутствующие товары', 'supplier-shop', 23),
  ('equipment', 'Оборудование', '🔧', 'Сопутствующие товары', 'supplier-shop', 24),
  ('tools', 'Инвентарь', '🥄', 'Сопутствующие товары', 'supplier-shop', 25),
  ('services', 'Услуги и площадки', '🎭', 'Сопутствующие товары', 'services-shop', 26),
  ('certificates', 'Подарочные сертификаты', '💳', 'Сопутствующие товары', 'gift-certificates', 27),
  ('edible-printing', 'Печать на пряниках и бумаге', '🖨️', 'Сопутствующие товары', 'services-shop', 28)
ON CONFLICT (slug) DO NOTHING;

-- ====================================================================
-- SEED: Новые роли v2.0 (RECIPE_DEVELOPER, LOYALTY_PARTNER, AI_ASSISTANT)
-- Миграция 0012_new_roles_recipes_loyalty_ai.sql
-- ====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. Стартовые рецепты от RECIPE_DEVELOPER (демо-данные)
-- ─────────────────────────────────────────────────────────────────────
-- ВНИМАНИЕ: author_id — это UUID первого RECIPE_DEVELOPER в системе.
-- В реальном проекте этот UUID подменяется на ID реального пользователя.

INSERT INTO public.recipe_marketplace (
  author_id, title, slug, description,
  base_price, is_premium, premium_price, royalty_rate,
  cooking_time_min, difficulty, tags, preview_image,
  steps_json, ingredients_json,
  views, purchases_count, rating,
  is_published, published_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000001',  -- placeholder RECIPE_DEVELOPER
    'Шоколадный торт «Три шоколада»',
    'shokoladnyy-tort-tri-shokolada',
    'Авторский рецепт многослойного торта с тремя видами шоколада: тёмный, молочный, белый. Идеален для ценителей какао.',
    500.00, FALSE, NULL, 0.05,
    180, 4, ARRAY['chocolate', 'wedding', 'premium'],
    'https://images.unsplash.com/photo-1538680273-84d8563392eb',
    '[{"step_number":1,"description":"Растопите тёмный шоколад на водяной бане"},{"step_number":2,"description":"Взбейте яйца с сахаром до пышной массы"},{"step_number":3,"description":"Соедините шоколад с яичной массой"}]'::jsonb,
    '[{"name":"Тёмный шоколад","qty":"200","unit":"г"},{"name":"Молочный шоколад","qty":"150","unit":"г"},{"name":"Белый шоколад","qty":"100","unit":"г"},{"name":"Масло сливочное","qty":"100","unit":"г"}]'::jsonb,
    1247, 89, 4.8,
    TRUE, NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'Бенто-торт «Лавандовое наслаждение»',
    'bento-tort-lavandovoe-naslazhdenie',
    'Мини-торт с лавандовым кремом и черничным джемом. Идеальный подарок на 14 февраля или день рождения.',
    350.00, FALSE, NULL, 0.07,
    90, 2, ARRAY['lavender', 'bento', 'gift'],
    'https://images.unsplash.com/photo-1565958011703-44f981925b5b',
    '[{"step_number":1,"description":"Приготовьте бисквит в небольшой форме"},{"step_number":2,"description":"Сварите лавандовый крем"},{"step_number":3,"description":"Соберите бенто-торт в коробочке"}]'::jsonb,
    '[{"name":"Мука","qty":"150","unit":"г"},{"name":"Сахар","qty":"100","unit":"г"},{"name":"Лаванда сушёная","qty":"5","unit":"г"},{"name":"Черничный джем","qty":"50","unit":"г"}]'::jsonb,
    856, 67, 4.9,
    TRUE, NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'Премиум-рецепт «Свадебный многоярусный»',
    'premium-retsept-svadebnyy-mnogoyarusnyy',
    'Профессиональный рецепт для кондитеров, делающих свадебные торты. Включает детальные инструкции по сборке, транспортировке и хранению.',
    2500.00, TRUE, 499.00, 0.10,
    480, 5, ARRAY['wedding', 'multi-tier', 'premium', 'professional'],
    'https://images.unsplash.com/photo-1535254973040-607b47a71e2d',
    '[{"step_number":1,"description":"Подготовьте 3 бисквита разного диаметра"},{"step_number":2,"description":"Покройте каждый белым ганашем"},{"step_number":3,"description":"Соберите многоярусную конструкцию на деревянных шпажках"},{"step_number":4,"description":"Покройте мастикой"},{"step_number":5,"description":"Украсьте живыми цветами"}]'::jsonb,
    '[{"name":"Бисквит шоколадный (3 шт разных диаметров)","qty":"3","unit":"шт"},{"name":"Ганаш белый","qty":"500","unit":"г"},{"name":"Мастика","qty":"2","unit":"кг"},{"name":"Цветы живые","qty":"20","unit":"шт"}]'::jsonb,
    312, 18, 5.0,
    TRUE, NOW()
  )
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Внешние партнёры лояльности (демо-партнёры)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.loyalty_partners (
  user_id, company_name, company_type, inn, legal_address,
  contact_email, contact_phone,
  is_verified, is_active, partnership_started_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000002',  -- placeholder LOYALTY_PARTNER
    'ООО «Сбербанк Лоялти»', 'bank', '7707083893',
    'г. Москва, ул. Покровка, д. 13',
    'partners@sberbank-loyalty.example', '+7 (495) 555-1234',
    TRUE, TRUE, '2026-01-15 00:00:00+00'
  ),
  (
    '00000000-0000-0000-0000-000000000003',  -- placeholder LOYALTY_PARTNER
    'Сеть кофеен «Surf Coffee»', 'coffee_chain', '7701234567',
    'г. Москва, ул. Покровка, д. 5',
    'partners@surfcoffee.example', '+7 (495) 555-5678',
    TRUE, TRUE, '2026-02-01 00:00:00+00'
  ),
  (
    '00000000-0000-0000-0000-000000000004',  -- placeholder LOYALTY_PARTNER
    'СОГАЗ Страхование', 'insurance', '7707083893',
    'г. Москва, ул. Спиридоновка, д. 1',
    'loyalty@sogaz.example', '+7 (495) 555-9012',
    FALSE, TRUE, NOW()  -- недавно подали заявку, ждёт верификации
  )
ON CONFLICT (user_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Кросс-акции с партнёрами (активные демо-акции)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.loyalty_cross_actions (
  partner_id, title, description,
  discount_type, discount_value,
  start_at, end_at, usage_limit, usage_count,
  is_active
) VALUES
  (
    (SELECT id FROM public.loyalty_partners WHERE company_name = 'ООО «Сбербанк Лоялти»' LIMIT 1),
    '10% кешбэк бонусами при оплате картой Сбербанка',
    'При оплате заказа торта картой Сбербанка на маркетплейсе «Уездный кондитер» получите 10% от суммы бонусами Спасибо (до 500 бонусов за заказ).',
    'percent', 10,
    '2026-09-01 00:00:00+00', '2026-12-01 00:00:00+00',
    1000, 0, TRUE
  ),
  (
    (SELECT id FROM public.loyalty_partners WHERE company_name = 'Сеть кофеен «Surf Coffee»' LIMIT 1),
    'Капучино в подарок при заказе от 3000 ₽',
    'При заказе торта на сумму от 3000 ₽ получите купон на бесплатный капучино в любой кофейне Surf Coffee.',
    'freebie', 1,
    '2026-09-15 00:00:00+00', '2026-11-15 00:00:00+00',
    500, 0, TRUE
  ),
  (
    (SELECT id FROM public.loyalty_partners WHERE company_name = 'СОГАЗ Страхование' LIMIT 1),
    '300 бонусов при оформлении страхового полиса',
    'Оформите любой страховой полис СОГАЗ по ссылке от платформы «Уездный кондитер» — получите 300 бонусов на следующий заказ.',
    'bonus_points', 300,
    '2026-10-01 00:00:00+00', '2026-12-31 00:00:00+00',
    NULL, 0, TRUE
  )
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Начальные permissions для новых ролей (RBAC)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.permissions (name, slug, module, description, is_system) VALUES
  ('recipe_marketplace.create',  'recipe_marketplace_create',  'recipes', 'Создание авторских рецептов (только RECIPE_DEVELOPER)', TRUE),
  ('recipe_marketplace.update',  'recipe_marketplace_update',  'recipes', 'Редактирование своих рецептов', TRUE),
  ('recipe_marketplace.delete',  'recipe_marketplace_delete',  'recipes', 'Удаление своих рецептов (soft-delete)', TRUE),
  ('recipe_marketplace.publish', 'recipe_marketplace_publish', 'recipes', 'Публикация рецептов (снятие черновика)', TRUE),
  ('recipe_purchases.create',    'recipe_purchases_create',    'recipes', 'Покупка рецепта другим пользователем', TRUE),
  ('recipe_purchases.refund',    'recipe_purchases_refund',    'recipes', 'Возврат за покупку рецепта (только ADMIN)', TRUE),
  ('loyalty_partners.create',    'loyalty_partners_create',    'loyalty', 'Регистрация как партнёр лояльности', TRUE),
  ('loyalty_partners.update',    'loyalty_partners_update',    'loyalty', 'Редактирование своего профиля партнёра', TRUE),
  ('loyalty_partners.verify',    'loyalty_partners_verify',    'loyalty', 'Верификация партнёра (только ADMIN)', TRUE),
  ('loyalty_cross_actions.create','loyalty_cross_actions_create','loyalty','Создание кросс-акций (только LOYALTY_PARTNER)', TRUE),
  ('loyalty_cross_actions.update','loyalty_cross_actions_update','loyalty','Редактирование своих кросс-акций', TRUE),
  ('loyalty_point_exchanges.create','loyalty_point_exchanges_create','loyalty','Обмен бонусами с партнёрами', TRUE),
  ('ai_assistant.chat',         'ai_assistant_chat',          'ai_assistant', 'Отправка запросов к AI-помощнику', TRUE),
  ('ai_assistant.conversations.read', 'ai_assistant_conversations_read', 'ai_assistant', 'Просмотр своих диалогов', TRUE),
  ('ai_assistant.conversations.delete', 'ai_assistant_conversations_delete', 'ai_assistant', 'Удаление своих диалогов', TRUE),
  ('ai_assistant.feedback',     'ai_assistant_feedback',      'ai_assistant', 'Оценка ответов AI (thumbs up/down)', TRUE),
  ('ai_assistant.logs.read',    'ai_assistant_logs_read',     'ai_assistant', 'Просмотр всех логов (только ADMIN/SUPER_ADMIN)', TRUE)
ON CONFLICT (slug) DO NOTHING;

-- Привязать разрешения к ролям
-- RECIPE_DEVELOPER → recipes permissions
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'RECIPE_DEVELOPER', id FROM public.permissions
WHERE slug IN (
  'recipe_marketplace_create', 'recipe_marketplace_update',
  'recipe_marketplace_delete', 'recipe_marketplace_publish',
  'ai_assistant_chat', 'ai_assistant_conversations_read',
  'ai_assistant_conversations_delete', 'ai_assistant_feedback'
)
ON CONFLICT DO NOTHING;

-- LOYALTY_PARTNER → loyalty permissions
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'LOYALTY_PARTNER', id FROM public.permissions
WHERE slug IN (
  'loyalty_partners_create', 'loyalty_partners_update',
  'loyalty_cross_actions_create', 'loyalty_cross_actions_update',
  'loyalty_point_exchanges_create',
  'ai_assistant_chat', 'ai_assistant_conversations_read',
  'ai_assistant_conversations_delete', 'ai_assistant_feedback'
)
ON CONFLICT DO NOTHING;

-- ADMIN → все новые permissions + verify
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'ADMIN', id FROM public.permissions
WHERE module IN ('recipes', 'loyalty', 'ai_assistant')
ON CONFLICT DO NOTHING;

-- SUPER_ADMIN → всё (как ADMIN + чтение всех AI-логов)
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'SUPER_ADMIN', id FROM public.permissions
WHERE module IN ('recipes', 'loyalty', 'ai_assistant')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Тестовый диалог с AI-помощником (для демонстрации работы системы)
-- ─────────────────────────────────────────────────────────────────────
-- Создаём только если есть тестовый пользователь (user_id 00000000-...)
INSERT INTO public.ai_assistant_conversations (
  user_id, role_context, title, message_count, last_message_at,
  is_archived, metadata
) VALUES
  (
    '00000000-0000-0000-0000-000000000001',  -- placeholder
    'CUSTOMER', 'Подбор торта для свадьбы', 2,
    NOW(), FALSE,
    '{"occasion":"wedding","guests":50}'::jsonb
  )
ON CONFLICT DO NOTHING;

-- Тестовое сообщение в логах (для демонстрации структуры)
INSERT INTO public.ai_assistant_logs (
  conversation_id, user_id, role_context,
  request_type, input_text, output_text,
  input_tokens, output_tokens, model_used, latency_ms
) VALUES
  (
    (SELECT id FROM public.ai_assistant_conversations LIMIT 1),
    '00000000-0000-0000-0000-000000000001',
    'CUSTOMER',
    'chat',
    'Подскажи торт для свадьбы на 50 человек, бюджет 15000 ₽',
    'Для свадьбы на 50 человек с бюджетом 15000 ₽ рекомендую: 1) Многоярусный торт 3 кг «Три шоколада» (14000 ₽) — шоколадный бисквит, mascarpone, белая мастика; 2) Торт 3.5 кг «Лавандовое наслаждение» (13500 ₽) — более лёгкий вариант. Оба торта есть в каталоге. Заказ за 7 дней до свадьбы.',
    28, 89, 'fallback-rule-based', 125
  )
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Системные настройки для новых ролей (configs)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.configs (key, value, description, updated_by) VALUES
  ('ai_assistant.rate_limit_per_minute', '20', 'Лимит запросов к AI-помощнику на пользователя в минуту', NULL),
  ('ai_assistant.max_message_length', '5000', 'Максимальная длина сообщения в символах', NULL),
  ('ai_assistant.default_model', 'glm-4', 'Используемая модель LLM по умолчанию', NULL),
  ('ai_assistant.fallback_enabled', 'true', 'Включить fallback на rule-based если SDK недоступен', NULL),
  ('recipe_marketplace.default_royalty_rate', '0.05', 'Стандартная ставка роялти для новых рецептов (5%)', NULL),
  ('recipe_marketplace.platform_commission_rate', '0.10', 'Комиссия платформы с продаж рецептов (10%)', NULL),
  ('loyalty_partners.auto_verify', 'false', 'Автоматическая верификация новых партнёров (false = ручная)', NULL),
  ('loyalty_cross_actions.default_end_in_days', '30', 'Длительность кросс-акции по умолчанию в днях', NULL)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = NOW();

-- ─────────────────────────────────────────────────────────────────────
-- 7. Комментарии для удобства разработки (комментарии к seed-данным)
-- ─────────────────────────────────────────────────────────────────────
COMMENT ON TABLE public.recipe_marketplace IS 'Демо-данные seed: 3 рецепта от RECIPE_DEVELOPER (2 обычных + 1 премиум). В прод-окружении замените placeholder user_id на реальные UUID.';
COMMENT ON TABLE public.loyalty_partners IS 'Демо-данные seed: 3 партнёра (банк, кофейня, страховая). 2 верифицированы, 1 — на модерации.';
COMMENT ON TABLE public.loyalty_cross_actions IS 'Демо-данные seed: 3 активные кросс-акции с разными типами скидок (percent, freebie, bonus_points).';

-- Конец seed для новых ролей v2.0
