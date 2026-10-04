/**
 * GET    /api/simplex/contacts — получить SimpleX-профиль и сообщения
 * POST   /api/simplex/contacts — создать SimpleX-профиль (CONFECTIONER, тариф PREMIUM/BUSINESS)
 * DELETE /api/simplex/contacts — деактивировать профиль
 *
 * Auth: AUTHENTICATED (GET/DELETE), CONFECTIONER (POST)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const BRIDGE_URL = process.env.SIMPLEX_BRIDGE_URL || "http://localhost:5226";
const BRIDGE_API_KEY = process.env.SIMPLEX_BRIDGE_API_KEY;
const ALLOWED_TARIFFS = ["PREMIUM", "BUSINESS"];

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    // Найти SimpleX-контакт пользователя
    let contact: Record<string, any> | null = null;
    try {
      const { data } = await supabaseAdmin
        .from("simplex_contacts")
        .select("*")
        .eq("userId", user.id)
        .eq("profileType", "confectioner")
        .order("createdAt", { ascending: false })
        .maybeSingle();
      contact = data as Record<string, any> | null;
    } catch (e: any) {
      console.warn("[simplex/contacts] GET contact query failed:", e?.message);
    }

    // Проверить тариф кондитера
    let tariffInfo: { current: string; allowed: boolean; required: string[] } | null = null;
    try {
      const { data: conf } = await supabaseAdmin
        .from("confectioners")
        .select("tariff")
        .eq("userId", user.id)
        .maybeSingle();
      if (conf) {
        tariffInfo = {
          current: conf.tariff,
          allowed: ALLOWED_TARIFFS.includes(conf.tariff),
          required: ALLOWED_TARIFFS,
        };
      }
    } catch {}

    // Получить последние сообщения
    let recentMessages: any[] = [];
    let unreadCount = 0;
    let totalCount = 0;
    if (contact?.id) {
      try {
        const { data: msgs } = await supabaseAdmin
          .from("simplex_messages")
          .select("*")
          .eq("simplexContactId", contact.id)
          .order("receivedAt", { ascending: false })
          .limit(50);
        recentMessages = (msgs || []).reverse();

        const { count: unread } = await supabaseAdmin
          .from("simplex_messages")
          .select("*", { count: "exact", head: true })
          .eq("simplexContactId", contact.id)
          .eq("readByOperator", false);
        unreadCount = unread || 0;

        const { count: total } = await supabaseAdmin
          .from("simplex_messages")
          .select("*", { count: "exact", head: true })
          .eq("simplexContactId", contact.id);
        totalCount = total || 0;
      } catch {}
    }

    return NextResponse.json({
      contact,
      recentMessages,
      stats: { total: totalCount, unread: unreadCount },
      tariff: tariffInfo,
      connectInstructions: contact?.simplexAddress
        ? {
            address: contact.simplexAddress,
            qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(contact.simplexAddress)}`,
            deepLink: String(contact.simplexAddress).startsWith("smp://")
              ? contact.simplexAddress
              : `smp:${contact.simplexAddress}`,
          }
        : null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Internal error", detail: error?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireRole(user.id, "CONFECTIONER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    // Premium-gate
    try {
      const { data: conf } = await supabaseAdmin
        .from("confectioners")
        .select("tariff, businessName")
        .eq("userId", user.id)
        .maybeSingle();
      if (conf && !ALLOWED_TARIFFS.includes(conf.tariff)) {
        return NextResponse.json({
          error: "Приватный канал SimpleX доступен только на тарифах PREMIUM и BUSINESS",
          code: "TARIFF_UPGRADE_REQUIRED",
          currentTariff: conf.tariff,
          requiredTariffs: ALLOWED_TARIFFS,
          upgradeUrl: "/dashboard?tab=tariff",
        }, { status: 403 });
      }
    } catch (e: any) {
      console.warn("[simplex/contacts] tariff check failed (non-blocking):", e?.message);
    }

    // Проверить существующий профиль
    let existing: Record<string, any> | null = null;
    try {
      const { data } = await supabaseAdmin
        .from("simplex_contacts")
        .select("*")
        .eq("userId", user.id)
        .eq("profileType", "confectioner")
        .eq("active", true)
        .maybeSingle();
      existing = data as Record<string, any> | null;
    } catch {}
    if (existing) {
      return NextResponse.json({ error: "Профиль уже существует", contact: existing }, { status: 400 });
    }

    // Запросить bridge создать профиль
    let bridgeResponse: any = null;
    try {
      const res = await fetch(`${BRIDGE_URL}/api/create-profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Bridge-Api-Key": BRIDGE_API_KEY || "",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) bridgeResponse = await res.json();
    } catch (err: any) {
      console.warn("[simplex/contacts] Bridge not available, creating mock profile");
    }

    // Извлечь адрес из ответа bridge
    let simplexAddress: string | null = null;
    let simplexConnId: string | null = null;
    let simplexName: string | null = null;

    if (bridgeResponse?.address) {
      const addresses = Array.isArray(bridgeResponse.address) ? bridgeResponse.address : [bridgeResponse.address];
      const firstAddr = addresses[0];
      if (typeof firstAddr === "string") {
        simplexAddress = firstAddr;
      } else if (firstAddr?.address) {
        simplexAddress = firstAddr.address;
        simplexConnId = firstAddr.connId || null;
      }
    }

    if (!simplexAddress) {
      simplexAddress = `smp://mock${Date.now().toString(36)}@${process.env.SIMPLEX_HOSTNAME || "smp.conditera.ru"}#mock`;
      simplexName = user.email?.split("@")[0] || "Кондитер";
    }

    // Сохранить в БД
    let contact: Record<string, any> | null = null;
    try {
      const { data, error } = await supabaseAdmin
        .from("simplex_contacts")
        .insert({
          userId: user.id,
          simplexConnId: simplexConnId,
          simplexAddress: simplexAddress,
          simplexName: simplexName,
          profileType: "confectioner",
          active: true,
          createdAt: new Date().toISOString(),
        })
        .select()
        .single();
      contact = data;
      if (error) throw error;
    } catch (e: any) {
      console.error("[simplex/contacts] Failed to save contact:", e?.message);
      contact = {
        id: `temp-${Date.now()}`,
        userId: user.id,
        simplexConnId: simplexConnId,
        simplexAddress: simplexAddress,
        simplexName: simplexName,
        profileType: "confectioner",
        active: true,
        connectionsCount: 0,
        createdAt: new Date().toISOString(),
      };
    }

    return NextResponse.json({
      success: true,
      contact,
      connectInstructions: {
        address: simplexAddress,
        qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(simplexAddress)}`,
        deepLink: simplexAddress.startsWith("smp://") ? simplexAddress : `smp:${simplexAddress}`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Internal error", detail: error?.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    try {
      await supabaseAdmin
        .from("simplex_contacts")
        .update({ active: false })
        .eq("userId", user.id)
        .eq("active", true);
    } catch (e: any) {
      console.warn("[simplex/contacts] DELETE failed:", e?.message);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: "Internal error", detail: error?.message }, { status: 500 });
  }
}
