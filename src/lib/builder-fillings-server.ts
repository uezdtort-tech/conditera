import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeBuilderFillings, type BuilderFillingOption } from "./cake-builder-pricing";

/**
 * Серверный источник истины для валидации и цены кастомных тортов (checkout и /api/cart —
 * ЕДИНАЯ формула): начинки из БД status='APPROVED' AND is_active=true, слитые с mock-каталогом
 * (mock остаётся допустимым для легаси-конфигов и оффлайн-фолбэка UI конструктора).
 * Ошибка запроса каталога → throw (fail-closed): маршрут отвечает 503, молчаливого
 * даунгрейда до mock больше нет — клиенты не должны получать расхождение корзина↔checkout.
 */
export async function loadBuilderFillingsForValidation(
  db: SupabaseClient
): Promise<BuilderFillingOption[]> {
  const { data, error } = await db
    .from("fillings")
    .select("id, name, price_multiplier")
    .eq("status", "APPROVED")
    .eq("is_active", true)
    .limit(500);
  if (error) throw new Error(`fillings catalog unavailable: ${error.message}`);
  return mergeBuilderFillings(data ?? []);
}
