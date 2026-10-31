/**
 * recipes-page.tsx — ОБРАТНАЯ СОВМЕСТИМОСТЬ.
 *
 * Реализация каталога рецептов переехала в recipes-catalog.tsx (конвергенция
 * на реальный API GET /api/recipes/marketplace вместо MOCK_RECIPES из store).
 * Этот файл оставлен как thin re-export: на него ссылаются route-fallback.tsx
 * (SPA-маппинг view) и тесты. Маршрут /recipes рендерит каталог напрямую
 * через recipes-route.tsx → recipes-catalog.tsx.
 */
export { RecipesPage } from "./recipes-catalog";
