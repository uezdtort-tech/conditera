/**
 * GET /api/products/[id]/similar — похожие товары для карточки (P2.3).
 *
 * Детерминированный движок recommendations.ts (тот же SearchDoc, что и
 * поиск): score > 0 — минимум один реальный сигнал сходства; каждая
 * рекомендация несёт фактические причины (ТЗ §9: «Похожая категория»,
 * «От того же кондитера», «Похожий вкус: …»…). Снятые с продажи товары
 * не рекомендуются; сам товар исключён.
 *
 * Ответ: { items: [{ id, title, slug, price, images, servings, rating,
 * reviewsCount, isAvailable, categorySlug, confectioner, score, reasons }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { recommendSimilar } from "@/lib/recommendations";
import {
  buildResponseItem,
  loadProductRowByIdOrSlug,
  loadRecommendationData,
  rowToSubject,
} from "@/lib/server/recommendation-data";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const targetId = decodeURIComponent(id || "").trim();
    if (!targetId) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const rawLimit = Number(searchParams.get("limit") || "6");
    const limit = Number.isFinite(rawLimit)
      ? Math.min(12, Math.max(1, Math.floor(rawLimit)))
      : 6;

    const [targetRow, pool] = await Promise.all([
      loadProductRowByIdOrSlug(targetId),
      loadRecommendationData(),
    ]);
    if (!targetRow) {
      return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
    }

    const target = rowToSubject(targetRow, pool.slugById);
    const recs = recommendSimilar(target, pool.subjects, { limit });

    return NextResponse.json(
      { items: recs.map((rec) => buildResponseItem(rec, pool.metaById)) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[products/similar] GET error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
