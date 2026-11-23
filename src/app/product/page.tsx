/**
 * /product?id={uuid|slug} — карточка товара (deep link).
 *
 * Раньше URL-маршрута /product не существовало: переход по прямой ссылке
 * отдавал 404 («Страница не найдена»), хотя view 'product' поддерживался
 * SPA-навигацией. Теперь карточка открывается по ссылке и шарится.
 *
 * Параметры читает RouteFallback (URLSearchParams → store.nav.params.id).
 */
import { RouteFallback } from "@/components/route-fallback";

import { noIndexRouteMetadata } from "@/lib/route-metadata";

export const metadata = noIndexRouteMetadata(
  "Карточка товара",
  "Страница товара с параметром идентификатора; публичная индексация будет включена после перехода на канонические URL товаров.",
);

export default function Page() {
  return <RouteFallback view="product" />;
}
