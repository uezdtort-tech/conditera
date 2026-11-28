import { noIndexRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return noIndexRouteMetadata("Telegram-бот", "Страница настройки Telegram-бота не является публичной посадочной страницей.");
}

import { RouteFallback } from '@/components/route-fallback';
export default function Page() { return <RouteFallback view="telegram-bot" />; }
