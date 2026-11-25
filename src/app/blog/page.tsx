import { noIndexRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return noIndexRouteMetadata("Блог", "Материалы блога пока не включены в публичную индексацию.");
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="blog" />; }
