-- 0020_filling_moderation.sql
-- ============================================================================
-- Добавляет колонки модерации и управления для таблицы fillings.
--
-- Согласно ТЗ: начинки добавляются кондитерами, после согласования и
-- редактирования администратором. Эта миграция добавляет:
--   • status (APPROVED/PENDING/REJECTED) — для модерации
--   • created_by — кто создал (конфитер или система)
--   • created_by_name — имя создателя (для отображения)
--   • usage_count — сколько раз выбрано в конструкторе (для сортировки)
--   • admin_notes — заметки администратора при модерации
--   • approved_by — кто одобрил (админ)
--   • approved_at — когда одобрено
--   • rejected_reason — причина отклонения
-- ============================================================================

-- Добавляем колонку status (если ещё нет)
DO $$ BEGIN
  ALTER TABLE public.fillings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'APPROVED';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Добавляем остальные колонки модерации
DO $$ BEGIN
  ALTER TABLE public.fillings ADD COLUMN IF NOT EXISTS created_by UUID;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.fillings ADD COLUMN IF NOT EXISTS created_by_name TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.fillings ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.fillings ADD COLUMN IF NOT EXISTS admin_notes TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.fillings ADD COLUMN IF NOT EXISTS approved_by UUID;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.fillings ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.fillings ADD COLUMN IF NOT EXISTS rejected_reason TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Индексы для типичных запросов
CREATE INDEX IF NOT EXISTS idx_fillings_status ON public.fillings(status);
CREATE INDEX IF NOT EXISTS idx_fillings_usage_count ON public.fillings(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_fillings_created_by ON public.fillings(created_by);
CREATE INDEX IF NOT EXISTS idx_fillings_flavor_status ON public.fillings(flavor_group, status);

-- Комментарии
COMMENT ON COLUMN public.fillings.status IS 'APPROVED | PENDING | REJECTED — модерация начинок кондитеров';
COMMENT ON COLUMN public.fillings.created_by IS 'UUID кондитера, который создал начинку (NULL для системных)';
COMMENT ON COLUMN public.fillings.created_by_name IS 'Имя/название кондитера для отображения';
COMMENT ON COLUMN public.fillings.usage_count IS 'Сколько раз выбрано в конструкторе — для сортировки по популярности';
COMMENT ON COLUMN public.fillings.admin_notes IS 'Заметки администратора при модерации';
COMMENT ON COLUMN public.fillings.approved_by IS 'UUID администратора, который одобрил';
COMMENT ON COLUMN public.fillings.approved_at IS 'Когда администратор одобрил начинку';
COMMENT ON COLUMN public.fillings.rejected_reason IS 'Причина отклонения (если status=REJECTED)';

-- Обновляем RLS политики для модерации
-- Удаляем старые политики
DROP POLICY IF EXISTS "fillings_select_public" ON public.fillings;
DROP POLICY IF EXISTS "fillings_write_admin" ON public.fillings;

-- Публичное чтение: только APPROVED начинки видны всем
CREATE POLICY "fillings_select_approved" ON public.fillings
  FOR SELECT USING (
    status = 'APPROVED'
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
    OR created_by = auth.uid()
  );

-- Вставлять могут: аутентифицированные (кондитеры создают PENDING)
CREATE POLICY "fillings_insert_auth" ON public.fillings
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Обновлять могут: владелец (created_by) или админ
CREATE POLICY "fillings_update_own_or_admin" ON public.fillings
  FOR UPDATE USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );

-- Удалять могут: только админ
CREATE POLICY "fillings_delete_admin" ON public.fillings
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );

-- Все существующие начинки в БД получают status=APPROVED (они были seed-данными)
UPDATE public.fillings SET status = 'APPROVED' WHERE status IS NULL OR status = '';
