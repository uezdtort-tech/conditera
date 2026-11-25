import { noIndexRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return noIndexRouteMetadata("Корпоративные мероприятия", "Раздел корпоративных заказов находится в подготовке.");
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="corporate-events" />; }
