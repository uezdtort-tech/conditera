// GET /api/search?q=торт&category=cakes&maxPrice=3000&sort=price:asc
// Полнотекстовый поиск через Meilisearch с фильтрами и фасетами.
import { NextRequest, NextResponse } from "next/server";
import { searchProducts } from "@/lib/meilisearch";
import { z } from "zod";

const searchSchema = z.object({
  q: z.string().max(500).default(""),
  category: z.string().max(50).optional(),
  confectionerId: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  isPopular: z.coerce.boolean().optional(),
  isNew: z.coerce.boolean().optional(),
  isHit: z.coerce.boolean().optional(),
  sort: z.enum(["price:asc", "price:desc", "rating:desc", "createdAt:desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawParams: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      rawParams[key] = value;
    });

    const parse = searchSchema.safeParse(rawParams);
    if (!parse.success) {
      return NextResponse.json(
        { error: "Invalid search parameters", details: parse.error.flatten() },
        { status: 400 }
      );
    }

    const params = parse.data;
    const results = await searchProducts(params.q, {
      category: params.category,
      confectionerId: params.confectionerId,
      city: params.city,
      minPrice: params.minPrice,
      maxPrice: params.maxPrice,
      minRating: params.minRating,
      isPopular: params.isPopular,
      isNew: params.isNew,
      isHit: params.isHit,
      sort: params.sort,
      limit: params.limit,
      offset: params.offset,
    });

    return NextResponse.json({
      query: params.q,
      hits: results.hits,
      totalHits: results.totalHits,
      processingTimeMs: results.processingTimeMs,
      limit: params.limit,
      offset: params.offset,
    });
  } catch (error) {
    console.error("GET /api/search error:", error);
    return NextResponse.json(
      { error: "Search failed", message: (error as Error).message },
      { status: 500 }
    );
  }
}
