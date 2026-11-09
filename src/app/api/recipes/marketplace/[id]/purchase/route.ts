/**
 * /api/recipes/marketplace/[id]/purchase/route.ts — покупка платного рецепта.
 *
 * RECIPE-03 (RA.10): переписан с доверия клиентскому payment_id (D3) на
 * существующий заказно-платёжный контур:
 *   1. requireAuth; оффер активен; не свой рецепт; rate-limit;
 *   2. НЕ создаёт entitlement здесь — только заказ orders(type='recipe') +
 *      payment (существующая логика /api/payment/create) + confirmation_url;
 *   3. entitlement выдаёт ТОЛЬКО webhook payment.succeeded (CAS-победитель)
 *      после серверной сверки суммы (entitlement.ts);
 *   4. клиентский payment_id/цена/статус из тела — игнорируются полностью.
 *
 * Ответ (контракт e2e recipe-purchase-flow, поля не переименовывались без
 * необходимости): { orderId, paymentUrl, paymentId, isStub? }.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { createPayment, isYookassaConfigured } from "@/lib/yookassa";
import { enforceRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const PAID_ORDER_STATUSES = new Set(["escrow", "succeeded", "released"]);

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    // Rate-limit по IP (существующая дисциплина payment/create)
    const ip = getClientIP(request);
    const blocked = await enforceRateLimit(
      request,
      `recipe-purchase:${ip}`,
      RATE_LIMITS.payment.limit,
      RATE_LIMITS.payment.windowMs
    );
    if (blocked) return blocked as unknown as NextResponse;

    const { id: offerId } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Необходима аутентификация" }, { status: 401 });
    }

    // SEC-11: fail-closed is_blocked
    if ((user as { is_blocked?: boolean }).is_blocked) {
      return NextResponse.json({ error: "Аккаунт заблокирован" }, { status: 403 });
    }

    // Оффер (цена/роялти — ТОЛЬКО сервер, ПР-1)
    const { data: offer, error: offerErr } = await supabaseAdmin
      .from("recipe_marketplace")
      .select("id, recipe_id, author_id, title, slug, base_price, royalty_rate, is_published")
      .eq("id", offerId)
      .maybeSingle();

    if (offerErr || !offer) {
      return NextResponse.json({ error: "Рецепт не найден" }, { status: 404 });
    }
    if (!offer.is_published) {
      return NextResponse.json({ error: "Рецепт не опубликован" }, { status: 409 });
    }
    // RELEASE-02 §7/RELEASE-03 (аудит 5-b/b88714b): включённый оффер ещё не
    // гарантирует публикацию — статус корня recipes обязателен (fail-closed):
    // draft/rejected/archived корень → покупка запрещена.
    const { data: purchaseRoot, error: rootErr } = await supabaseAdmin
      .from("recipes")
      .select("id, status")
      .eq("id", offer.recipe_id)
      .maybeSingle();
    if (rootErr) {
      console.error("[recipes/purchase] root read failed:", rootErr.message);
    }
    if (!purchaseRoot || purchaseRoot.status !== "published") {
      return NextResponse.json({ error: "Рецепт не опубликован" }, { status: 409 });
    }
    // Защита от самопокупки (RB.14)
    if (offer.author_id === user.id) {
      return NextResponse.json(
        { error: "Вы не можете купить собственный рецепт" },
        { status: 422 }
      );
    }
    const price = Number(offer.base_price);
    if (!(price > 0)) {
      return NextResponse.json(
        { error: "Это бесплатный рецепт — доступ открыт без покупки" },
        { status: 422 }
      );
    }

    // Уже есть активный entitlement → повторный POST идемпотентен
    const { data: existing } = await supabaseAdmin
      .from("recipe_purchases")
      .select("id, is_active, payment_id")
      .eq("recipe_id", offer.recipe_id)
      .eq("buyer_id", user.id)
      .maybeSingle();
    if (existing?.is_active) {
      const { data: pay } = await supabaseAdmin
        .from("payments")
        .select("id, status, refund_amount, amount")
        .eq("id", existing.payment_id)
        .maybeSingle();
      const confirmed =
        pay &&
        PAID_ORDER_STATUSES.has(pay.status) &&
        (pay.refund_amount === null || Number(pay.refund_amount) < Number(pay.amount));
      if (confirmed) {
        return NextResponse.json({
          data: existing,
          message: "Рецепт уже куплен ранее",
          idempotent: true,
        });
      }
    }

    // Заказ type='recipe' (Ф-5: orders.type без CHECK — значение добавимо без миграции)
    const priceRub = Math.round(price); // канон money-path: целые рубли (0034)
    const orderNumber = `ORD-RECIPE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert({
        number: orderNumber,
        user_id: user.id,
        confectioner_id: offer.author_id,
        subtotal: priceRub,
        delivery_cost: 0,
        discount: 0,
        total: priceRub,
        status: "PENDING",
        payment_status: "pending",
        type: "recipe",
        delivery_type: "self_pickup",
        metadata: {
          recipe_offer_id: offer.id,
          recipe_id: offer.recipe_id,
          recipe_title: offer.title,
          recipe_slug: offer.slug,
        },
      })
      .select("id, number, total")
      .single();

    if (orderErr || !order) {
      console.error("[recipes/purchase] order insert failed:", orderErr?.message);
      return NextResponse.json({ error: "Не удалось создать заказ" }, { status: 500 });
    }

    if (!isYookassaConfigured()) {
      // dev-stub НЕ выдаёт entitlement (RA.10: «dev-stub не выдаёт entitlement,
      // production guards уже существуют»); вне production — stub-редирект.
      if (process.env.NODE_ENV !== "production") {
        return NextResponse.json({
          orderId: order.id,
          paymentUrl: `/checkout/success?orderId=${order.id}&demo=true`,
          paymentId: `stub_${Date.now()}`,
          isStub: true,
        });
      }
      return NextResponse.json({ error: "Платёжный шлюз не настроен" }, { status: 503 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const paymentResult = await createPayment({
      amount: priceRub,
      description: `Рецепт: ${offer.title} (${order.number})`,
      returnUrl: `${appUrl}/recipes/marketplace/${offer.slug ?? offer.id}`,
      orderId: order.id,
    });

    if (!paymentResult?.success || !paymentResult.payment?.confirmation?.confirmation_url) {
      return NextResponse.json({ error: "Не удалось создать платёж" }, { status: 502 });
    }

    const yookassaPaymentId = paymentResult.payment.id;
    const { error: payInsertErr } = await supabaseAdmin
      .from("payments")
      .upsert(
        {
          order_id: order.id,
          yookassa_payment_id: yookassaPaymentId,
          amount: priceRub,
          currency: "RUB",
          status: "pending",
          method: "yookassa",
          metadata: {
            confirmation_url: paymentResult.payment.confirmation.confirmation_url,
            recipe_offer_id: offer.id,
            recipe_id: offer.recipe_id,
          },
        },
        { onConflict: "yookassa_payment_id", ignoreDuplicates: true }
      );
    if (payInsertErr) {
      console.error("[recipes/purchase] payments upsert failed:", payInsertErr.message);
    }

    return NextResponse.json(
      {
        orderId: order.id,
        paymentUrl: paymentResult.payment.confirmation.confirmation_url,
        paymentId: yookassaPaymentId,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[recipes/purchase] unexpected:", (error as Error)?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
