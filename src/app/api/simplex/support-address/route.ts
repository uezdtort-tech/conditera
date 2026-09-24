/**
 * GET /api/simplex/support-address — публичный адрес поддержки маркетплейса.
 *
 * Без авторизации. Возвращает SimpleX-адрес поддержки (если создан админом)
 * и инструкции для подключения через QR-код.
 *
 * Соответствует таблице: simplex_contacts (profileType='support', active=true)
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    let supportContact: Record<string, any> | null = null;
    try {
      const { data } = await supabaseAdmin
        .from("simplex_contacts")
        .select("*")
        .eq("profile_type", "support")
        .eq("active", true)
        .maybeSingle();
      supportContact = data as Record<string, any> | null;
    } catch (e: any) {
      console.warn("[simplex/support-address] DB not available:", e?.message);
    }

    if (!supportContact) {
      return NextResponse.json({
        available: false,
        message: "Приватный канал поддержки ещё не настроен. Используйте обычный чат.",
        instructions: null,
      });
    }

    const address = supportContact.simplex_address || "";
    return NextResponse.json({
      available: true,
      address,
      displayName: supportContact.simplex_name || "Уездный кондитер — поддержка",
      qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(address)}`,
      deepLink: address.startsWith("smp://") ? address : `smp:${address}`,
      instructions: {
        step1: "Установите приложение SimpleX Chat (iOS/Android/desktop) с официального сайта simplex.chat",
        step2: "Откройте приложение, нажмите «Добавить контакт» → «Сканировать QR-код»",
        step3: "Наведите камеру на QR-код выше",
        step4: "Подтверждение подключения произойдёт автоматически",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Internal error", detail: error?.message }, { status: 500 });
  }
}
