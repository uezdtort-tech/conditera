-- ============================================================
-- seed_confectioners.sql — демо-кондитеры для публичной бегущей строки.
-- АВТОГЕНЕРИРОВАНО: bun scripts/generate-seed-confectioners.mjs
-- (источник: src/lib/mock-data.ts MOCK_CONFECTIONERS)
--
-- Идемпотентно: ON CONFLICT (id) DO UPDATE.
-- Legacy-значения замаплены в DB enums:
--   trustLevel TRUSTED→VERIFIED, tariff PROFI→PREMIUM,
--   taxMode IP→USN, OOO→OSNO.
-- ============================================================

-- userId-стабы (кондитеры-демо не привязаны к auth.users — TEXT без FK)
INSERT INTO public.confectioners (
  id, "userId", "businessName", slug, description, avatar, cover, city,
  location, rating, "reviewsCount", "ordersCount", verified,
  "verificationStatus", "trustLevel", tariff, "legalInfo", "taxMode",
  specialization, "portfolioImages", "followersCount", "responseTime",
  "joinedAt", "selfPickup", "deliveryOptions", "paymentSettings", "ecoBadges",
  balance, "totalEarnings", "monthlyEarnings", "createdAt", "updatedAt"
) VALUES
('c0', 'u0', 'Торты на заказ | Сахарная печать', 'torty-na-zakaz-saharnaya-pechat', 'Домашняя кондитерская из Волоколамска. Специализируюсь на тортах для свадеб, крестин и других праздников. Уникальная услуга — сахарная печать: нанесение любого изображения на торт с помощью съедобной бумаги и пищевых чернил. Каждый торт — индивидуальный подход, натуральные ингредиенты, ручная работа. Принимаю заказы на торты любой сложности.', 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400', 'https://images.unsplash.com/photo-1535254973040-607b474cb50d?w=1200', 'Волоколамск', '{"country":"Россия","region":"Московская область","city":"Волоколамск","district":"Центральный","street":"ул. Революционная","house":"","apartment":"","postalCode":"143600","lat":56.9555,"lng":35.9567,"serviceRadiusKm":50,"deliveryCities":["Волоколамск","Москва","Можайск","Клин","Истра","Руза"]}'::jsonb, 5, 1, 1, true, 'approved', 'VERIFIED', 'PREMIUM', '{"status":"NPD","inn":"","npdRegisteredAt":"2024-01-01","documentsVerified":true,"verifiedAt":"2024-01-15"}'::jsonb, 'NPD', ARRAY['Свадебные торты','Торты на крестины','Сахарная печать','Праздничные торты','Торты с фото']::TEXT[], ARRAY['https://images.unsplash.com/photo-1535254973040-607b474cb50d?w=600','https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=600','https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600','https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?w=600']::TEXT[], 1, 'обычно отвечает в течение часа', '2024-01-10'::timestamptz, true, ARRAY['own','courier','pickup_point']::TEXT[], '{"acceptCard":true,"acceptSbp":true,"acceptCash":true,"acceptSplit":true,"acceptInstallment":false,"installmentMinAmount":0,"installmentProviders":[],"installmentPlans":[]}'::jsonb, ARRAY[]::TEXT[], 0, 0, 0, now(), now()),
('c1', 'u2', 'Сладкая уездная', 'sladkaya-uezdnaya', 'Домашняя кондитерская из Тулы. Специализируемся на бисквитных тортах, медовиках и авторских десертах. Все изделия — из натуральных ингредиентов, без маргарина и консервантов. Работаем с 2019 года, более 1200 испечённых тортов.', 'https://i.pravatar.cc/150?img=32', 'https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=1200', 'Тула', '{"country":"Россия","region":"Тульская область","city":"Тула","district":"Центральный","street":"ул. Первомайская","house":"12","apartment":"5","postalCode":"300000","lat":54.1961,"lng":37.6182,"serviceRadiusKm":25,"deliveryCities":["Тула","Щёкино","Новомосковск","Алексин"]}'::jsonb, 4.9, 247, 1248, true, 'approved', 'MASTER', 'PREMIUM', '{"status":"NPD","inn":"710200012345","npdRegisteredAt":"2019-08-20","documentsVerified":true,"verifiedAt":"2019-09-01"}'::jsonb, 'NPD', ARRAY['Бисквитные торты','Медовики','Авторские десерты','Капкейки']::TEXT[], ARRAY['https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600','https://images.unsplash.com/photo-1535141192574-5d4897c12636?w=600','https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=600']::TEXT[], 3420, 'обычно отвечает в течение часа', '2019-08-14'::timestamptz, true, ARRAY['own','courier','pickup_point']::TEXT[], '{"acceptCard":true,"acceptSbp":true,"acceptCash":true,"acceptSplit":true,"acceptInstallment":true,"installmentMinAmount":1500,"installmentProviders":["split","tinkoff"],"installmentPlans":[{"id":"ip1_c1","name":"Рассрочка на 3 месяца","months":3,"interestRate":0,"minAmount":1500,"downPaymentPercent":0,"provider":"split","description":"Беспроцентная рассрочка на 3 месяца через Сплит","isActive":true},{"id":"ip2_c1","name":"Рассрочка на 6 месяцев","months":6,"interestRate":5,"minAmount":3000,"downPaymentPercent":20,"provider":"tinkoff","description":"Рассрочка 6 месяцев, первый взнос 20%, переплата 5%","isActive":true}]}'::jsonb, ARRAY[]::TEXT[], 84200, 1284000, 184000, now(), now()),
('c2', 'u6', 'Кондитерская Купец', 'konditerskaya-kupets', 'Семейная кондитерская из Москвы. Готовим торты и пирожные по дореволюционным рецептам. Используем масло Вологодское, сливки 33%, настоящий шоколад Callebaut. Принимаем заказы на свадебные и корпоративные торты.', 'https://i.pravatar.cc/150?img=23', 'https://images.unsplash.com/photo-1557925923-cd4648e211a0?w=1200', 'Москва', '{"country":"Россия","region":"Москва","city":"Москва","district":"Сокольники","street":"ул. Русаковская","house":"28","apartment":"12","postalCode":"107014","lat":55.7937,"lng":37.6798,"serviceRadiusKm":30,"deliveryCities":["Москва","Химки","Балашиха","Подольск","Мытищи"]}'::jsonb, 4.8, 412, 2380, true, 'approved', 'EXPERT', 'PREMIUM', '{"status":"IP","ipOgrnip":"318770000012345","ipInn":"770000012345","ipUsnRate":"6%","documentsVerified":true,"verifiedAt":"2018-04-01","bankAccount":"40802810000000123456","bankBik":"044525225","bankName":"ПАО Сбербанк"}'::jsonb, 'USN', ARRAY['Свадебные торты','Классика','Пирожные','Корпоративные']::TEXT[], ARRAY['https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?w=600','https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=600','https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=600']::TEXT[], 5680, 'ответ в течение 2 часов', '2018-03-20'::timestamptz, true, ARRAY['own','courier','pickup_point','cdek']::TEXT[], '{"acceptCard":true,"acceptSbp":true,"acceptCash":false,"acceptSplit":true,"acceptInstallment":true,"installmentMinAmount":5000,"installmentProviders":["split","tinkoff","sberbank"],"installmentPlans":[{"id":"ip1_c2","name":"Рассрочка на 4 месяца","months":4,"interestRate":0,"minAmount":5000,"downPaymentPercent":25,"provider":"split","description":"Беспроцентная рассрочка 4 месяца, первый взнос 25%","isActive":true},{"id":"ip2_c2","name":"Рассрочка на 12 месяцев","months":12,"interestRate":12,"minAmount":10000,"downPaymentPercent":0,"provider":"tinkoff","description":"Рассрочка на год, переплата 12%","isActive":true},{"id":"ip3_c2","name":"СберРассрочка на 6 месяцев","months":6,"interestRate":0,"minAmount":3000,"downPaymentPercent":0,"provider":"sberbank","description":"Беспроцентная рассрочка от Сбербанка","isActive":true}]}'::jsonb, ARRAY[]::TEXT[], 152800, 3120000, 287000, now(), now()),
('c3', 'u7', 'Татьяна-Кондитер', 'tatyana-konditer', 'Домашний кондитер из Петербурга. Люблю создавать нежные муссовые торты и cheesecake. Работаю на заказ, каждая работа уникальна. Принимаю заказы за 3-5 дней.', 'https://i.pravatar.cc/150?img=44', 'https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=1200', 'Санкт-Петербург', '{"country":"Россия","region":"Санкт-Петербург","city":"Санкт-Петербург","district":"Петроградский","street":"Большой пр. ПС","house":"55","apartment":"12","postalCode":"197198","lat":59.9603,"lng":30.3096,"serviceRadiusKm":20,"deliveryCities":["Санкт-Петербург","Кудрово","Всеволожск"]}'::jsonb, 5, 89, 312, true, 'approved', 'VERIFIED', 'START', '{"status":"NPD","inn":"784200012345","npdRegisteredAt":"2023-05-15","documentsVerified":true,"verifiedAt":"2023-05-20"}'::jsonb, 'NPD', ARRAY['Муссовые торты','Cheesecake','Макаронс','Бенто-торты']::TEXT[], ARRAY['https://images.unsplash.com/photo-1535141192574-5d4897c12636?w=600','https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600']::TEXT[], 1240, 'ответ в течение 30 минут', '2023-05-10'::timestamptz, true, ARRAY['own','courier']::TEXT[], '{}'::jsonb, ARRAY[]::TEXT[], 18700, 287000, 64000, now(), now()),
('c4', 'u8', 'Сахарный Лебедь', 'saharnyy-lebed', 'Ателье авторских тортов. Художественная роспись, сахарная флористика, вафельная бумага. Каждый торт — произведение искусства. Принимаем заказы от 5000 руб.', 'https://i.pravatar.cc/150?img=20', 'https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?w=1200', 'Москва', '{"country":"Россия","region":"Москва","city":"Москва","district":"Хамовники","street":"ул. Льва Толстого","house":"16","apartment":"8","postalCode":"119021","lat":55.7338,"lng":37.5878,"serviceRadiusKm":40,"deliveryCities":["Москва","Подольск","Красногорск","Одинцово","Химки"]}'::jsonb, 4.95, 156, 420, true, 'approved', 'MASTER', 'PREMIUM', '{"status":"OOO","oooOgrn":"1177700000123","oooInn":"7700000123","oooKpp":"770001001","oooLegalAddress":"г. Москва, ул. Льва Толстого, д. 16","oooTaxSystem":"USN_6","documentsVerified":true,"verifiedAt":"2017-10-01","bankAccount":"40702810000000123456","bankBik":"044525225","bankName":"ПАО Сбербанк"}'::jsonb, 'OSNO', ARRAY['Авторские торты','Свадебные','Сахарная флористика','Тематические']::TEXT[], ARRAY['https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600','https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?w=600','https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=600']::TEXT[], 7230, 'ответ в течение часа', '2017-09-25'::timestamptz, false, ARRAY['own','courier','pickup_point','cdek']::TEXT[], '{}'::jsonb, ARRAY[]::TEXT[], 234500, 5240000, 412000, now(), now())

ON CONFLICT (id) DO UPDATE SET
  "businessName" = EXCLUDED."businessName",
  slug = EXCLUDED.slug,
  description = EXCLUDED.description,
  avatar = EXCLUDED.avatar,
  cover = EXCLUDED.cover,
  city = EXCLUDED.city,
  location = EXCLUDED.location,
  rating = EXCLUDED.rating,
  "reviewsCount" = EXCLUDED."reviewsCount",
  "ordersCount" = EXCLUDED."ordersCount",
  verified = EXCLUDED.verified,
  "verificationStatus" = EXCLUDED."verificationStatus",
  "trustLevel" = EXCLUDED."trustLevel",
  tariff = EXCLUDED.tariff,
  "legalInfo" = EXCLUDED."legalInfo",
  "taxMode" = EXCLUDED."taxMode",
  specialization = EXCLUDED.specialization,
  "portfolioImages" = EXCLUDED."portfolioImages",
  "followersCount" = EXCLUDED."followersCount",
  "responseTime" = EXCLUDED."responseTime",
  "selfPickup" = EXCLUDED."selfPickup",
  "deliveryOptions" = EXCLUDED."deliveryOptions",
  "paymentSettings" = EXCLUDED."paymentSettings",
  "ecoBadges" = EXCLUDED."ecoBadges",
  "updatedAt" = now();

-- Проверка: все seeded-кондитеры verified=true (RLS-политика public SELECT)
DO $$
DECLARE v_count INTEGER; v_verified INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.confectioners WHERE id LIKE 'c_';
  SELECT COUNT(*) INTO v_verified FROM public.confectioners WHERE id LIKE 'c_' AND verified = true;
  IF v_count <> v_verified THEN
    RAISE WARNING 'seed_confectioners: % из % seeded-кондитеров verified', v_verified, v_count;
  END IF;
  RAISE NOTICE 'seed_confectioners: OK, % строк', v_count;
END $$;
