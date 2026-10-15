# U-05 — Cake constructor (UI acceptance)

- **Date:** 2026-10-15, agent session (task 8-c)
- **HEAD short:** `1362744`
- **Live server:** http://127.0.0.1:3000 (pre-existing dev server, not restarted)
- **Tool:** agent-browser (headless Chromium), viewport 1440×900
- **Status: PASS**

## 1. Route discovery

- `rg "constructor|конструктор" src/app/**/page.tsx` → no direct hit in page files;
  hits in `src/app/checkout/success/page.tsx` (comment only).
- Nav source of truth: `src/components/layout/header.tsx:289` → `navigate("cake-builder")`;
  `src/components/route-fallback.tsx:140` maps view `cake-builder` → `<CakeBuilderPage />`
  (`src/components/cake-builder/cake-builder-page.tsx`), rendered by
  `src/app/cake-builder/page.tsx`.
- **Route used: `http://127.0.0.1:3000/cake-builder`** (GET 200).
- Page self-describes as «Конструктор десертов», 9 steps
  (`STEP_LABELS`: Тип изделия → Мероприятие → Основа → Начинка → Покрытие → Декор → Диета → Доставка → Резюме).

## 2. Walkthrough (all agent-browser commands exited 0)

| Step | Action | Result |
|---|---|---|
| 0 | Selected «🎂 Торт» | Header «Конструктор: Торт Шаг 2 / 9»; price 1 500 ₽ → **~2 220 ₽** (unit 1500 + 4×180 ₽ за порции 8−min 4) |
| 1 | Selected «День рождения» | → Шаг 3/9 |
| 2 | Price before base selection: **~2 220 ₽**; selected «Муссовый» (+400 ₽) | price **→ ~2 620 ₽** (CHANGED ✓) |
| 3 | Selected filling «Три шоколада» (+300 ₽, из БД `/api/fillings/list`, группа «Шоколадные») | **→ ~2 920 ₽** (CHANGED ✓) |
| 4 | Selected coating «Белый ганаш» (+200 ₽) | **→ ~3 120 ₽** (CHANGED ✓) |
| 5 | Added decoration «Свежие ягоды» (+400 ₽) | **→ ~3 520 ₽** (CHANGED ✓) |
| 6 | Dietary step skipped | → Шаг 8/9 |
| 7 | See validation check below; then filled Город=Москва, Дата=2026-12-20, Способ=«Доставка» | price **→ ~4 928 ₽** (Москва regional multiplier ×1.4 на 3 520; доставка бесплатная ≥3000 ₽) |
| 7 | Changed «Количество порций» 8 → 12 | **→ ~5 936 ₽** = (2800 + 8×180) × 1.4 (CHANGED ✓) |
| 8 | «Добавить в корзину» button visible (footer, `step >= 7`), clicked | **auth modal opened** + toast «Войдите, чтобы добавить торт в корзину» — order-start point reached; purchase NOT completed (test-data only, no auth performed) |

### Price before/after (primary assertion)

- **Before parameter change** (Шаг 3, только Торт выбран): `Оценка: ~2 220 ₽`
- **After parameter change** (выбрана основа «Муссовый» +400 ₽): `Оценка: ~2 620 ₽`
- DOM element: sticky summary card («Ваш заказ»), row «Оценка:» → `<span class="font-bold text-primary text-lg">~N ₽</span>`
  (`cake-builder-page.tsx:1195-1201`, `formatCurrency(regionalPrice + deliveryCost)`).
- Full chain recorded: 1500 → 2220 → 2620 → 2920 → 3120 → 3520 → 4928 (×1.4 Москва) → 5936 (порции 8→12). Every option price modifier reflected immediately.

## 3. Validation check (required field empty)

- On Шаг 8/9 (Доставка) with empty **Город**, **Дата доставки**, **Способ получения**:
  - `Далее` button **disabled=true** (`disabled={!canProceed()}`, `canProceed()` step 7 requires city && deliveryDate && deliveryType);
  - honest click attempt (`.click()` on the disabled button) → **step stays «Шаг 8 из 9»**, no navigation, no toast (button disabled blocks the handler; the `toast.error("Заполните обязательные поля")` guard exists in `handleNext`, `cake-builder-page.tsx:261-265`, for direct calls);
  - screenshot: `U-05-constructor-1362744-validation-required-empty.png`.
- Recovery: after filling city + date (and picking «Доставка») `Далее` becomes enabled=false→false… i.e. `disabled:false` → walkthrough continues.
- Note (test tooling, not a product bug): the React controlled `<input type="date">` did not commit value via plain `fill`; value was set through native value setter + `input`/`change` events (standard React-test practice), after which state updated correctly.

## 4. Key DOM assertions

- `h1` = «Конструктор десертов» / «Конструктор: Торт»; step counter «Шаг N из 9» updates per step.
- Option cards carry explicit price modifiers («+400 ₽», «+300 ₽», «сезон» badge for seasonal fillings).
- Fillings are loaded live from `GET /api/fillings/list?status=APPROVED` (DB fillings with flavor groups «Ягодные (8)», «Шоколадные (6)», «Кремовые (6)» observed in UI).
- Final URL: `http://127.0.0.1:3000/cake-builder`.
- Console: no page errors (only HMR/dev info logs).

## 5. Artifacts

| File | Content |
|---|---|
| `U-05-constructor-1362744-validation-required-empty.png` | Шаг 8/9 «Доставка» with empty required fields, `Далее` disabled |
| `U-05-constructor-1362744-step8-summary-price.png` | Шаг 9/9 «Выберите кондитеров», sticky summary «Оценка: ~5 936 ₽», «Добавить в корзину» visible |
| `U-05-constructor-1362744-add-to-cart-auth-gate.png` | Auth modal + toast after «Добавить в корзину» (guest) |

## 6. Verdict

**PASS** — constructor is walkable end-to-end to the cart/order-start boundary; live price estimate reacts to every parameter change (base, filling, coating, decor, servings, city multiplier); required-field validation is visible (disabled «Далее») and blocks progression.
