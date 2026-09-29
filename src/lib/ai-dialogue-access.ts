/**
 * pay4 IDOR-guard: доступ к AI-диалогу пары (customerId, confectionerId).
 *
 * Прежде learn/respond/context принимали customerId/confectionerId из
 * body/query БЕЗ сверки с токеном — любой аутентифицированный пользователь
 * мог читать/писать AI-память и learning-профиль произвольного пользователя.
 *
 * Разрешено:
 *  1) покупателю — только к СВОЕМУ customerId;
 *  2) кондитеру — только к парам со СВОИМ confectionerId
 *     (confectionerId может приходить как confectioners.id (cuid)
 *     или как auth-UUID userId — поддерживаем обе конвенции).
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http-helpers";

export async function assertDialoguePairAccess(
  user: { userId: string },
  customerId: string,
  confectionerId: string
): Promise<void> {
  if (customerId === user.userId) return; // свой контекст — всегда можно

  const { data: conf, error } = await supabaseAdmin
    .from("confectioners")
    .select("id, userId")
    .eq("userId", user.userId)
    .maybeSingle();

  if (error) {
    console.error("[ai-dialogue-access] confectioner lookup failed:", error.message);
    throw new HttpError(500, "Не удалось проверить доступ");
  }

  const owns = Boolean(
    conf && (confectionerId === conf.id || confectionerId === conf.userId)
  );
  if (!owns) {
    throw new HttpError(403, "Нет доступа к AI-контексту этой пары пользователей");
  }
}
