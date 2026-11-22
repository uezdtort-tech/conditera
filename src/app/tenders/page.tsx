import { noIndexRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return noIndexRouteMetadata("Тендеры и заявки", "Раздел тендеров не индексируется до проверки реальных заявок и предложений.");
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="tenders" />; }
