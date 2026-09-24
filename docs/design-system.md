# Design System — «Уездный кондитер» v2.0

## Foundations

### Color Tokens (Section 39)

```css
:root {
  /* Brand */
  --color-primary: #8B2942;           /* тёмно-ягодный (бренд) */
  --color-primary-foreground: #FFFFFF;
  --color-accent: #D97706;            /* амбер (CTA, highlights) */
  --color-accent-foreground: #FFFFFF;

  /* Surfaces */
  --color-background: #FFFFFF;
  --color-foreground: #1F2937;        /* slate-800 */
  --color-muted: #F3F4F6;            /* slate-100 */
  --color-muted-foreground: #6B7280;  /* slate-500 */
  --color-border: #E5E7EB;           /* slate-200 */
  --color-card: #FFFFFF;
  --color-card-foreground: #1F2937;

  /* Status */
  --color-destructive: #DC2626;      /* red-600 */
  --color-success: #16A34A;          /* green-600 */
  --color-warning: #F59E0B;          /* amber-500 */
  --color-info: #3B82F6;             /* blue-500 */

  /* Eco */
  --color-eco: #15803D;              /* green-700 */
  --color-eco-light: #DCFCE7;        /* green-100 */
}
```

### Spacing Tokens

```css
:root {
  --space-1: 4px;     /* gap-1 */
  --space-2: 8px;     /* gap-2 */
  --space-3: 12px;    /* gap-3 */
  --space-4: 16px;    /* gap-4 (base) */
  --space-6: 24px;    /* gap-6 */
  --space-8: 32px;    /* gap-8 */
  --space-12: 48px;   /* gap-12 */
  --space-16: 64px;   /* gap-16 */
}
```

### Typography Tokens

```css
:root {
  --font-display: 'Brokgauz_amp_Efron-Italic', serif;   /* заголовки */
  --font-brand: 'TriodPostnaja-Medium', serif;          /* брендовое название */
  --font-script: 'Neucha', cursive;                     /* рукописный акцент */
  --font-body: 'Geist', sans-serif;                     /* основной текст */
  --font-mono: 'Geist_Mono', monospace;                 /* код, технические данные */

  --text-xs: 12px;
  --text-sm: 14px;
  --text-base: 16px;
  --text-lg: 18px;
  --text-xl: 20px;
  --text-2xl: 24px;
  --text-3xl: 30px;
  --text-4xl: 36px;
  --text-5xl: 48px;
}
```

### Radius Tokens

```css
:root {
  --radius-sm: 4px;
  --radius-md: 8px;       /* default */
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-2xl: 24px;
  --radius-full: 9999px;  /* pills, avatars */
}
```

### Elevation Tokens

```css
:root {
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.06);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05);
  --shadow-xl: 0 20px 25px rgba(0,0,0,0.1), 0 10px 10px rgba(0,0,0,0.04);
}
```

### Motion Tokens (Section 40)

```css
:root {
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Breakpoint Tokens

```css
:root {
  --bp-sm: 640px;   /* mobile landscape */
  --bp-md: 768px;   /* tablet */
  --bp-lg: 1024px;  /* desktop */
  --bp-xl: 1280px;  /* large desktop */
  --bp-2xl: 1536px; /* wide screen */
}
```

## Components (Section 38)

### Existing (shadcn/ui)
Button, Input, Label, Textarea, Card, Badge, Avatar, Dialog, Tabs, Checkbox, Select, Separator, Progress, Toaster (Sonner), Tooltip

### Custom (v2.0)
- `DashboardShell` — layout для таб-стиля
- `DashboardSidebarLayout` — layout с sidebar
- `SidebarTab`, `SidebarStat` — sidebar элементы
- `StatCard` — горизонтальная статистика
- `EmptyState` — пустое состояние с CTA
- `LoadingState` — skeleton для TanStack Query loading
- `ErrorState` — error card с retry кнопкой
- `FillingSlicePreview` — 3D-превью среза торта
- `OptionCard` — карточка опции (selected/unselected)

### Missing (Section 62 — 22 компонента)
- AI Search Bar
- AI Shopping Assistant
- Intent Chips
- Product Card 2.0
- Maker Card
- Video Product Card
- Recommendation Rail
- Occasion Collection
- Compare Drawer
- Offer Card
- Negotiation Timeline
- Sustainability Panel
- Delivery Choice
- Availability Calendar
- Smart Filters
- Visual Search
- Collection Board
- Gift Mode
- Order Timeline
- Trust Panel
- AI Builder Assistant

## Patterns (Section 38)

### Loading
- Skeleton placeholders (не спиннеры)
- Progressive image loading (blur placeholder)
- Lazy-load video (Intersection Observer)

### Empty States (Section 65)
Каждый empty state должен быть полезным:
- Заголовок + описание
- CTA кнопка ("Посмотреть популярные", "Создать свой торт")
- Иллюстрация или иконка

### Error States (Section 66)
- Понятное сообщение
- Кнопка "Повторить"
- Контакт support

### Zero-result Experience (Section 64)
Не "Ничего не найдено", а:
- Похожие варианты
- Ближайшие даты
- Соседние города
- Альтернативный бюджет
- AI-assisted refinement

## Templates

### Product Card 2.0 (Section 9)
- Большое фото
- Maker badge
- Trust badges (verified, rating, eco)
- Price с скидкой
- Quick actions (save, compare, customize)
- Dietary badges

### Maker Card (Section 11)
- Avatar + businessName
- Rating + reviews
- Specialization
- Location + delivery zones
- Response time
- Trust badges
