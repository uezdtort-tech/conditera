/**
 * GET /api/cron/sitemap-refresh — принудительная ревалидация и прогрев sitemap.xml.
 *
 * Sitemap уже ISR (revalidate=60), но cron гарантирует:
 *   1. revalidatePath("/sitemap.xml") — мгновенная перегенерация,
 *      не дожидаясь окна ISR (полезно после массовых публикаций).
 *   2. Прогрев: собственный GET sitemap.xml, чтобы кэш был тёплым
 *      для поисковых ботов.
 *   3. Запись прогона в /api/cron/status (история в админке).
 *
 * Auth: X-Cron-Secret header (см. src/lib/cron-auth.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  const startedAt = Date.now();
  try {
    revalidatePath("/sitemap.xml");

    // Прогрев кэша: запрос собственной sitemap сразу после ревалидации.
    let urlCount = -1;
    try {
      const res = await fetch(`${APP_URL}/sitemap.xml`, { cache: "no-store" });
      if (res.ok) {
        const xml = await res.text();
        urlCount = (xml.match(/<url>/g) || []).length;
      }
    } catch {
      // прогрев не критичен
    }

    const duration = Date.now() - startedAt;
    console.info(`[cron:sitemap-refresh] revalidated, urls=${urlCount}, ${duration}ms`);

    // История прогонов (best-effort)
    try {
      await fetch(`${APP_URL}/api/cron/status`, {
        method: "POST",
        headers: {
          "X-Cron-Secret": process.env.CRON_SECRET || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workflow: "sitemap-refresh",
          status: "success",
          duration,
          sent: urlCount < 0 ? undefined : urlCount,
        }),
      });
    } catch {
      // статус не критичен
    }

    return NextResponse.json({ success: true, urls: urlCount, durationMs: duration });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron:sitemap-refresh] failed:", detail);
    return NextResponse.json({ success: false, error: detail }, { status: 500 });
  }
}
