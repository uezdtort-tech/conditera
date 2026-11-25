import { publicRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return publicRouteMetadata({
    path: "/catalog",
    title: "Каталог тортов и десертов на заказ",
    description: "Выбирайте торты и десерты от кондитеров, изучайте состав, фотографии, цены и условия заказа.",
  });
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="catalog" />; }
