-- 0003_seed_inventory.sql — стартовый склад кондитера (демо-данные для
-- «Складской учёт» confectioner@demo.ru и кондитеров витрины).
-- Идемпотентно: ON CONFLICT DO NOTHING по уникальному ключу
-- (owner_id, name) — частичный уникальный индекс ниже.

-- Уникальность (owner_id, name) для активных позиций склада
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_items_owner_name
  ON public.inventory_items(owner_id, name)
  WHERE is_active = true;

INSERT INTO public.inventory_items (owner_id, name, category, quantity, unit, min_quantity, cost_per_unit, supplier)
SELECT p.id, v.name, v.category, v.quantity, v.unit, v.min_quantity, v.cost_per_unit, v.supplier
FROM (VALUES
  ('confectioner@demo.ru', 'Мука пшеничная в/с', 'Мука',   25.0, 'кг',  5.0,  65.0,  'Черкизово'),
  ('confectioner@demo.ru', 'Мука миндальная',      'Мука',    6.5, 'кг',  3.0, 850.0,  'Bake Supply'),
  ('confectioner@demo.ru', 'Сахар-песок',          'Сахар',  18.0, 'кг',  4.0,  58.0,  'Русагро'),
  ('confectioner@demo.ru', 'Масло сливочное 82,5%','Молочка', 9.0, 'кг',  3.0, 790.0,  'Экомилк'),
  ('confectioner@demo.ru', 'Сливки 33-35%',        'Молочка', 7.0, 'л',   3.0, 640.0,  'Экомилк'),
  ('confectioner@demo.ru', 'Сливочный сыр',        'Молочка', 4.0, 'кг',  2.0, 990.0,  'Hochland'),
  ('confectioner@demo.ru', 'Яйцо куриное С0',      'Яйцо',   15.0, 'дес', 4.0, 120.0,  'Роскош'),
  ('confectioner@demo.ru', 'Шоколад тёмный 70%',   'Шоколад', 5.5, 'кг',  2.0,1250.0,  'Callebaut'),
  ('confectioner@demo.ru', 'Шоколад белый',        'Шоколад', 1.2, 'кг',  2.0,1180.0,  'Callebaut'),
  ('confectioner@demo.ru', 'Желатин листовой',     'Добавки', 0.8, 'кг',  0.5,2100.0,  'Bake Supply'),
  ('confectioner@demo.ru', 'Ваниль стручки',       'Добавки', 0.3, 'кг',  0.2,9500.0,  'Bake Supply'),
  ('confectioner@demo.ru', 'Кондитерский мешок 50см','Инвентарь', 20.0, 'шт', 5.0, 35.0, 'Bake Supply')
) AS v(email, name, category, quantity, unit, min_quantity, cost_per_unit, supplier)
JOIN public.profiles p ON p.email = v.email
ON CONFLICT DO NOTHING;

-- Демонстрационная история движений (по 1-2 на кондитера), только если пусто
INSERT INTO public.inventory_movements (item_id, user_id, type, quantity, reason)
SELECT i.id, i.owner_id, 'IN', i.quantity, 'Начальный остаток'
FROM public.inventory_items i
WHERE NOT EXISTS (SELECT 1 FROM public.inventory_movements m WHERE m.item_id = i.id);
