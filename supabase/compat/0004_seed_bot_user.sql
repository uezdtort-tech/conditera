-- ============================================================================
-- 0004_seed_bot_user.sql — системный пользователь FAQ-бота чата.
--
-- Зачем: chat_messages.sender_id NOT NULL + FK → auth.users. Бот-сообщения
-- (is_bot=true, bot_kind='faq'|'escalation') персистятся server-to-server
-- (POST /api/chat/rooms/[id]/bot-message, x-bot-secret: BOT_SECRET) от имени
-- этого пользователя — история бота переживает рестарт chat-server.
--
-- Идемпотентно: ON CONFLICT DO NOTHING. UUID фиксированный, чтобы все среды
-- (dev/CI) имели одинаковый bot-пользователь.
-- ============================================================================

-- 1. auth.users (FK profiles.id → auth.users.id). Триггер on_auth_user_created
--    создаст профиль + роль CUSTOMER — последующие upsert'ы их не дублируют.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
VALUES (
  'aaaaaaaa-0000-4000-8000-000000000b07',
  'support-bot@system.local',
  '',
  now(),
  '{"name": "Уездный помощник", "is_bot": true}'::jsonb,
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

-- 2. Профиль (upsert поверх триггерного)
INSERT INTO profiles (id, email, name, account_type, loyalty_level, bonus_balance, is_blocked, is_verified)
VALUES (
  'aaaaaaaa-0000-4000-8000-000000000b07',
  'support-bot@system.local',
  'Уездный помощник',
  'individual',
  'BRONZE',
  0,
  false,
  true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  is_verified = true;

-- 3. Роль не даём (бот не логинится) — только отправка сообщений через API.
