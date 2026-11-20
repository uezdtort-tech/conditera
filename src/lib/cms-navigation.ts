import type { ViewKey } from "@/lib/types";

const APP_VIEW_KEYS = new Set<string>([
  "home", "catalog", "product", "confectioners", "confectioner-profile",
  "cake-builder", "cart", "checkout", "supplier-shop", "supplier-product",
  "auth", "blog", "tenders", "ready-made", "promotions", "recipes",
  "recipe-detail", "corporate-events", "decor-shop", "services-shop",
  "venues", "gift-certificates", "telegram-bot", "search", "about", "legal",
  "contacts", "help", "reviews", "for-confectioners", "for-suppliers", "faq",
  "dashboard-customer", "dashboard-confectioner", "dashboard-supplier",
  "dashboard-courier", "dashboard-admin", "dashboard-moderator",
  "dashboard-support", "dashboard-copywriter", "dashboard-food-service",
  "dashboard-event-organizer", "dashboard-blogger", "dashboard-pickup-point",
  "dashboard-wholesaler", "dashboard-taster", "dashboard-franchisee",
  "dashboard-nutritionist", "dashboard-corporate-client", "dashboard-inspector",
  "dashboard-certification-agent", "dashboard-venue-owner", "dashboard-studio",
  "dashboard-extra", "dashboard-quality-inspector", "dashboard-animator-agency",
  "dashboard-recreation-center", "dashboard-kids-club", "dashboard-recipe-developer",
  "dashboard-loyalty-partner", "chat",
]);

/**
 * CMS navigation accepts both app view keys ("catalog") and familiar internal
 * paths ("/catalog"). Real Next.js routes such as "/pages/about" return null
 * and are handled by the App Router instead.
 */
export function resolveCmsNavigationView(url: string): ViewKey | null {
  const normalized = url.trim();
  const candidate = normalized === "/" ? "home" : normalized.replace(/^\/+/, "");
  if (!/^[a-z][a-z0-9-]*$/i.test(candidate) || !APP_VIEW_KEYS.has(candidate)) {
    return null;
  }
  return candidate as ViewKey;
}
