import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http-helpers";

interface ConfectionerRow {
  id: string;
}
interface ProductOwnershipRow {
  id: string;
  confectioner_id: string | null;
}

/**
 * Проверяет владение через профиль confectioners.
 * products.confectioner_id хранит ID профиля кондитера, а не auth user ID.
 * Любая ошибка/неопределённость закрывает изменение.
 */
export async function assertProductSliceOwnership(productId: string, userId: string): Promise<void> {
  const { data: confectioner, error: confectionerError } = await supabaseAdmin
    .from("confectioners")
    .select("id")
    .eq("userId", userId)
    .maybeSingle() as {
      data: ConfectionerRow | null;
      error: { message: string } | null;
    };

  if (confectionerError) {
    console.error("[product-slices] confectioner lookup failed:", confectionerError.message);
    throw new HttpError(500, "Не удалось проверить профиль кондитера");
  }
  if (!confectioner) throw new HttpError(404, "Профиль кондитера не найден");

  const { data: product, error: productError } = await supabaseAdmin
    .from("products")
    .select("id, confectioner_id")
    .eq("id", productId)
    .maybeSingle() as {
      data: ProductOwnershipRow | null;
      error: { message: string } | null;
    };

  if (productError) {
    console.error("[product-slices] product lookup failed:", productError.message);
    throw new HttpError(500, "Не удалось проверить владельца товара");
  }
  if (!product) throw new HttpError(404, "Товар не найден");
  if (product.confectioner_id !== confectioner.id) {
    throw new HttpError(403, "Нет прав на этот продукт");
  }
}
