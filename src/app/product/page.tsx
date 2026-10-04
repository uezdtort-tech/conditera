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

export const metadata = {
  title: "Товар — Уездный кондитер",
  description: "Карточка кондитерского изделия: состав, цена, отзывы и заказ у частного кондитера.",
};

export default function Page() {
  return <RouteFallback view="product" />;
}
