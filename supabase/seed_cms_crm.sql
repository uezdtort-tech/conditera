-- ====================================================================
-- seed_cms_crm.sql — начальные данные для CMS, навигации, scheduled jobs
-- ====================================================================

-- ===== CMS Pages (базовые страницы) =====
INSERT INTO public.cms_pages (slug, title, content, status, is_in_menu, menu_order) VALUES
  ('about', 'О компании', '# «Уездный кондитер»\n\nМаркетплейс кондитерских изделий.\n\nСоединяем покупателей и домашних кондитеров.', 'published', true, 10),
  ('faq', 'Часто задаваемые вопросы', '# FAQ\n\n## Как заказать торт?\n\n1. Выберите торт в каталоге\n2. Добавьте в корзину\n3. Оформите заказ\n\n## Сколько стоит доставка?\n\nБесплатно от 3000₽.', 'published', true, 20),
  ('contacts', 'Контакты', '# Контакты\n\n- Email: support@conditera.ru\n- Телефон: 8 (800) 000-00-00\n- Telegram: @conditera', 'published', true, 30),
  ('terms', 'Условия использования', '# Условия использования\n\nИспользуя сайт, вы соглашаетесь с условиями.', 'published', false, 0),
  ('privacy', 'Политика конфиденциальности', '# Политика конфиденциальности\n\nМы защищаем ваши данные.', 'published', false, 0),
  ('cookies', 'Политика cookies', '# Политика cookies\n\nМы используем cookies.', 'published', false, 0),
  ('consent', 'Согласие на обработку данных', '# Согласие\n\nДаю согласие на обработку персональных данных.', 'published', false, 0)
ON CONFLICT (slug) DO NOTHING;

-- ===== Navigation Menu (header) =====
INSERT INTO public.cms_nav_menu (location, label, url, sort_order) VALUES
  ('header', 'Главная', '/', 1),
  ('header', 'Каталог', '/catalog', 2),
  ('header', 'Кондитеры', '/confectioners', 3),
  ('header', 'Рецепты', '/recipes', 4),
  ('header', 'Блог', '/blog', 5),
  ('header', 'О нас', '/about', 6),
  ('header', 'Помощь', '/help', 7),
  ('header', 'Контакты', '/contacts', 8)
ON CONFLICT DO NOTHING;

-- ===== Navigation Menu (footer) =====
INSERT INTO public.cms_nav_menu (location, label, url, sort_order) VALUES
  ('footer', 'О компании', '/about', 1),
  ('footer', 'Условия', '/about?legal=terms', 2),
  ('footer', 'Конфиденциальность', '/about?legal=privacy', 3),
  ('footer', 'Помощь', '/help', 4),
  ('footer', 'Контакты', '/contacts', 5)
ON CONFLICT DO NOTHING;

-- ===== Site Settings =====
INSERT INTO public.cms_site_settings (key, value, value_type, description, category, is_public) VALUES
  ('site_name', 'Уездный кондитер', 'string', 'Название сайта', 'general', true),
  ('site_description', 'Маркетплейс кондитерских изделий', 'string', 'Описание сайта', 'general', true),
  ('support_email', 'support@conditera.ru', 'string', 'Email поддержки', 'contacts', true),
  ('info_email', 'info@conditera.ru', 'string', 'Информационный email', 'contacts', true),
  ('support_phone', '+7 (800) 000-00-00', 'string', 'Телефон поддержки', 'contacts', true),
  ('company_address', 'г. Москва, ул. Примерная, д. 1', 'string', 'Адрес компании', 'contacts', true),
  ('company_inn', '000000000000', 'string', 'ИНН компании', 'contacts', false),
  ('telegram_url', 'https://t.me/conditera', 'string', 'Telegram канал', 'social', true),
  ('instagram_url', 'https://instagram.com/conditera', 'string', 'Instagram', 'social', true),
  ('vk_url', 'https://vk.com/conditera', 'string', 'ВКонтакте', 'social', true),
  ('yandex_metrika_id', '111432662', 'string', 'ID Яндекс Метрики', 'analytics', true),
  ('maintenance_mode', 'false', 'boolean', 'Режим обслуживания', 'features', false),
  ('enable_chat', 'true', 'boolean', 'Включить чат', 'features', true),
  ('enable_cake_builder', 'true', 'boolean', 'Включить конструктор тортов', 'features', true),
  ('enable_gift_certificates', 'true', 'boolean', 'Включить подарочные сертификаты', 'features', true)
ON CONFLICT (key) DO NOTHING;

-- ===== Scheduled Jobs (замена n8n) =====
-- Создаются записи в scheduled_jobs, реальный pg_cron schedule
-- настраивается после применения миграции через:
--   SELECT cron.schedule('abandoned-cart', '0 * * * *', $$...$$);

INSERT INTO public.scheduled_jobs (name, description, type, function_name, cron_expression, timezone, is_active) VALUES
  ('abandoned-cart', 'Уведомление о брошенной корзине (каждый час)', 'edge_function', 'abandoned-cart', '0 * * * *', 'Europe/Moscow', true),
  ('daily-digest', 'Ежедневный дайджест для админов (9:00 MSK)', 'edge_function', 'daily-digest', '0 9 * * *', 'Europe/Moscow', true),
  ('bonus-expiry', 'Сгорание бонусов (каждый день в полночь)', 'edge_function', 'bonus-expiry', '0 0 * * *', 'Europe/Moscow', true),
  ('cleanup-typing', 'Очистка истёкших typing indicators (каждую минуту)', 'sql', NULL, '* * * * *', 'Europe/Moscow', true),
  ('backup-database', 'Backup БД (каждый день в 3:00 MSK)', 'sql', NULL, '0 3 * * *', 'Europe/Moscow', false),
  ('reindex-search', 'Переиндексация FTS (каждую неделю в 4:00 MSK воскресенье)', 'sql', NULL, '0 4 * * 0', 'Europe/Moscow', false)
ON CONFLICT (name) DO NOTHING;

-- ===== Промокоды (демо) =====
INSERT INTO public.promo_codes (code, description, type, value, min_order_amount, max_uses, valid_to, applies_to, is_active) VALUES
  ('WELCOME10', 'Приветственный промокод 10% на первый заказ', 'percent', 10, 0, 1000, NOW() + INTERVAL '365 days', 'first_order', true),
  ('BIRTHDAY25', 'Скидка 25% на день рождения', 'percent', 25, 0, NULL, NOW() + INTERVAL '365 days', 'all', true),
  ('FREESHIP', 'Бесплатная доставка', 'free_delivery', 500, 100000, 100, NOW() + INTERVAL '90 days', 'all', true)
ON CONFLICT (code) DO NOTHING;

-- Готово!
