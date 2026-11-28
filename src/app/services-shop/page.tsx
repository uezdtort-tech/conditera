import { noIndexRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return noIndexRouteMetadata("Магазин услуг", "Модуль услуг не включён в публичную индексацию до завершения интеграции.");
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="services-shop" />; }
