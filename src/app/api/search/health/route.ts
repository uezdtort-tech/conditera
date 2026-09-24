// GET /api/search/health — проверка статуса Meilisearch.
// Используется в Docker healthcheck и админ-панели.
import { NextResponse } from "next/server";
import { isMeilisearchHealthy } from "@/lib/meilisearch";

export async function GET() {
  const healthy = await isMeilisearchHealthy();
  return NextResponse.json(
    {
      status: healthy ? "ok" : "unavailable",
      service: "meilisearch",
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  );
}
