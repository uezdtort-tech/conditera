import { noIndexRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return noIndexRouteMetadata("Акции", "Раздел акций не индексируется до подключения и проверки реальных предложений.");
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="promotions" />; }
