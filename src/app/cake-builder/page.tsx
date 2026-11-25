import { noIndexRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return noIndexRouteMetadata("Конструктор торта", "Инструмент создания индивидуального торта находится в подготовке к публичному запуску.");
}

import { RouteFallback } from '@/components/route-fallback';

export default function Page() {
  return <RouteFallback view="cake-builder" />;
}
