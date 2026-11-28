import { publicRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return publicRouteMetadata({
    path: "/faq",
    title: "Частые вопросы",
    description: "Ответы на вопросы покупателей и кондитеров о заказах, оплате, доставке, возвратах и работе платформы.",
  });
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="faq" />; }
