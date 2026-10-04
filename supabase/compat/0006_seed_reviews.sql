-- ============================================================================
-- 0006_seed_reviews.sql — покупатели + отзывы на товары витрины.
--
-- Зачем: секция «Отзывы покупателей» на главной показывала статический
-- мок-контент, а product_reviews была пуста. Сид создаёт двух демо-
-- покупателей (пароль тот же Demo123!, hash копируется из customer@demo.ru)
-- и привязывает отзывы к РЕАЛЬНЫм товарам витрины.
--
-- Идемпотентно: ON CONFLICT DO NOTHING / WHERE NOT EXISTS.
-- ============================================================================

-- 1. Дополнительные демо-покупатели (id фиксированные для повторяемости)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000c02', 'customer2@demo.ru', '', now(), '{"name":"Ольга Ветрова"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-000000000c03', 'customer3@demo.ru', '', now(), '{"name":"Марат Сафин"}'::jsonb, now(), now())
ON CONFLICT (id) DO NOTHING;

-- 2. Профили (пароль — тот же Demo123!, hash переиспользуем)
INSERT INTO profiles (id, email, password_hash, name, account_type, loyalty_level, bonus_balance, is_blocked, is_verified)
SELECT
  u.id,
  u.email,
  (SELECT password_hash FROM public.profiles WHERE email = 'customer@demo.ru' LIMIT 1),
  u.raw_user_meta_data->>'name',
  'individual',
  'BRONZE',
  0,
  false,
  true
FROM auth.users u
WHERE u.id IN ('aaaaaaaa-0000-4000-8000-000000000c02', 'aaaaaaaa-0000-4000-8000-000000000c03')
ON CONFLICT (id) DO NOTHING;

-- 3. Роль CUSTOMER (триггер мог уже создать — upsert безопасен)
INSERT INTO public.user_roles (user_id, role, is_active, assigned_by, assigned_at)
SELECT u.id, 'CUSTOMER', true, u.id, now()
FROM auth.users u
WHERE u.id IN ('aaaaaaaa-0000-4000-8000-000000000c02', 'aaaaaaaa-0000-4000-8000-000000000c03')
ON CONFLICT (user_id, role) DO NOTHING;

-- 4. Отзывы (approved → попадают в витрину)
INSERT INTO public.product_reviews (product_id, user_id, rating, text, pros, cons, status, helpful_count, created_at)
SELECT p.id, u.id, v.rating, v.txt, v.pros, v.cons, 'approved', v.helpful, v.at
FROM (VALUES
  ('svadebnyy-tort-yagodnyy-barhat', 'customer@demo.ru', 5,
   'Заказывали на свадьбу — гости до сих пор вспоминают. Ягоды свежие, коржи пропитаны идеально, доставили минута в минуту.',
   'Вкус, внешний вид, пунктуальность', 'Хотелось бы больше вариантов размера', 12, now() - interval '6 days'),
  ('tort-napoleon-domashniy', 'customer2@demo.ru', 5,
   'Настоящий домашний наполеон — много тонких коржей, не приторный. Ушёл за один вечер.',
   'Слои, крем, цена', NULL, 8, now() - interval '11 days'),
  ('bento-tort-nezhnyy', 'customer@demo.ru', 4,
   'Милый бенто на день рождения подруги. Упаковка с лентой, надпись аккуратная.',
   'Упаковка, свежесть', 'Маленький — на двоих в самый раз, на компанию нет', 5, now() - interval '3 days'),
  ('makarons-assorti-15', 'customer2@demo.ru', 5,
   'Пятнадцать вкусов в одной коробке — каждый свой. Не сухие, корочка правильная.',
   'Ассорти, свежесть', NULL, 7, now() - interval '8 days'),
  ('pryaniki-rospis-9', 'customer3@demo.ru', 5,
   'Роспись ручная — подарили коллегам, все фотографировали. Вкус тоже отличный, не «деревянные».',
   'Дизайн, ручная работа', NULL, 9, now() - interval '14 days'),
  ('pastila-yabloko-bez-sahara', 'customer3@demo.ru', 4,
   'Только яблоки — честно, без сахара. Лёгкий перекус для тех, кто следит за питанием.',
   'Состав, натуральность', 'Немного липнут к упаковке', 4, now() - interval '2 days')
) AS v(slug, email, rating, txt, pros, cons, helpful, at)
JOIN public.products p ON p.slug = v.slug
JOIN public.profiles u ON u.email = v.email
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_reviews pr
  WHERE pr.product_id = p.id AND pr.user_id = u.id
);
