import { supabaseAdmin } from "@/lib/supabase/admin";

export interface QuoteMediaAccess {
  quote: { id: string; customer_id: string | null; confectioner_ids: string[]; status: string } | null;
  isOwner: boolean;
  isRecipient: boolean;
  isAdmin: boolean;
}

/**
 * До выбора предложения вложения видны приглашённым кондитерам.
 * После принятия — только покупателю, администратору и кондитеру,
 * чьё предложение принято. Остальные приглашённые теряют доступ.
 */
export async function resolveQuoteMediaAccess(
  quoteId: string,
  userId: string,
  roles: string[] = [],
): Promise<QuoteMediaAccess> {
  const { data: quote, error } = await supabaseAdmin
    .from("quote_requests")
    .select("id, customer_id, confectioner_ids, status")
    .eq("id", quoteId)
    .maybeSingle();
  if (error) throw error;
  if (!quote) return { quote: null, isOwner: false, isRecipient: false, isAdmin: false };

  const isOwner = quote.customer_id === userId;
  const isAdmin = roles.includes("ADMIN") || roles.includes("SUPER_ADMIN");
  if (isOwner || isAdmin) return { quote, isOwner, isRecipient: false, isAdmin };

  const { data: confectioner, error: confectionerError } = await supabaseAdmin
    .from("confectioners")
    .select("id")
    .eq("userId", userId)
    .maybeSingle();
  if (confectionerError) throw confectionerError;
  const invited = Boolean(confectioner && (quote.confectioner_ids ?? []).includes(confectioner.id));
  if (!invited || !confectioner) return { quote, isOwner, isRecipient: false, isAdmin };

  if (quote.status === "approved") {
    const { data: accepted, error: acceptedError } = await supabaseAdmin
      .from("confectioner_quotes")
      .select("confectioner_id")
      .eq("quote_request_id", quoteId)
      .eq("status", "accepted")
      .maybeSingle();
    if (acceptedError) throw acceptedError;
    return {
      quote,
      isOwner,
      isRecipient: accepted?.confectioner_id === confectioner.id,
      isAdmin,
    };
  }

  return { quote, isOwner, isRecipient: true, isAdmin };
}
