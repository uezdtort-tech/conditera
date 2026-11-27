import type { MetadataRoute } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://conditera.ru";

/** Public pages are indexable; private and transactional surfaces are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin",
          "/admin/",
          "/dashboard",
          "/dashboard/",
          "/account",
          "/account/",
          "/profile",
          "/profile/",
          "/orders",
          "/orders/",
          "/checkout",
          "/cart",
        ],
      },
    ],
    sitemap: new URL("/sitemap.xml", APP_URL).toString(),
    host: APP_URL,
  };
}
