# ПРОМПТ S1B3 — Дизайн-система 2025 + тема

Этап 1 «Фундамент» | Блок 3. Зависимости: S1B1 (каркас).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — UI-инженер дизайн-систем. Ты переносишь и документируешь дизайн-систему
CONDITERA 2025 как переиспользуемую основу всех поверхностей v2.

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict; bun (:3000, lint, tsc).
- Tailwind CSS 4 + shadcn/ui (New York, Lucide). ЗАПРЕЩЕНЫ indigo/blue.
- UI-правила: mobile-first; sticky footer (wrapper `min-h-screen flex
  flex-col`, футеру `mt-auto` + safe-area); длинные списки `max-h-96
  overflow-y-auto` со стилизованным скроллом; семантические теги + ARIA;
  анимации — subtle (reduced-motion безопасно).
- Тема: Zustand persist (ключ `conditera-storage`, поле `state.theme`);
  next-themes НЕ использовать.
- Процесс: коммит `[S1B3] ...`; tsc→vitest→agent-browser; worklog.md;
  тесты не писать.

## 3. ЦЕЛЬ БЛОКА
Токены + утилиты дизайн-системы 2025 в globals.css, набор базовых
компонентов-обёрток, страница-витрина (style guide) для контроля, тёмная
тема для всех токенов.

## 4. ШАГИ
1. Перенести из старого проекта `src/app/globals.css` ПОЛНОСТЬЮ: CSS-перем
  енные (--background, --foreground, --primary, --card, --radius и пр.),
  утилиты `.card-hover` (слоистая тень + lift −3px + малиновая обводка),
  `.fade-up`, `.btn-primary-gradient`, `.mesh-gradient`, стили скролла.
   Убедиться, что все 14+ определений утилит перенесены, каждая — с
   @media (prefers-reduced-motion) гвардом там, где есть анимация.
2. Дополнить тёмной темой: все переменные должны иметь значения в
   .dark-контексте; проверить контраст пар текст/фон (минимум AA).
3. Создать src/components/ui/обёртки (поверх shadcn):
   - `PageHeader` (h1 с fade-up + подзаголовок + слот-действия);
   - `ShopCard` (карточка товара с card-hover, бейджи, цена);
   - `SectionHeading`, `EmptyState` (иллюстрация-заглушка + CTA);
   - `StatCard` (для дашбордов), `SafeImage` (next/image + fallback).
4. Расширить shadcn-компоненты до полного набора: button, card, badge,
   dialog, dropdown-menu, input, textarea, select, tabs, toast/sonner,
   skeleton, switch, table, tooltip, avatar, separator, sheet.
5. Палитра бренда: малиново-ягодный primary (как в старом globals.css),
   нейтральные фоны; ЗАПРЕЩЕНО вводить indigo/blue.
6. Style guide страница `/styleguide` (только для разработки, ссылка из
   футера в dev-режиме): все токены, кнопки, карточки, состояния, тёмная
   тема, типографика. Это «живой» референс для S3–S7.
7. Тема: кнопка ThemeToggle в шапке (иконка Sun/Moon, Zustand persist,
   класс на <html>), проверка сохранения после перезагрузки.

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- src/app/globals.css — целиком (дизайн-система 2025);
- src/components/layout/theme-toggle.tsx — паттерн;
- паттерны карточек из catalog-page/promotions-page (card-hover
  применение, fade-up на заголовках).

## 6. ЗАПРЕТЫ
- Не вводить новые цвета вне токенов.
- Не использовать mesh-gradient как обязательный элемент (он fallback для
  баннеров без изображений — учёт из старого проекта).
- Не менять ключ localStorage (conditera-storage).

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] /styleguide рендерится: токены, кнопки, карточки, EmptyState;
- [ ] Все утилиты 2025 присутствуют в globals.css (card-hover, fade-up,
      btn-primary-gradient, mesh-gradient);
- [ ] Тёмная тема: ни один текст не теряет контраст; переключение и
      восстановление после reload работает;
- [ ] card-hover: hover — lift и малиновая обводка; reduced-motion —
      без анимации;
- [ ] tsc 0, lint 0; коммит [S1B3]; worklog дополнен.

## 8. ВЕРИФИКАЦИЯ (agent-browser)
- /styleguide: сделать скриншоты light/dark;
- hover на карточке (agent-browser: hover событие) — трансформация видна;
- мобильная ширина 390px — карточки в 1 колонку, футер прижат.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S1B3]; worklog (перечень перенесённых токенов/утилит).
- Отчёт владельцу: что вошло в систему, путь к style guide, как
  применять в следующих блоках.
