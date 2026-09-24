-- ====================================================================
-- 0004_cake_builder_chat.sql — Конструктор тортов + Чат через Realtime
-- ====================================================================
-- Создаёт таблицы:
--   1. cake_builder_options — опции конструктора (bases, fillings, coatings, decorations)
--   2. cake_builder_drafts — черновики конструктора
--   3. inquiries — запросы от пользователей (один запрос = один проект торта)
--   4. negotiations — переговоры (один запрос → много кондитеров)
--   5. negotiation_revisions — история изменений предложения
--   6. negotiation_messages — сообщения в переговорах (realtime)
--   7. chat_channels — каналы чата (direct, group, support)
--   8. chat_channel_members — участники канала
--   9. chat_messages — сообщения в канале (realtime)
--   10. chat_message_reads — отметки о прочтении (unread count)
--   11. chat_typing — typing indicator (realtime broadcast)
--
-- Все таблицы с user data имеют RLS политики.
-- Realtime подписки через postgres_changes работают автоматически (RLS учитывается).
-- ====================================================================

-- ===== 1. Cake Builder Options =====
CREATE TABLE IF NOT EXISTS public.cake_builder_options (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category TEXT NOT NULL, -- 'base' | 'filling' | 'coating' | 'decoration' | 'dietary' | 'event_type'
  key TEXT NOT NULL, -- 'vanilla' | 'chocolate' | 'mascarpone' | ...
  name TEXT NOT NULL, -- 'Ванильный бисквит'
  description TEXT,
  price_modifier INTEGER DEFAULT 0, -- в копейках
  image_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  metadata JSONB, -- дополнительные параметры (вес, аллергены, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (category, key)
);

COMMENT ON TABLE public.cake_builder_options IS 'Опции конструктора тортов (база, начинка, покрытие, декор, диета)';
CREATE INDEX idx_cake_options_category ON public.cake_builder_options(category);
CREATE INDEX idx_cake_options_active ON public.cake_builder_options(category) WHERE is_active = TRUE;

-- ===== 2. Cake Builder Drafts (черновики) =====
CREATE TABLE IF NOT EXISTS public.cake_builder_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Все 8 шагов конструктора
  event_type TEXT, -- 'wedding' | 'birthday' | 'corporate' | ...
  base TEXT, -- FK на cake_builder_options.key
  filling TEXT,
  coating TEXT,
  decorations TEXT[] DEFAULT '{}',
  dietary TEXT[] DEFAULT '{}',
  servings INTEGER DEFAULT 8,
  -- Доставка
  city TEXT,
  delivery_date DATE,
  delivery_type TEXT DEFAULT 'delivery', -- 'delivery' | 'pickup' | 'self_pickup'
  inscription TEXT, -- надпись на торте
  comment TEXT,
  -- Состояние
  step INTEGER DEFAULT 0, -- 0-7
  is_submitted BOOLEAN DEFAULT FALSE,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.cake_builder_drafts IS 'Черновики конструктора тортов (автосохранение)';
CREATE INDEX idx_drafts_user ON public.cake_builder_drafts(user_id);
CREATE INDEX idx_drafts_updated ON public.cake_builder_drafts(updated_at DESC);

-- ===== 3. Inquiries (запросы) =====
CREATE TABLE IF NOT EXISTS public.inquiries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Snapshot проекта торта
  event_type TEXT,
  base TEXT,
  filling TEXT,
  coating TEXT,
  decorations TEXT[] DEFAULT '{}',
  dietary TEXT[] DEFAULT '{}',
  servings INTEGER DEFAULT 8,
  city TEXT,
  delivery_date DATE,
  delivery_type TEXT DEFAULT 'delivery',
  inscription TEXT,
  comment TEXT,
  estimated_price INTEGER, -- в копейках (расчёт на стороне клиента)
  -- Статус
  status TEXT DEFAULT 'open', -- 'open' | 'closed' | 'expired' | 'converted'
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '48 hours',
  -- Метрики
  negotiations_count INTEGER DEFAULT 0,
  -- Timestamps
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.inquiries IS 'Запросы на индивидуальный торт (один запрос → много кондитеров)';
CREATE INDEX idx_inquiries_user ON public.inquiries(user_id);
CREATE INDEX idx_inquiries_status ON public.inquiries(status);
CREATE INDEX idx_inquiries_city ON public.inquiries(city);
CREATE INDEX idx_inquiries_expires ON public.inquiries(expires_at) WHERE status = 'open';

-- ===== 4. Negotiations (переговоры) =====
CREATE TABLE IF NOT EXISTS public.negotiations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inquiry_id UUID NOT NULL REFERENCES public.inquiries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  confectioner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Предложение кондитера
  quoted_price INTEGER, -- в копейках (предложенная цена)
  quoted_delivery_cost INTEGER DEFAULT 0,
  quoted_prep_time TEXT, -- '2-3 дня'
  quoted_items JSONB, -- что входит в предложение
  -- Скидка
  discount_requested BOOLEAN DEFAULT FALSE,
  discount_percent INTEGER DEFAULT 0,
  discount_comment TEXT,
  -- Статус
  status TEXT DEFAULT 'pending_confectioner', -- 'pending_confectioner' | 'quoted' | 'accepted' | 'declined' | 'counter_offered' | 'expired'
  -- Timestamps
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '48 hours',
  quoted_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  -- Если accepted → link на order
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (inquiry_id, confectioner_id) -- один кондитер = одна переговорка на запрос
);

COMMENT ON TABLE public.negotiations IS 'Переговоры между пользователем и кондитером по inquiry';
CREATE INDEX idx_negotiations_inquiry ON public.negotiations(inquiry_id);
CREATE INDEX idx_negotiations_user ON public.negotiations(user_id);
CREATE INDEX idx_negotiations_confectioner ON public.negotiations(confectioner_id);
CREATE INDEX idx_negotiations_status ON public.negotiations(status);

-- ===== 5. Negotiation Revisions (история предложений) =====
CREATE TABLE IF NOT EXISTS public.negotiation_revisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  negotiation_id UUID NOT NULL REFERENCES public.negotiations(id) ON DELETE CASCADE,
  -- Snapshot предложения на момент изменения
  quoted_price INTEGER,
  quoted_delivery_cost INTEGER DEFAULT 0,
  quoted_prep_time TEXT,
  quoted_items JSONB,
  discount_percent INTEGER DEFAULT 0,
  discount_comment TEXT,
  -- Кто инициировал изменение
  changed_by UUID NOT NULL REFERENCES auth.users(id),
  change_reason TEXT, -- 'initial' | 'price_adjustment' | 'discount_offered' | 'counter_offer'
  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.negotiation_revisions IS 'История изменений предложений в переговорах';
CREATE INDEX idx_revisions_negotiation ON public.negotiation_revisions(negotiation_id);

-- ===== 6. Negotiation Messages (realtime) =====
CREATE TABLE IF NOT EXISTS public.negotiation_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  negotiation_id UUID NOT NULL REFERENCES public.negotiations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  attachments JSONB, -- массив ссылок на storage
  is_system BOOLEAN DEFAULT FALSE, -- системные сообщения (статусы)
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

COMMENT ON TABLE public.negotiation_messages IS 'Сообщения в переговорах (realtime через postgres_changes)';
CREATE INDEX idx_neg_messages_negotiation ON public.negotiation_messages(negotiation_id);
CREATE INDEX idx_neg_messages_created ON public.negotiation_messages(created_at DESC);

-- ===== 7. Chat Channels =====
CREATE TABLE IF NOT EXISTS public.chat_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL DEFAULT 'direct', -- 'direct' | 'group' | 'support' | 'negotiation'
  name TEXT, -- для group channels
  -- Связь с другими сущностями
  negotiation_id UUID REFERENCES public.negotiations(id) ON DELETE CASCADE,
  support_ticket_id UUID, -- FK на support_tickets (создаётся в 0005_crm.sql)
  -- Метрики
  last_message_at TIMESTAMPTZ,
  last_message_text TEXT,
  messages_count INTEGER DEFAULT 0,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

COMMENT ON TABLE public.chat_channels IS 'Каналы чата (direct, group, support, negotiation)';
CREATE INDEX idx_channels_type ON public.chat_channels(type);
CREATE INDEX idx_channels_negotiation ON public.chat_channels(negotiation_id) WHERE negotiation_id IS NOT NULL;
CREATE INDEX idx_channels_last_message ON public.chat_channels(last_message_at DESC);

-- ===== 8. Chat Channel Members =====
CREATE TABLE IF NOT EXISTS public.chat_channel_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member', -- 'admin' | 'member' | 'viewer'
  -- Уведомления
  muted BOOLEAN DEFAULT FALSE,
  last_read_message_id UUID, -- FK добавляется ниже (после создания chat_messages)
  last_read_at TIMESTAMPTZ,
  -- Timestamps
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  UNIQUE (channel_id, user_id)
);

COMMENT ON TABLE public.chat_channel_members IS 'Участники канала чата';
CREATE INDEX idx_channel_members_channel ON public.chat_channel_members(channel_id);
CREATE INDEX idx_channel_members_user ON public.chat_channel_members(user_id);

-- ===== 9. Chat Messages =====
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Содержание
  text TEXT,
  attachments JSONB, -- массив: [{ type: 'image'|'file'|'audio', url, name, size }]
  reply_to_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  -- Метаданные
  is_edited BOOLEAN DEFAULT FALSE,
  edited_at TIMESTAMPTZ,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  -- Системные сообщения
  is_system BOOLEAN DEFAULT FALSE,
  system_event TEXT, -- 'user_joined' | 'user_left' | 'channel_created' | 'call_started'
  -- Metadata
  metadata JSONB,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.chat_messages IS 'Сообщения в каналах чата (realtime через postgres_changes)';
CREATE INDEX idx_chat_messages_channel ON public.chat_messages(channel_id);
CREATE INDEX idx_chat_messages_sender ON public.chat_messages(sender_id);
CREATE INDEX idx_chat_messages_created ON public.chat_messages(channel_id, created_at DESC);
-- Для realtime: индекс на id (для быстрых INSERT notifications)
CREATE INDEX idx_chat_messages_id_created ON public.chat_messages(id, created_at);

-- FK last_read_message_id → chat_messages (добавляется после создания таблицы)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_channel_members_last_read_fk'
  ) THEN
    ALTER TABLE public.chat_channel_members
      ADD CONSTRAINT chat_channel_members_last_read_fk
      FOREIGN KEY (last_read_message_id) REFERENCES public.chat_messages(id);
  END IF;
END $$;

-- ===== 10. Chat Message Reads (для unread count) =====
CREATE TABLE IF NOT EXISTS public.chat_message_reads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (message_id, user_id)
);

COMMENT ON TABLE public.chat_message_reads IS 'Отметки о прочтении сообщений (для unread count)';
CREATE INDEX idx_message_reads_message ON public.chat_message_reads(message_id);
CREATE INDEX idx_message_reads_user ON public.chat_message_reads(user_id);

-- ===== 11. Chat Typing (временный indicator) =====
-- ВАЖНО: эта таблица НЕ хранится долго — записи удаляются через 3 секунды
-- через trigger. Realtime broadcast events используются как альтернатива.
CREATE TABLE IF NOT EXISTS public.chat_typing (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '3 seconds'
);

COMMENT ON TABLE public.chat_typing IS 'Typing indicator (временные записи, истекают через 3 сек)';
CREATE INDEX idx_typing_channel ON public.chat_typing(channel_id);
CREATE INDEX idx_typing_user ON public.chat_typing(user_id);
CREATE INDEX idx_typing_expires ON public.chat_typing(expires_at);

-- ===== 12. RLS политики =====

-- 12.1. cake_builder_options — public read, admin write
ALTER TABLE public.cake_builder_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cake_options_select_public" ON public.cake_builder_options
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "cake_options_write_admin" ON public.cake_builder_options
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN') AND ur.is_active = TRUE)
  );

-- 12.2. cake_builder_drafts — только свои
ALTER TABLE public.cake_builder_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drafts_select_own" ON public.cake_builder_drafts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "drafts_insert_own" ON public.cake_builder_drafts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "drafts_update_own" ON public.cake_builder_drafts
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "drafts_delete_own" ON public.cake_builder_drafts
  FOR DELETE USING (auth.uid() = user_id);

-- 12.3. inquiries — владелец + кондитеры могут читать (для просмотра доступных)
ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inquiries_select_own" ON public.inquiries
  FOR SELECT USING (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('CONFECTIONER', 'ADMIN', 'SUPER_ADMIN')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "inquiries_insert_own" ON public.inquiries
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "inquiries_update_own" ON public.inquiries
  FOR UPDATE USING (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            AND ur.is_active = TRUE)
  );

-- 12.4. negotiations — user + confectioner + admin
ALTER TABLE public.negotiations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "negotiations_select_participants" ON public.negotiations
  FOR SELECT USING (
    auth.uid() = user_id OR
    auth.uid() = confectioner_id OR
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "negotiations_insert_own" ON public.negotiations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "negotiations_update_participants" ON public.negotiations
  FOR UPDATE USING (
    auth.uid() = user_id OR
    auth.uid() = confectioner_id OR
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            AND ur.is_active = TRUE)
  );

-- 12.5. negotiation_revisions — через negotiation_id
ALTER TABLE public.negotiation_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "revisions_select_participants" ON public.negotiation_revisions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.negotiations n
            WHERE n.id = negotiation_id AND (
              n.user_id = auth.uid() OR
              n.confectioner_id = auth.uid() OR
              EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = auth.uid()
                      AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
                      AND ur.is_active = TRUE)
            ))
  );
CREATE POLICY "revisions_insert_participants" ON public.negotiation_revisions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.negotiations n
            WHERE n.id = negotiation_id AND (
              n.user_id = auth.uid() OR
              n.confectioner_id = auth.uid()
            ))
  );

-- 12.6. negotiation_messages — участники переговоров
ALTER TABLE public.negotiation_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "neg_messages_select_participants" ON public.negotiation_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.negotiations n
            WHERE n.id = negotiation_id AND (
              n.user_id = auth.uid() OR
              n.confectioner_id = auth.uid() OR
              EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = auth.uid()
                      AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
                      AND ur.is_active = TRUE)
            ))
  );
CREATE POLICY "neg_messages_insert_participants" ON public.negotiation_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (SELECT 1 FROM public.negotiations n
            WHERE n.id = negotiation_id AND (
              n.user_id = auth.uid() OR
              n.confectioner_id = auth.uid()
            ))
  );
CREATE POLICY "neg_messages_update_own" ON public.negotiation_messages
  FOR UPDATE USING (auth.uid() = sender_id);

-- 12.7. chat_channels — через membership
ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channels_select_member" ON public.chat_channels
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.chat_channel_members ccm
            WHERE ccm.channel_id = id AND ccm.user_id = auth.uid()
            AND ccm.left_at IS NULL) OR
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "channels_insert_own" ON public.chat_channels
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.is_active = TRUE)
  );

-- 12.8. chat_channel_members — участники видят members своего канала
ALTER TABLE public.chat_channel_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_select_channel_participant" ON public.chat_channel_members
  FOR SELECT USING (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM public.chat_channel_members ccm2
            WHERE ccm2.channel_id = channel_id AND ccm2.user_id = auth.uid()
            AND ccm2.left_at IS NULL) OR
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "members_insert_own" ON public.chat_channel_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "members_update_own" ON public.chat_channel_members
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "members_delete_own" ON public.chat_channel_members
  FOR DELETE USING (auth.uid() = user_id);

-- 12.9. chat_messages — участники канала
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_messages_select_member" ON public.chat_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.chat_channel_members ccm
            WHERE ccm.channel_id = chat_messages.channel_id
            AND ccm.user_id = auth.uid() AND ccm.left_at IS NULL) OR
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "chat_messages_insert_member" ON public.chat_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (SELECT 1 FROM public.chat_channel_members ccm
            WHERE ccm.channel_id = chat_messages.channel_id
            AND ccm.user_id = auth.uid() AND ccm.left_at IS NULL)
  );
CREATE POLICY "chat_messages_update_own" ON public.chat_messages
  FOR UPDATE USING (auth.uid() = sender_id);
CREATE POLICY "chat_messages_delete_own" ON public.chat_messages
  FOR DELETE USING (auth.uid() = sender_id);

-- 12.10. chat_message_reads — только свои
ALTER TABLE public.chat_message_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "message_reads_select_own" ON public.chat_message_reads
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "message_reads_insert_own" ON public.chat_message_reads
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 12.11. chat_typing — только участники канала
ALTER TABLE public.chat_typing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "typing_select_member" ON public.chat_typing
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.chat_channel_members ccm
            WHERE ccm.channel_id = chat_typing.channel_id
            AND ccm.user_id = auth.uid())
  );
CREATE POLICY "typing_insert_own" ON public.chat_typing
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "typing_delete_own" ON public.chat_typing
  FOR DELETE USING (auth.uid() = user_id);

-- ===== 13. Triggers =====

-- updated_at для всех таблиц
CREATE OR REPLACE FUNCTION public.handle_chat_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cake_options_updated_at
  BEFORE UPDATE ON public.cake_builder_options
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER cake_drafts_updated_at
  BEFORE UPDATE ON public.cake_builder_drafts
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER inquiries_updated_at
  BEFORE UPDATE ON public.inquiries
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER negotiations_updated_at
  BEFORE UPDATE ON public.negotiations
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER chat_channels_updated_at
  BEFORE UPDATE ON public.chat_channels
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

-- Auto-update channel.last_message_at при INSERT message
CREATE OR REPLACE FUNCTION public.update_channel_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.chat_channels SET
    last_message_at = NEW.created_at,
    last_message_text = COALESCE(NEW.text, '[вложение]'),
    messages_count = messages_count + 1
  WHERE id = NEW.channel_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chat_messages_update_channel
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_channel_last_message();

-- Auto-update inquiry.negotiations_count при INSERT negotiation
CREATE OR REPLACE FUNCTION public.update_inquiry_negotiations_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.inquiries SET
    negotiations_count = (
      SELECT COUNT(*) FROM public.negotiations WHERE inquiry_id = NEW.inquiry_id
    )
  WHERE id = NEW.inquiry_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER negotiations_update_inquiry_count
  AFTER INSERT OR DELETE ON public.negotiations
  FOR EACH ROW EXECUTE FUNCTION public.update_inquiry_negotiations_count();

-- Cleanup expired typing indicators (запускается через pg_cron)
CREATE OR REPLACE FUNCTION public.cleanup_expired_typing()
RETURNS VOID AS $$
BEGIN
  DELETE FROM public.chat_typing WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ===== 14. Permissions =====
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON
  public.cake_builder_drafts, public.inquiries, public.negotiations,
  public.negotiation_revisions, public.negotiation_messages,
  public.chat_channels, public.chat_channel_members,
  public.chat_messages, public.chat_message_reads, public.chat_typing
TO authenticated;

-- ===== Готово =====
-- Тест: SELECT * FROM public.cake_builder_options LIMIT 5;
--       SELECT * FROM public.chat_channels LIMIT 5;
