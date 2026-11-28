import { noIndexRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return noIndexRouteMetadata("Отзывы", "Раздел отзывов не включён в публичную индексацию до подтверждения источника реальных отзывов.");
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="reviews" />; }
