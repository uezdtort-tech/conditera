/**
 * /api/negotiations/[id] — управление переговорами.
 *
 * GET — детали переговоров (с сообщениями + revisions)
 * PATCH — обновить (quote price, accept, decline)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    const { data: negotiation, error } = await supabaseAdmin
      .from("negotiations")
      .select(`
        *,
        inquiry:inquiries(*),
        messages:negotiation_messages(*),
        revisions:negotiation_revisions(*)
      `)
      .eq("id", id)
      .single();

    if (error || !negotiation) {
      return NextResponse.json({ error: "Переговоры не найдены" }, { status: 404 });
    }

    // Проверка доступа
    const isOwner = negotiation.user_id === user.id;
    const isConfectioner = negotiation.confectioner_id === user.id;
    const isAdmin = user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN", "SUPPORT"].includes(r)
    );

    if (!isOwner && !isConfectioner && !isAdmin) {
      return forbiddenResponse("Нет доступа к этим переговорам");
    }

    return NextResponse.json({ negotiation });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const { action, quotedPrice, quotedDeliveryCost, quotedPrepTime, comment } = body as {
      action: "quote" | "accept" | "decline" | "counter";
      quotedPrice?: number;
      quotedDeliveryCost?: number;
      quotedPrepTime?: string;
      comment?: string;
    };

    // Загрузить negotiation
    const { data: negotiation, error: nErr } = await supabaseAdmin
      .from("negotiations")
      .select("*")
      .eq("id", id)
      .single();

    if (nErr || !negotiation) {
      return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    }

    // Проверка прав
    const isOwner = negotiation.user_id === user.id;
    const isConfectioner = negotiation.confectioner_id === user.id;
    const isAdmin = user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN"].includes(r)
    );

    switch (action) {
      case "quote": {
        // Кондитер предлагает цену
        if (!isConfectioner && !isAdmin) {
          return forbiddenResponse("Только кондитер может предлагать цену");
        }
        if (!quotedPrice) {
          return NextResponse.json({ error: "quotedPrice обязателен" }, { status: 400 });
        }

        // Сохранить snapshot в revisions
        await supabaseAdmin.from("negotiation_revisions").insert({
          negotiation_id: id,
          quoted_price: negotiation.quoted_price,
          quoted_delivery_cost: negotiation.quoted_delivery_cost,
          quoted_prep_time: negotiation.quoted_prep_time,
          quoted_items: negotiation.quoted_items,
          discount_percent: negotiation.discount_percent,
          discount_comment: negotiation.discount_comment,
          changed_by: user.id,
          change_reason: "initial",
        });

        // Обновить negotiation
        const { data: updated, error: updErr } = await supabaseAdmin
          .from("negotiations")
          .update({
            quoted_price: quotedPrice,
            quoted_delivery_cost: quotedDeliveryCost || 0,
            quoted_prep_time: quotedPrepTime || null,
            status: "quoted",
            quoted_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select()
          .single();

        if (updErr) {
          return NextResponse.json({ error: updErr.message }, { status: 500 });
        }

        // Системное сообщение
        await supabaseAdmin.from("negotiation_messages").insert({
          negotiation_id: id,
          sender_id: user.id,
          text: `Предложение: ${quotedPrice / 100}₽${quotedPrepTime ? `, срок: ${quotedPrepTime}` : ""}`,
          is_system: true,
        });

        return NextResponse.json({ negotiation: updated });
      }

      case "accept": {
        // Пользователь принимает
        if (!isOwner && !isAdmin) {
          return forbiddenResponse("Только владелец может принимать");
        }
        const { data: updated, error } = await supabaseAdmin
          .from("negotiations")
          .update({
            status: "accepted",
            accepted_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select()
          .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        // Закрыть inquiry
        await supabaseAdmin
          .from("inquiries")
          .update({ status: "converted", closed_at: new Date().toISOString() })
          .eq("id", negotiation.inquiry_id);

        // Отклонить остальные negotiations этого inquiry
        await supabaseAdmin
          .from("negotiations")
          .update({ status: "declined", declined_at: new Date().toISOString() })
          .neq("id", id)
          .eq("inquiry_id", negotiation.inquiry_id);

        return NextResponse.json({ negotiation: updated });
      }

      case "decline": {
        // Любой из участников может отклонить
        if (!isOwner && !isConfectioner && !isAdmin) {
          return forbiddenResponse("Нет прав");
        }
        const { data: updated, error } = await supabaseAdmin
          .from("negotiations")
          .update({
            status: "declined",
            declined_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select()
          .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ negotiation: updated });
      }

      case "counter": {
        // Контр-предложение (пользователь меняет параметры запроса)
        if (!isOwner && !isAdmin) {
          return forbiddenResponse("Только владелец");
        }
        const { data: updated, error } = await supabaseAdmin
          .from("negotiations")
          .update({
            status: "counter_offered",
            discount_comment: comment || negotiation.discount_comment,
          })
          .eq("id", id)
          .select()
          .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ negotiation: updated });
      }

      default:
        return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
