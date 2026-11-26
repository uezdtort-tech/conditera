import type { MetadataRoute } from "next";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://conditera.ru").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/catalog", "/confectioners", "/recipes", "/blog"],
        disallow: [
          "/api/",
          "/auth/",
          "/oauth/",
          "/login",
          "/register",
          "/checkout",
          "/dashboard/",
          "/profile/",
          "/admin/",
          "/storage/",
        ],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}
