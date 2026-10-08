"use client";

/**
 * /checkout/success — статус заказа после оформления/оплаты.
 *
 * Сюда ведут:
 *   • return_url YooKassa:  /checkout/success?orderId=<uuid>   (POST /api/checkout)
 *   • stub payment URL:     /checkout/success?orderId=<uuid>&demo=true (dev без YooKassa)
 *
 * Показывает: номер заказа, состав с параметрами (кастомизация товаров и
 * снимок конфига конструктора), дату/способ получения, СЕРВЕРНЫЕ суммы,
 * человеческие статусы оплаты/заказа. Если оплата ещё pending — кнопка
 * «Оплатить» → POST /api/payment/create {orderId} → redirect на paymentUrl.
 *
 * Данные: GET /api/orders/[id] (auth Bearer/cookie; только свой заказ —
 * ownership-проверка на сервере).
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, CreditCard, Loader2, PackageCheck, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/finance";
import { builderConfigParams, type CakeBuilderConfig } from "@/lib/cake-builder-pricing";
import { csrfFetch, getSessionAuthHeaders } from "@/lib/api-client";

interface SuccessOrderItem {
  product_title: string;
  quantity: number;
  unit_price: number;
  total: number;
  selected_attributes: Record<string, unknown> | null;
}

interface SuccessOrder {
  id: string;
  number: string;
  status: string;
  payment_status: string;
  subtotal: number | null;
  delivery_cost: number | null;
  discount: number | null;
  total: number;
  promo_code: string | null;
  delivery_date: string | null;
  delivery_type: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  notes: string | null;
  items?: SuccessOrderItem[];
  payment?: Array<{ status: string; amount: number }> | null;
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "Заказ принят — ждём подтверждения кондитера",
  CONFIRMED: "Заказ подтверждён кондитером",
  PREPARING: "Готовится",
  READY: "Готов к выдаче",
  IN_DELIVERY: "В доставке",
  DELIVERED: "Доставлен",
  COMPLETED: "Выполнен",
  CANCELLED: "Отменён",
  REFUNDED: "Возврат оформлен",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает оплаты",
  waiting_for_capture: "Платёж обрабатывается",
  succeeded: "Оплачено",
  escrow: "Оплачено (деньги на защищённом счёте)",
  released: "Оплачено",
  cancelled: "Платёж отменён",
  refunded: "Возвращено",
};

/** custom-позиция: order_items.selected_attributes = снимок конфига конструктора. */
function isBuilderConfigSnapshot(attrs: Record<string, unknown>): boolean {
  return typeof attrs.productType === "string";
}

function itemParams(item: SuccessOrderItem): Array<{ label: string; value: string }> {
  const attrs = item.selected_attributes;
  if (!attrs || typeof attrs !== "object") return [];
  if (isBuilderConfigSnapshot(attrs)) {
    return builderConfigParams(attrs as unknown as CakeBuilderConfig);
  }
  const out: Array<{ label: string; value: string }> = [];
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (s(attrs.filling)) out.push({ label: "Начинка", value: s(attrs.filling) });
  if (s(attrs.coating)) out.push({ label: "Покрытие", value: s(attrs.coating) });
  if (s(attrs.decoration)) out.push({ label: "Декор", value: s(attrs.decoration) });
  if (s(attrs.inscription)) out.push({ label: "Надпись", value: s(attrs.inscription) });
  return out;
}

function CheckoutSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId") || "";
  const isDemo = searchParams.get("demo") === "true";

  const [order, setOrder] = useState<SuccessOrder | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  const loadOrder = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!orderId) {
        setLoadError("Не указан номер заказа в адресе страницы");
        setLoading(false);
        return;
      }
      // P1.1: polling-обновления — тихие (без спиннера каждые 4 с)
      if (!opts?.silent) setLoading(true);
      try {
        const headers = await getSessionAuthHeaders();
        const res = await csrfFetch(`/api/orders/${encodeURIComponent(orderId)}`, { headers });
        if (res.status === 401) {
          setLoadError("Войдите в аккаунт, чтобы увидеть заказ");
          return;
        }
        if (!res.ok) {
          setLoadError("Заказ не найден");
          return;
        }
        const data = (await res.json()) as { order?: SuccessOrder };
        if (data.order) {
          setOrder(data.order);
          setLoadError(null);
        } else if (!opts?.silent) {
          setLoadError("Заказ не найден");
        }
      } catch {
        if (!opts?.silent) setLoadError("Не удалось загрузить заказ");
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [orderId]
  );

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  // P1.1 §9: лёгкий ограниченный polling пока платёж pending. Возврат с
  // платёжного шлюза часто опережает webhook — раньше страница навсегда
  // показывала «Ожидает оплаты» до ручного refresh. Ограничение: 15 попыток
  // × 4 с (~1 мин), потом останавливается (не бесконечный). Refresh страницы
  // перезапускает цикл — результат не ломается.
  const paymentPendingRaw = order ? order.payment_status === "pending" : false;
  useEffect(() => {
    if (!paymentPendingRaw) return;
    let attempts = 0;
    let cancelled = false;
    const timer = setInterval(() => {
      attempts += 1;
      if (attempts > 15) {
        clearInterval(timer);
        return;
      }
      void loadOrder({ silent: true }).then(() => {
        if (cancelled) return;
        // loadOrder обновит order → payment_status изменится → эффект
        // перезапустится/остановится сам
      });
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // NB: намеренно НЕ зависим от loadOrder-identity — цикл держится, пока
    // платёж pending (loadOrder стабилен: useCallback([orderId]))
  }, [paymentPendingRaw]);

  const paymentPending = paymentPendingRaw;

  async function handlePay() {
    if (!orderId || paying) return;
    setPaying(true);
    try {
      const headers = await getSessionAuthHeaders();
      const res = await csrfFetch("/api/payment/create", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { paymentUrl?: string; error?: string }
        | null;
      if (res.ok && data?.paymentUrl) {
        window.location.href = data.paymentUrl;
        return;
      }
      alert(data?.error || "Не удалось создать платёж");
    } catch {
      alert("Ошибка сети — попробуйте ещё раз");
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground mt-3">Загружаем заказ…</p>
      </div>
    );
  }

  if (loadError || !order) {
    return (
      <div className="container mx-auto px-4 py-20 text-center max-w-md">
        <XCircle className="h-12 w-12 mx-auto text-muted-foreground" />
        <h1 className="font-display text-xl font-bold mt-4 mb-2">Заказ не найден</h1>
        <p className="text-sm text-muted-foreground mb-6">{loadError}</p>
        <Button onClick={() => router.push("/dashboard")}>В личный кабинет</Button>
      </div>
    );
  }

  const paid = ["succeeded", "escrow", "released"].includes(order.payment_status);
  const subtotal = order.subtotal ?? order.total;
  const deliveryCost = order.delivery_cost ?? 0;
  const discount = order.discount ?? 0;

  return (
    <div className="container mx-auto px-4 py-8 lg:py-12 max-w-2xl">
      <Card className="p-6 lg:p-8 space-y-5">
        <div className="flex items-start gap-3">
          {paid ? (
            <CheckCircle2 className="h-10 w-10 shrink-0 text-emerald-600" aria-hidden="true" />
          ) : order.payment_status === "cancelled" ? (
            <XCircle className="h-10 w-10 shrink-0 text-red-500" aria-hidden="true" />
          ) : (
            <Clock className="h-10 w-10 shrink-0 text-amber-500" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <h1 className="font-display text-xl lg:text-2xl font-bold">
              {paid ? "Заказ оплачен!" : ORDER_STATUS_LABELS[order.status] || "Заказ принят"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Номер заказа: <span className="font-semibold text-foreground">{order.number}</span>
              {" "}· Оплата: <span className="font-medium text-foreground">
                {PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status}
              </span>
            </p>
            {isDemo && !paid && (
              <p className="text-xs text-muted-foreground mt-2">
                Демо-режим: платёжный шлюз не настроен. Оплатить можно позже из этого окна или
                личного кабинета.
              </p>
            )}
          </div>
        </div>

        <Separator />

        {/* Состав заказа — с сервера (order_items, снапшот цен) */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Состав заказа</h2>
          {(order.items || []).map((item, idx) => {
            const params = itemParams(item);
            return (
              <div key={`${item.product_title}-${idx}`} className="flex gap-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{item.product_title}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.quantity} × {formatCurrency(item.unit_price)}
                    {params.length > 0 && (
                      <span className="ml-1">
                        · {params.map((p) => `${p.label}: ${p.value}`).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="font-medium shrink-0 tnum">{formatCurrency(item.total)}</div>
              </div>
            );
          })}
          {(!order.items || order.items.length === 0) && (
            <p className="text-sm text-muted-foreground">Позиции заказа недоступны</p>
          )}
        </div>

        {/* Получение */}
        <div className="text-sm space-y-1">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Получение</span>
            <span className="font-medium text-right">
              {order.delivery_type === "pickup" || order.delivery_type === "self_pickup"
                ? "Самовывоз"
                : "Доставка"}
              {order.delivery_date ? `, ${order.delivery_date}` : ""}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Адрес</span>
            <span className="font-medium text-right">
              {order.delivery_city || "—"}
              {order.delivery_address ? `, ${order.delivery_address}` : ""}
            </span>
          </div>
          {order.notes && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Комментарий</span>
              <span className="font-medium text-right">{order.notes}</span>
            </div>
          )}
        </div>

        <Separator />

        {/* Серверные суммы */}
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Товары</span>
            <span className="tnum">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Доставка</span>
            <span>{deliveryCost === 0 ? "Бесплатно" : formatCurrency(deliveryCost)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-emerald-600">
              <span>Скидка{order.promo_code ? ` (${order.promo_code})` : ""}</span>
              <span className="tnum">−{formatCurrency(discount)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-base pt-2 border-t">
            <span>Итого</span>
            <span className="tnum">{formatCurrency(order.total)}</span>
          </div>
        </div>

        {/* Действия */}
        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          {paymentPending && (
            <Button onClick={handlePay} disabled={paying} className="flex-1">
              {paying ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4 mr-1" />
              )}
              {paying ? "Создаём платёж…" : "Оплатить"}
            </Button>
          )}
          <Button variant="outline" onClick={() => router.push("/dashboard")} className="flex-1">
            <PackageCheck className="h-4 w-4 mr-1" />
            Перейти к заказам
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto px-4 py-20 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
        </div>
      }
    >
      <CheckoutSuccessContent />
    </Suspense>
  );
}
