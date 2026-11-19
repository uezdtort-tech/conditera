/**
 * П.23: Динамический robots.txt через Next.js metadata route.
 *
 * Запрещает индексацию:
 *  - /dashboard/* — приватные кабинеты
 *  - /api/* — API endpoints
 *  - /checkout — корзина/оплата
 *  - /admin — админ-панель
 *
 * Разрешает индексацию всех публичных страниц.
 * Указывает путь к sitemap.xml.
 */
import type { MetadataRoute } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/dashboard/*",
          "/api",
          "/api/*",
          "/checkout",
          "/admin",
          "/admin/*",
          "/profile",
          "/profile/*",
          "/orders",
          "/orders/*",
        ],
      },
      // Социальные краулеры — полный доступ (для OG-превью)
      {
        userAgent: ["Googlebot", "Bingbot", "Twitterbot", "facebookexternalhit", "LinkedInBot", "TelegramBot", "SkypeUriPreview"],
        allow: "/",
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}
