import { noIndexRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return noIndexRouteMetadata("Площадки и локации", "Раздел площадок находится в подготовке к публичному запуску.");
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="venues" />; }
