import { publicRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return publicRouteMetadata({
    path: "/for-confectioners",
    title: "Платформа для кондитеров",
    description: "Принимайте заказы онлайн, общайтесь с покупателями и управляйте производством и продажами в одном кабинете.",
  });
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="for-confectioners" />; }
