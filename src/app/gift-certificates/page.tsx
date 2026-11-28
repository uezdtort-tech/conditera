import { noIndexRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return noIndexRouteMetadata("Подарочные сертификаты", "Раздел подарочных сертификатов не индексируется до подключения рабочего механизма выпуска и погашения.");
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="gift-certificates" />; }
