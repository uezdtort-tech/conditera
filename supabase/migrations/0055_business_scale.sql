-- 0055_business_scale.sql
-- ============================================================================
-- P0.5 Core — Adaptive Order Lifecycle: профиль масштаба бизнеса кондитера.
--
-- Принцип (ТЗ-корректировка): сложность находится внутри системы, а не
-- перекладывается на пользователя. Масштаб выбирается при регистрации и
-- управляет ТОЛЬКО UI/автоматизацией — движки (lifecycle/capacity/risk)
-- общие для всех уровней:
--
--   home       — домашний кондитер: простой экран «Сегодня», без ERP-терминов
--                (никаких «capacity reservation», «SLA», «production slot»);
--   business   — ИП / ООО / небольшое производство: сотрудники, распределение
--                заказов, загрузка, расширенная аналитика;
--   enterprise — сеть / ресторан / кофейня: Operations Center, смены, SLA.
--
-- Это не вторая система: то же поле статусов, те же события и движки —
-- меняется только «сколько из этого показывать».
-- ============================================================================

ALTER TABLE public.confectioners
  ADD COLUMN IF NOT EXISTS business_scale TEXT NOT NULL DEFAULT 'home';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'confectioners_business_scale_check'
  ) THEN
    ALTER TABLE public.confectioners
      ADD CONSTRAINT confectioners_business_scale_check
      CHECK (business_scale IN ('home', 'business', 'enterprise'));
  END IF;
END $$;

COMMENT ON COLUMN public.confectioners.business_scale IS
  'Масштаб бизнеса (профиль возможностей): home | business | enterprise. Управляет адаптивностью UI, движки общие.';
