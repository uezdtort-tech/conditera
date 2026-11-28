import { noIndexRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return noIndexRouteMetadata("Магазин поставщиков", "Модуль магазина поставщиков находится в подготовке и не индексируется.");
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="supplier-shop" />; }
