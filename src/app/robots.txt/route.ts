/**
 * П.23: robots.txt через полноценный route handler (НЕ metadata-роут).
 *
 * Почему не robots.ts (MetadataRoute): сериализатор Next.js пишет
 * "User-Agent:", а канон формата robots.txt (RFC 9309) и E2E-контракт
 * требуют "User-agent:"; MetadataRoute также не допускает возврат
 * сырого Response (metadata-версия отвечала 500).
 *
 * Запрещает индексацию приватных зон (/dashboard, /api, /checkout,
 * /admin, /profile, /orders), разрешает публичные страницы, указывает
 * sitemap.xml. Социальные краулеры — полный доступ (OG-превью).
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

const DISALLOW = [
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
];

const SOCIAL_CRAWLERS = [
  "Googlebot",
  "Bingbot",
  "Twitterbot",
  "facebookexternalhit",
  "LinkedInBot",
  "TelegramBot",
  "SkypeUriPreview",
];

function buildRobotsTxt(): string {
  const lines: string[] = [];
  lines.push("User-agent: *");
  lines.push("Allow: /");
  for (const path of DISALLOW) lines.push(`Disallow: ${path}`);
  for (const bot of SOCIAL_CRAWLERS) {
    lines.push("");
    lines.push(`User-agent: ${bot}`);
    lines.push("Allow: /");
  }
  lines.push("");
  lines.push(`Sitemap: ${APP_URL}/sitemap.xml`);
  lines.push(`Host: ${APP_URL}`);
  return lines.join("\n") + "\n";
}

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildRobotsTxt(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
