/**
 * GET /api/admin/product-media — очередь модерации товарных медиа (Task 2-b).
 *
 * Query:
 *   - status: pending | approved | rejected | all (default pending);
 *   - limit:  1..100 (default 50);
 *   - offset: >= 0 (default 0).
 *
 * Права: MODERATOR | ADMIN | SUPER_ADMIN (requireAnyRole-семантика).
 *
 * Ответ: { items, total, limit, offset }; item — строка product_media
 * (snake_case) + 1-level embed product: {id, title, slug, status};
 * total — отдельным count-запросом.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";
import {
  hasModeratorRole,
  jsonError,
} from "@/lib/product-media/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const STATUS_FILTERS = new Set(["pending", "approved", "rejected", "all"]);

interface EmbeddedProduct {
  id: string;
  title: string;
  slug: string;
  status: string;
}

interface AdminMediaItem {
  id: string;
  product_id: string;
  media_type: "photo" | "video";
  storage_path: string;
  original_filename: string | null;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  sort_order: number;
  status: "pending" | "approved" | "rejected";
  is_cover: boolean;
  uploaded_by: string | null;
  uploaded_at: string;
  moderated_by: string | null;
  moderated_at: string | null;
  moderation_comment: string | null;
  created_at: string;
  updated_at: string;
  product: EmbeddedProduct | null;
}

export async function GET(
  request: NextRequest
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return jsonError(401, "UNAUTHORIZED", "Необходима аутентификация");
    }
    if (!(await hasModeratorRole(user.id))) {
      return jsonError(
        403,
        "FORBIDDEN",
        "Требуется одна из ролей: MODERATOR, ADMIN, SUPER_ADMIN"
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";
    if (!STATUS_FILTERS.has(status)) {
      return jsonError(
        422,
        "VALIDATION_FAILED",
        "status должен быть pending | approved | rejected | all"
      );
    }

    const limitRaw = Number.parseInt(searchParams.get("limit") || "", 10);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, MAX_LIMIT)
        : DEFAULT_LIMIT;
    const offsetRaw = Number.parseInt(searchParams.get("offset") || "", 10);
    const offset =
      Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

    // Do not rely on a PostgREST embedded relationship here: schema-cache
    // refresh can lag immediately after a clean migration. Load media and
    // product snapshots independently, then join by the explicit FK value.
    let query = supabaseAdmin
      .from("product_media")
      .select("*");
    if (status !== "all") {
      query = query.eq("status", status);
    }
    const { data: mediaRows, error } = await query
      .order("uploaded_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("[admin/product-media] query error:", error.message);
      return jsonError(500, "INTERNAL_ERROR", "Не удалось получить очередь");
    }

    const productIds = [...new Set((mediaRows || []).map((row) => row.product_id).filter(Boolean))];
    const productsById = new Map<string, EmbeddedProduct>();
    if (productIds.length > 0) {
      const { data: products, error: productsError } = await supabaseAdmin
        .from("products")
        .select("id, title, slug, status")
        .in("id", productIds);
      if (productsError) {
        console.error("[admin/product-media] product snapshot query error:", productsError.message);
        return jsonError(500, "INTERNAL_ERROR", "Не удалось получить товары очереди");
      }
      for (const product of products || []) {
        productsById.set(product.id, product as EmbeddedProduct);
      }
    }
    const items = (mediaRows || []).map((row) => ({
      ...row,
      product: productsById.get(row.product_id) || null,
    }));

    // total — отдельным count-запросом (тот же фильтр статуса)
    const pool = getPool();
    const countResult =
      status === "all"
        ? await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM product_media`
          )
        : await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM product_media WHERE status = $1`,
            [status]
          );

    return NextResponse.json({
      items: (items as AdminMediaItem[]) ?? [],
      total: countResult.rows[0]?.n ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[admin/product-media] GET error:", error);
    return jsonError(500, "INTERNAL_ERROR", "Внутренняя ошибка сервера");
  }
}
