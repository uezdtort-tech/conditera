import { publicRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return publicRouteMetadata({
    path: "/ready-made",
    title: "Готовые торты и десерты",
    description: "Выбирайте готовые кондитерские изделия из наличия и оформляйте заказ с удобным способом получения.",
  });
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="ready-made" />; }
