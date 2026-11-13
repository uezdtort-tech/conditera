/**
 * /api/negotiations/[id] — управление переговорами.
 *
 * GET — детали переговоров (с сообщениями + revisions)
 * PATCH — обновить (quote price, accept, decline)
 *
 * Z-v32 Этап 8 (PR-5): срок действия предложения (valid_until, 0085).
 *   • quote — кондитер (пере)считал и отправил предложение: сервер ставит
 *     valid_until = now + 14 дней (custom validDays клампится 1..60) —
 *     это «recalculate & resend» через существующий механизм revisions;
 *   • accept — ТОЛЬКО пока срок не истёк, иначе 410 OFFER_EXPIRED
 *     (+ лениво status='expired'); авто-чести старой цены нет;
 *   • accept пишет revision-снимок принятого предложения (change_reason
 *     'accepted') — якорь для metadata.offerBinding при оформлении заказа.
 *
 * Единицы: quoted_price — КОПЕЙКИ (клиент шлёт Math.round(rub*100),
 * системное сообщение ниже делит на 100 для показа в рублях — НЕ баг).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";
import {
  offerValidUntilFrom,
} from "@/lib/negotiation-binding";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
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
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const { action, quotedPrice, quotedDeliveryCost, quotedPrepTime, comment, validDays } = body as {
      action: "quote" | "accept" | "decline" | "counter";
      quotedPrice?: number;
      quotedDeliveryCost?: number;
      quotedPrepTime?: string;
      comment?: string;
      validDays?: number; // Z-v32: custom срок действия предложения, кламп 1..60 (дефолт 14)
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
        // Z-v32: принятое предложение нельзя тихо переписать (binding
        // ссылается на него при оформлении заказа) — сначала decline.
        if (negotiation.status === "accepted") {
          return NextResponse.json(
            { error: "Переговоры уже приняты — предложение зафиксировано" },
            { status: 409 }
          );
        }

        // Сохранить snapshot в revisions (prior-value pattern 0004):
        // первое предложение — 'initial', пересчёт/повторная отправка — 'price_adjustment'
        await supabaseAdmin.from("negotiation_revisions").insert({
          negotiation_id: id,
          quoted_price: negotiation.quoted_price,
          quoted_delivery_cost: negotiation.quoted_delivery_cost,
          quoted_prep_time: negotiation.quoted_prep_time,
          quoted_items: negotiation.quoted_items,
          discount_percent: negotiation.discount_percent,
          discount_comment: negotiation.discount_comment,
          changed_by: user.id,
          change_reason: negotiation.quoted_price == null ? "initial" : "price_adjustment",
        });

        // Z-v32: срок действия НОВОГО предложения — сервер ставит сам
        // (клиентская дата доверия нет): дефолт 14 дней, custom кламп 1..60.
        const validUntil = offerValidUntilFrom(new Date(), validDays);

        // Обновить negotiation
        const { data: updated, error: updErr } = await supabaseAdmin
          .from("negotiations")
          .update({
            quoted_price: quotedPrice,
            quoted_delivery_cost: quotedDeliveryCost || 0,
            quoted_prep_time: quotedPrepTime || null,
            status: "quoted",
            quoted_at: new Date().toISOString(),
            valid_until: validUntil.toISOString(),
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

        // ZV33-4b D2a: повторное принятие — 409 БЕЗ side effects. Раньше
        // дубль писал второй revision 'accepted', перетирал accepted_at,
        // повторно бампал inquiry.closed_at и свипом отклонял сиблингов.
        if (negotiation.status === "accepted") {
          return NextResponse.json(
            {
              error: "OFFER_ALREADY_ACCEPTED",
              message: "Предложение уже принято",
            },
            { status: 409 }
          );
        }

        // Z-v32 (0085): истёкшее предложение НЕ принимается — честный 410,
        // клиент показывает «Предложение истекло — запросите новое».
        // Кондитер делает recalculate & resend (PATCH quote) → новый valid_until.
        const nowDate = new Date();
        const validUntilDate = negotiation.valid_until ? new Date(negotiation.valid_until) : null;
        if (negotiation.status === "expired" || (validUntilDate && validUntilDate.getTime() < nowDate.getTime())) {
          // Ленивый гард: помечаем expired (cron не нужен — проверка в accept-time)
          await supabaseAdmin
            .from("negotiations")
            .update({ status: "expired" })
            .eq("id", id);
          return NextResponse.json(
            {
              error: "OFFER_EXPIRED",
              message: "Предложение истекло — запросите новое",
              ...(validUntilDate ? { expiredAt: validUntilDate.toISOString() } : {}),
            },
            { status: 410 }
          );
        }
        // Принятие без предложения запрещено (нет цены — нечего фиксировать).
        if (negotiation.quoted_price == null) {
          return NextResponse.json(
            { error: "OFFER_NO_PRICE", message: "Кондитер ещё не отправил предложение" },
            { status: 409 }
          );
        }

        // Z-v32: snapshot ПРИНЯТОГО предложения (якорь metadata.offerBinding
        // при оформлении заказа в /api/checkout). Триггер 0085 — бэкстоп.
        await supabaseAdmin.from("negotiation_revisions").insert({
          negotiation_id: id,
          quoted_price: negotiation.quoted_price,
          quoted_delivery_cost: negotiation.quoted_delivery_cost,
          quoted_prep_time: negotiation.quoted_prep_time,
          quoted_items: negotiation.quoted_items,
          discount_percent: negotiation.discount_percent,
          discount_comment: negotiation.discount_comment,
          changed_by: user.id,
          change_reason: "accepted",
        });

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

        // Отклонить остальные negotiations этого inquiry — ТОЛЬКО ещё активные
        // (ZV33-4b D2b: терминальные статусы не трогаем — 'expired' сиблинг
        // оставался честной историей, а не переписывался в 'declined').
        await supabaseAdmin
          .from("negotiations")
          .update({ status: "declined", declined_at: new Date().toISOString() })
          .neq("id", id)
          .eq("inquiry_id", negotiation.inquiry_id)
          .in("status", ["pending_confectioner", "quoted", "counter_offered"]);

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
