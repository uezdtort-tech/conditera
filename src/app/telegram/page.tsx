import { noIndexRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return noIndexRouteMetadata("Telegram", "Страница интеграции Telegram не включена в публичную индексацию.");
}

/**
 * Telegram Mini App — страница для встраивания в Telegram WebApp.
 *
 * URL: https://conditera.ru/telegram?initData=...
 *
 * Полноценный каталог тортов + быстрый заказ внутри Telegram.
 */
import { CatalogPage } from "@/components/pages/catalog-page";

export default function TelegramWebAppPage() {
  return (
    <div className="telegram-webapp">
      <CatalogPage />
    </div>
  );
}
