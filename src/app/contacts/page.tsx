import { publicRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return publicRouteMetadata({
    path: "/contacts",
    title: "Контакты",
    description: "Свяжитесь с командой «Уездного кондитера» по вопросам заказов, сотрудничества и поддержки.",
  });
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="contacts" />; }
