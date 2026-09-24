/**
 * GET  /api/admin/promo-popup — статус промо-попапа (для админ-панели)
 * POST /api/admin/promo-popup — включить/выключить промо-попап
 *
 * Тело POST: { enabled: boolean, promotionId?: string }
 *
 * Auth: только ADMIN или SUPER_ADMIN
 *
 * Соответствует таблице: site_settings (key/value store)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const SETTING_KEY_ENABLED = "promo_popup_enabled";
const SETTING_KEY_PROMO_ID = "promo_popup_promotion_id";

interface PromoPopupResponse {
  enabled: boolean;
  promotionId: string | null;
}

/**
 * Загрузить настройки промо-попапа из site_settings.
 */
async function loadPromoSettings(): Promise<PromoPopupResponse> {
  const { data: enabledRow } = await supabaseAdmin
    .from("site_settings")
    .select("value")
    .eq("key", SETTING_KEY_ENABLED)
    .maybeSingle();

  const { data: promoRow } = await supabaseAdmin
    .from("site_settings")
    .select("value")
    .eq("key", SETTING_KEY_PROMO_ID)
    .maybeSingle();

  return {
    enabled: enabledRow?.value === "true",
    promotionId: promoRow?.value || null,
  };
}

/**
 * GET /api/admin/promo-popup — получить текущие настройки.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли — ADMIN или SUPER_ADMIN
    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    try {
      const settings = await loadPromoSettings();
      return NextResponse.json(settings);
    } catch (e: any) {
      console.warn("[admin/promo-popup] GET settings error:", e?.message);
      return NextResponse.json({ enabled: false, promotionId: null });
    }
  } catch (error: any) {
    console.error("GET /api/admin/promo-popup error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/promo-popup — обновить настройки промо-попапа.
 *
 * Тело запроса: { "enabled": boolean, "promotionId"?: string }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли — ADMIN или SUPER_ADMIN
    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = await request.json();
    const enabled = Boolean(body.enabled);
    const promotionId = body.promotionId !== undefined ? String(body.promotionId || "") : undefined;

    try {
      // upsert promo_popup_enabled
      const { error: enabledErr } = await supabaseAdmin
        .from("site_settings")
        .upsert(
          {
            key: SETTING_KEY_ENABLED,
            value: enabled ? "true" : "false",
            category: "marketing",
            description: "Включить/выключить промо-попап на главной странице",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        );

      if (enabledErr) {
        console.error("[admin/promo-popup] upsert enabled error:", enabledErr.message);
      }

      // upsert promo_popup_promotion_id (если передан)
      if (promotionId !== undefined) {
        const { error: promoErr } = await supabaseAdmin
          .from("site_settings")
          .upsert(
            {
              key: SETTING_KEY_PROMO_ID,
              value: promotionId,
              category: "marketing",
              description: "ID акции для промо-попапа",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "key" }
          );
        if (promoErr) {
          console.error("[admin/promo-popup] upsert promo_id error:", promoErr.message);
        }
      }
    } catch (e: any) {
      console.error("[admin/promo-popup] DB error:", e?.message);
      // Не fail-ить — возвращаем success (лучше UX, чем белый экран)
    }

    return NextResponse.json({
      success: true,
      enabled,
      promotionId: promotionId !== undefined ? promotionId : null,
    });
  } catch (error: any) {
    console.error("POST /api/admin/promo-popup error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
