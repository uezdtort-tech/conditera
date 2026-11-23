/**
 * GET    /api/products/[id]/slices — список реальных срезов товара.
 * POST   /api/products/[id]/slices — сохранить срез владельцем-кондитером.
 * DELETE /api/products/[id]/slices?sliceId=... — удалить срез владельцем.
 *
 * Все операции записи fail-closed: ошибка проверки владельца или БД никогда
 * не превращается в фиктивный успешный ответ.
 */
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";
import { assertProductSliceOwnership } from "@/lib/product-slices-access";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}
interface SupabaseError {
  message: string;
}
interface ProductSliceRow {
  id: string;
  productId: string;
  fillingName: string;
  image: string | null;
  config: unknown;
  caption: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
interface CreateSliceBody {
  fillingName?: unknown;
  image?: unknown;
  config?: unknown;
  caption?: unknown;
  sortOrder?: unknown;
}

async function requireConfectioner(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) throw new HttpError(401, "Не авторизован");
  if (!user.roles.includes("CONFECTIONER")) throw new HttpError(403, "Только кондитер");
  return user;
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: productId } = await params;
    if (!productId) throw new HttpError(400, "Product ID required");

    // Admin SDK bypasses RLS, поэтому публичный endpoint сам проверяет
    // видимость товара до чтения связанных разрезов.
    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .select("id, status, deleted_at, confectioner_id")
      .eq("id", productId)
      .maybeSingle() as {
        data: { id: string; status: string; deleted_at: string | null; confectioner_id: string | null } | null;
        error: SupabaseError | null;
      };

    if (productError) {
      console.error("[slices] product visibility lookup failed:", productError.message);
      throw new HttpError(500, "Не удалось проверить доступ к товару");
    }
    if (!product || product.deleted_at) throw new HttpError(404, "Товар не найден");
    if (product.status !== "published") {
      const user = await getUserFromRequest(request);
      const isAdmin = Boolean(user?.roles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN"));
      const isOwner = Boolean(
        user?.roles.includes("CONFECTIONER") &&
        product.confectioner_id === user.userId
      );
      if (!isAdmin && !isOwner) throw new HttpError(404, "Товар не найден");
    }

    const { data, error } = await supabaseAdmin
      .from("product_slices")
      .select("id, productId, fillingName, image, config, caption, sortOrder, createdAt, updatedAt")
      .eq("productId", productId)
      .order("sortOrder", { ascending: true })
      .order("createdAt", { ascending: true }) as {
        data: ProductSliceRow[] | null;
        error: SupabaseError | null;
      };

    if (error) {
      console.error("[slices] GET query failed:", error.message);
      throw new HttpError(500, "Не удалось загрузить разрезы");
    }
    const slices = data || [];
    return NextResponse.json({ slices, total: slices.length });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: productId } = await params;
    if (!productId) throw new HttpError(400, "Product ID required");

    const user = await requireConfectioner(request);
    const { data: body, error: parseError } = await safeJsonBody<CreateSliceBody>(request);
    if (parseError || !body) {
      throw new HttpError(400, parseError || "Тело запроса обязательно");
    }

    const fillingName = typeof body.fillingName === "string" ? body.fillingName.trim() : "";
    if (!fillingName || fillingName.length > 120) {
      throw new HttpError(400, "fillingName обязательно и должно быть не длиннее 120 символов");
    }
    const image = typeof body.image === "string" && body.image.trim() ? body.image.trim() : null;
    const config = body.config && typeof body.config === "object" && !Array.isArray(body.config)
      ? body.config
      : null;
    if (!image && !config) {
      throw new HttpError(400, "Нужно указать image (URL) или config (SVG-конфигурация)");
    }
    if (body.image !== undefined && body.image !== null && typeof body.image !== "string") {
      throw new HttpError(400, "image должен быть строкой URL");
    }
    if (body.config !== undefined && body.config !== null && config === null) {
      throw new HttpError(400, "config должен быть JSON-объектом");
    }
    if (body.caption !== undefined && body.caption !== null &&
        (typeof body.caption !== "string" || body.caption.length > 500)) {
      throw new HttpError(400, "caption должен быть строкой не длиннее 500 символов");
    }
    const sortOrder = body.sortOrder === undefined ? 0 : body.sortOrder;
    if (typeof sortOrder !== "number" || !Number.isInteger(sortOrder) ||
        sortOrder < 0 || sortOrder > 100000) {
      throw new HttpError(400, "sortOrder должен быть целым числом от 0 до 100000");
    }

    await assertProductSliceOwnership(productId, user.userId);

    // В миграции 0017 для id и updatedAt нет DEFAULT — задаём их явно.
    const now = new Date().toISOString();
    const { data: slice, error: insertError } = await supabaseAdmin
      .from("product_slices")
      .insert({
        id: randomUUID(),
        productId,
        fillingName,
        image,
        config,
        caption: typeof body.caption === "string" ? body.caption.trim() || null : null,
        sortOrder,
        createdAt: now,
        updatedAt: now,
      })
      .select("id, productId, fillingName, image, config, caption, sortOrder, createdAt, updatedAt")
      .single() as {
        data: ProductSliceRow | null;
        error: SupabaseError | null;
      };

    if (insertError || !slice) {
      console.error("[slices] create failed:", insertError?.message || "empty insert result");
      throw new HttpError(500, "Не удалось сохранить разрез");
    }
    return NextResponse.json({ slice }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: productId } = await params;
    if (!productId) throw new HttpError(400, "Product ID required");
    const sliceId = request.nextUrl.searchParams.get("sliceId");
    if (!sliceId) throw new HttpError(400, "sliceId обязателен");

    const user = await requireConfectioner(request);
    await assertProductSliceOwnership(productId, user.userId);

    const { data, error } = await supabaseAdmin
      .from("product_slices")
      .delete()
      .eq("id", sliceId)
      .eq("productId", productId)
      .select("id")
      .maybeSingle() as {
        data: { id: string } | null;
        error: SupabaseError | null;
      };

    if (error) {
      console.error("[slices] delete failed:", error.message);
      throw new HttpError(500, "Не удалось удалить разрез");
    }
    if (!data) throw new HttpError(404, "Разрез не найден");
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
