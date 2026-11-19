import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http-helpers";

interface ProductOwnershipRow {
  id: string;
  confectioner_id: string | null;
}

/** Fail-closed check: only the actual product owner may change cake slices. */
export async function assertProductSliceOwnership(productId: string, userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("id, confectioner_id")
    .eq("id", productId)
    .maybeSingle() as {
      data: ProductOwnershipRow | null;
      error: { message: string } | null;
    };

  if (error) {
    console.error("[product-slices] ownership lookup failed:", error.message);
    throw new HttpError(500, "Не удалось проверить владельца товара");
  }
  if (!data) throw new HttpError(404, "Товар не найден");
  if (data.confectioner_id !== userId) throw new HttpError(403, "Нет прав на этот продукт");
}
