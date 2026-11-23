import { publicRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return publicRouteMetadata({
    path: "/for-suppliers",
    title: "Партнёрам и поставщикам",
    description: "Информация о сотрудничестве с маркетплейсом «Уездный кондитер» для поставщиков и партнёров.",
  });
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="for-suppliers" />; }
