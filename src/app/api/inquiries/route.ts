/**
 * /api/inquiries — CRUD для запросов на индивидуальные торты.
 *
 * GET — список запросов текущего пользователя (CUSTOMER) или доступных для кондитера
 * POST — создать новый запрос (из cake_builder_draft)
 * PATCH — обновить (закрыть, продлить)
 * DELETE — удалить
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const { searchParams } = request.nextUrl;
    const filter = searchParams.get("filter") || "own"; // 'own' | 'available'
    const city = searchParams.get("city");

    let query = supabaseAdmin.from("inquiries").select(`
      *,
      negotiations:negotiations(*)
    `);

    if (filter === "available") {
      // Открытые запросы для кондитера
      if (!user.roles.includes("CONFECTIONER") && !user.roles.includes("ADMIN")) {
        return forbiddenResponse("Только кондитеры могут просматривать доступные запросы");
      }
      query = query.eq("status", "open");
      if (city) query = query.eq("city", city);
    } else {
      // Свои запросы
      query = query.eq("user_id", user.id);
    }

    const { data, error } = await query.order("submitted_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Этап 10 §D1: имя покупателя (profiles.name) для карточки заявки —
    // только имя, без контактов (email/телефон не отдаём). Safe enrich
    // вторым запросом (embed в локальном PostgREST-шим ненадёжен).
    const rows = (data || []) as Array<Record<string, unknown>>;
    const inquirerIds = Array.from(
      new Set(rows.map((r) => r.user_id).filter((v): v is string => typeof v === "string"))
    );
    const namesById = new Map<string, string>();
    if (inquirerIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, name")
        .in("id", inquirerIds);
      for (const p of profiles || []) {
        namesById.set((p as { id: string }).id, ((p as { name?: string }).name || ""));
      }
    }

    return NextResponse.json({
      inquiries: rows.map((r) => ({ ...r, customer_name: namesById.get(r.user_id as string) || "" })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const {
      draftId,
      confectionerIds,
      estimatedPrice,
      requestDiscount = false,
      discountPercent = 0,
      discountComment = "",
    } = body as {
      draftId: string;
      confectionerIds: string[];
      estimatedPrice: number;
      requestDiscount?: boolean;
      discountPercent?: number;
      discountComment?: string;
    };

    if (!draftId || !confectionerIds || confectionerIds.length === 0) {
      return NextResponse.json(
        { error: "Draft ID и confectionerIds обязательны" },
        { status: 400 }
      );
    }

    // 1. Загрузить черновик
    const { data: draft, error: draftError } = await supabaseAdmin
      .from("cake_builder_drafts")
      .select("*")
      .eq("id", draftId)
      .single();

    if (draftError || !draft) {
      return NextResponse.json({ error: "Черновик не найден" }, { status: 404 });
    }

    if (draft.user_id !== user.id) {
      return forbiddenResponse("Чужой черновик");
    }

    // 2. Создать inquiry
    const { data: inquiry, error: inquiryError } = await supabaseAdmin
      .from("inquiries")
      .insert({
        user_id: user.id,
        event_type: draft.event_type,
        base: draft.base,
        filling: draft.filling,
        coating: draft.coating,
        decorations: draft.decorations,
        dietary: draft.dietary,
        servings: draft.servings,
        city: draft.city,
        delivery_date: draft.delivery_date,
        delivery_type: draft.delivery_type,
        inscription: draft.inscription,
        comment: draft.comment,
        estimated_price: estimatedPrice,
        status: "open",
        expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (inquiryError || !inquiry) {
      return NextResponse.json(
        { error: "Ошибка создания inquiry", detail: inquiryError?.message },
        { status: 500 }
      );
    }

    // 3. Создать negotiations для выбранных кондитеров
    const negotiationsToInsert = confectionerIds.map((confectionerId: string) => ({
      inquiry_id: inquiry.id,
      user_id: user.id,
      confectioner_id: confectionerId,
      discount_requested: requestDiscount,
      discount_percent: requestDiscount ? discountPercent : 0,
      discount_comment: requestDiscount ? discountComment : "",
      status: "pending_confectioner",
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    }));

    const { data: negotiations, error: negError } = await supabaseAdmin
      .from("negotiations")
      .insert(negotiationsToInsert)
      .select();

    if (negError) {
      // Откатываем inquiry
      await supabaseAdmin.from("inquiries").delete().eq("id", inquiry.id);
      return NextResponse.json(
        { error: "Ошибка создания negotiations", detail: negError.message },
        { status: 500 }
      );
    }

    // 4. Помечаем draft как submitted
    await supabaseAdmin
      .from("cake_builder_drafts")
      .update({ is_submitted: true })
      .eq("id", draftId);

    // 5. Отправить уведомление кондитерам (через Edge Function)
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (supabaseUrl) {
        await Promise.all(
          confectionerIds.map((confectionerId) =>
            fetch(`${supabaseUrl}/functions/v1/send-notification`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "lead_new",
                leadId: inquiry.id,
                customer: user.email,
                priority: "medium",
              }),
            }).catch(() => null)
          )
        );
      }
    } catch (e) {
      console.warn("[inquiries] Notification error:", (e as Error).message);
    }

    return NextResponse.json({
      inquiryId: inquiry.id,
      negotiationsCount: negotiations.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
