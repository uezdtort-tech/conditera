import { publicRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return publicRouteMetadata({
    path: "/confectioners",
    title: "Кондитеры и домашние кондитерские",
    description: "Находите проверенных кондитеров, смотрите портфолио и заказывайте торты и десерты напрямую через платформу.",
  });
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="confectioners" />; }
