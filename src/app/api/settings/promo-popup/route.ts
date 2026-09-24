/**
 * GET /api/settings/promo-popup — публичный: включён ли промо-попап?
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    let enabled = false;
    let promotionId: string | null = null;

    try {
      const { data: setting } = await supabaseAdmin
        .from("site_settings")
        .select("value")
        .eq("key", "promo_popup_enabled")
        .maybeSingle();
      enabled = setting?.value === "true";

      const { data: promoSetting } = await supabaseAdmin
        .from("site_settings")
        .select("value")
        .eq("key", "promo_popup_promotion_id")
        .maybeSingle();
      promotionId = promoSetting?.value || null;
    } catch {
      // БД недоступна — попап выключен
    }

    return NextResponse.json({ enabled, promotionId });
  } catch (error: any) {
    return NextResponse.json({ enabled: false }, { status: 500 });
  }
}
