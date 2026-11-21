import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createPayment, isYookassaConfigured, isLocalE2EPaymentStubEnabled } from "@/lib/yookassa";
import { checkAcceptance, loadProductItemsData } from "@/lib/ops/acceptance";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const { id: quoteId } = await params;

  if (!isYookassaConfigured() && process.env.NODE_ENV === "production" && !isLocalE2EPaymentStubEnabled()) {
    return NextResponse.json({ error: "Платёжный шлюз не настроен", code: "PAYMENT_GATEWAY_UNAVAILABLE" }, { status: 503 });
  }

  // До фиксации заказа проверяем реальный рецепт, склад, мощность и срок.
  const { data: quote, error: quoteError } = await supabaseAdmin
    .from("confectioner_quotes")
    .select("id, production_product_id, confectioner_id, quote_request_id")
    .eq("id", quoteId)
    .maybeSingle();
  if (quoteError || !quote) return NextResponse.json({ error: "Предложение не найдено" }, { status: 404 });
  const { data: quoteRequest, error: requestError } = await supabaseAdmin
    .from("quote_requests")
    .select("customer_id, quantity, delivery_date, delivery_type, status, expires_at")
    .eq("id", quote.quote_request_id)
    .maybeSingle();
  if (requestError || !quoteRequest) return NextResponse.json({ error: "Запрос не найден" }, { status: 404 });
  if (quoteRequest.customer_id !== user.id) return NextResponse.json({ error: "Нет доступа к запросу" }, { status: 403 });
  if (!quote.production_product_id) {
    return NextResponse.json({ error: "Кондитер не выбрал производственный рецепт", code: "PRODUCTION_RECIPE_NOT_SELECTED" }, { status: 422 });
  }
  if (new Date(quoteRequest.expires_at).getTime() <= Date.now() ||
      ["approved", "cancelled", "expired"].includes(quoteRequest.status)) {
    return NextResponse.json({ error: "Запрос уже закрыт или истёк", code: "QUOTE_REQUEST_CLOSED" }, { status: 409 });
  }
  try {
    const productItems = await loadProductItemsData([{
      productId: quote.production_product_id,
      quantity: Math.max(1, Number(quoteRequest.quantity || 1)),
    }]);
    const acceptance = await checkAcceptance({
      items: productItems,
      assignedConfectionerId: quote.confectioner_id,
      deliveryDate: quoteRequest.delivery_date ?? null,
      deliveryTimeWindow: null,
      deliveryTime: null,
    });
    if (!acceptance.canAccept) {
      return NextResponse.json({
        error: "Производство не может подтвердить этот срок или наличие ингредиентов",
        code: "PRODUCTION_UNAVAILABLE",
        reasons: acceptance.reasons,
        suggestions: acceptance.suggestions,
        alternativeWindows: acceptance.alternativeWindows,
      }, { status: 422 });
    }
  } catch (error) {
    console.error("[quote-accept] acceptance check failed:", (error as Error).message);
    return NextResponse.json({
      error: "Не удалось проверить рецепт, склад и производственную мощность",
      code: "ACCEPTANCE_UNAVAILABLE",
    }, { status: 503 });
  }

  const { data: accepted, error: acceptError } = await supabaseAdmin.rpc(
    "accept_quote_and_create_order",
    { p_quote_id: quoteId, p_customer_id: user.id }
  );
  if (acceptError) {
    const message = acceptError.message || "";
    const status =
      /QUOTE_NOT_FOUND|QUOTE_REQUEST_NOT_FOUND/.test(message) ? 404 :
      /QUOTE_CUSTOMER_MISMATCH/.test(message) ? 403 :
      /PRODUCTION_RECIPE_NOT_SELECTED|PRODUCTION_RECIPE_UNAVAILABLE|PRODUCTION_RECIPE_EMPTY|QUOTE_AMOUNT_INVALID/.test(message) ? 422 :
      /QUOTE_REQUEST_EXPIRED|QUOTE_NOT_PENDING/.test(message) ? 409 : 503;
    return NextResponse.json({
      error: "Не удалось принять предложение",
      code: message.match(/QUOTE_[A-Z_]+|PRODUCTION_[A-Z_]+/)?.[0] || "QUOTE_ACCEPTANCE_FAILED",
      message: status === 422
        ? "Кондитер должен привязать к предложению опубликованный товар с действующим рецептом и ингредиентами."
        : status === 409
          ? "Предложение уже обработано или срок запроса истёк."
          : "Не удалось создать заказ. Повторите попытку позже.",
    }, { status });
  }

  const row = Array.isArray(accepted) ? accepted[0] : accepted;
  if (!row?.order_id || !row?.order_number || !(Number(row.amount_rub) > 0)) {
    return NextResponse.json({ error: "Некорректный ответ создания заказа" }, { status: 503 });
  }

  // Повторное нажатие после сетевого сбоя возвращает ранее созданную payment URL.
  const { data: existingPayment, error: paymentLookupError } = await supabaseAdmin
    .from("payments")
    .select("yookassa_payment_id, amount, status, metadata")
    .eq("order_id", row.order_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paymentLookupError) {
    return NextResponse.json({ error: "Не удалось проверить платёж", code: "PAYMENT_LOOKUP_FAILED" }, { status: 503 });
  }
  const existingUrl = (existingPayment?.metadata as { confirmation_url?: string } | null)?.confirmation_url;
  if (existingPayment && existingUrl && Number(existingPayment.amount) === Number(row.amount_rub)) {
    return NextResponse.json({
      orderId: row.order_id, orderNumber: row.order_number,
      total: Number(row.amount_rub), paymentUrl: existingUrl,
      isStub: !isYookassaConfigured(),
    });
  }

  const paymentResult = await createPayment({
    amount: Number(row.amount_rub),
    description: `Индивидуальный заказ ${row.order_number} — «Уездный кондитер»`,
    returnUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/checkout/success?orderId=${row.order_id}`,
    orderId: row.order_id,
  });
  const paymentUrl = paymentResult.payment?.confirmation?.confirmation_url;
  const paymentId = paymentResult.payment?.id;
  if (!paymentResult.success || !paymentUrl || !paymentId) {
    console.error("[quote-accept] payment creation failed:", paymentResult.error);
    return NextResponse.json({
      error: "Заказ создан, но платёж не удалось подготовить. Повторите оплату из личного кабинета.",
      code: "PAYMENT_CREATE_FAILED",
      orderId: row.order_id,
    }, { status: 502 });
  }

  const { error: ledgerError } = await supabaseAdmin.from("payments").insert({
    order_id: row.order_id,
    yookassa_payment_id: paymentId,
    amount: Number(row.amount_rub),
    currency: "RUB",
    status: "pending",
    method: "yookassa",
    metadata: { confirmation_url: paymentUrl, source: "accepted_quote", quote_id: quoteId },
  });
  if (ledgerError) {
    console.error("[quote-accept] payment ledger insert failed:", ledgerError.message);
    return NextResponse.json({
      error: "Не удалось зафиксировать платёж. Повторите попытку.",
      code: "PAYMENT_LEDGER_FAILED",
      orderId: row.order_id,
    }, { status: 503 });
  }

  return NextResponse.json({
    orderId: row.order_id,
    orderNumber: row.order_number,
    total: Number(row.amount_rub),
    paymentUrl,
    isStub: !isYookassaConfigured(),
  }, { status: 201 });
}
