import { publicRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return publicRouteMetadata({
    path: "/faq",
    title: "Помощь покупателям и кондитерам",
    description: "Инструкции и ответы на вопросы о заказах, оплате, доставке и использовании платформы.",
  });
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="help" />; }
