"use client";

/**
 * buyer-offers-tab.tsx — ZV33-4 §B6–B10: реальная вкладка «Предложения
 * кондитеров» покупателя (заменяет мок CustomerNegotiationTab).
 *
 * Данные — ТОЛЬКО API:
 *   • useBuyerOffers() — GET /api/inquiries (свои) + GET /api/confectioners (имена);
 *   • useNegotiationDetail() — GET /api/negotiations/[id] (история revisions,
 *     лениво при раскрытии);
 *   • useAcceptOffer() — PATCH /api/negotiations/[id] { action:"accept" };
 *     410 OFFER_EXPIRED / 409 OFFER_NO_PRICE обрабатываются честно.
 *
 * Оформление заказа (§B10): «Перейти к оформлению заказа» собирает
 * custom-позицию корзины из снимка заявки (buildInquiryBuilderConfig),
 * оставляет её ЕДИНСТВЕННОЙ custom-позицией (требование серверного binding —
 * ровно одна custom-позиция), ставит pendingNegotiationId в store и уводит на
 * checkout. Цены в теле checkout НЕТ — сервер подменяет её из negotiations.
 *
 * Палитра дашборда (milk/cream, graphite, berry primary), без синих/индиго.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertCircle,
  BadgeCheck,
  ChevronDown,
  Clock,
  History,
  Loader2,
  RefreshCw,
  ShoppingBag,
  TimerOff,
  Truck,
} from "lucide-react";
import { formatCurrency } from "@/lib/finance";
import {
  buildInquiryBuilderConfig,
  formatOfferPrice,
  formatMoscowDate,
  formatMoscowDateTime,
  mapRevisionReason,
} from "@/lib/offer-format";
import {
  useBuyerOffers,
  useNegotiationDetail,
  useAcceptOffer,
  NegotiationActionError,
  type BuyerOffer,
  type BuyerInquiry,
} from "@/lib/use-buyer-offers";
import { useAppStore } from "@/lib/store";

// ===== Бейджи статусов предложения =====

function offerBadge(
  offer: BuyerOffer
): { label: string; className: string } {
  if (offer.status === "accepted") {
    return {
      label: "Принято",
      className: "bg-emerald-100 text-emerald-800 border-emerald-200",
    };
  }
  if (offer.isExpired || offer.status === "expired") {
    return { label: "Истекло", className: "bg-red-50 text-red-700 border-red-200" };
  }
  if (offer.status === "quoted") {
    return {
      label: "Предложение отправлено",
      className: "bg-amber-100 text-amber-800 border-amber-200",
    };
  }
  if (offer.status === "counter_offered") {
    return {
      label: "Запрошено изменение",
      className: "bg-amber-50 text-amber-700 border-amber-200",
    };
  }
  if (offer.status === "declined") {
    return {
      label: "Отклонено",
      className: "bg-muted text-muted-foreground border-border",
    };
  }
  return {
    label: "Ожидает ответа кондитера",
    className: "bg-muted text-muted-foreground border-border",
  };
}

const INQUIRY_STATUS_LABELS: Record<string, string> = {
  open: "Открыта",
  converted: "Преобразована в заказ",
  closed: "Закрыта",
  expired: "Истек срок запроса",
};

// ===== История предложения (revisions) =====

function OfferHistory({ negotiationId }: { negotiationId: string }) {
  const { data, isLoading, isError, error } = useNegotiationDetail(negotiationId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Загружаем историю…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="text-xs text-destructive p-2 flex items-center gap-1">
        <AlertCircle className="h-3 w-3" aria-hidden />
        Не удалось загрузить историю: {error.message}
      </div>
    );
  }

  const revisions = (data?.revisions || [])
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  if (revisions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground p-2">
        История пока пуста — здесь появятся изменения цены и принятие предложения
      </p>
    );
  }

  return (
    <ol className="space-y-2 p-2">
      {revisions.map((rev) => (
        <li
          key={rev.id}
          className="flex items-start justify-between gap-2 text-xs border-b border-border/60 pb-2 last:border-0 last:pb-0"
        >
          <div className="min-w-0">
            <div className="font-medium">{mapRevisionReason(rev.change_reason)}</div>
            <div className="text-muted-foreground">
              {formatMoscowDateTime(rev.created_at)} (МСК)
            </div>
          </div>
          <div className="text-right shrink-0 font-semibold">
            {rev.quoted_price !== null && rev.quoted_price !== undefined
              ? formatOfferPrice(rev.quoted_price)
              : "—"}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ===== Карточка предложения =====

function OfferCard({
  offer,
  inquiry,
  now,
}: {
  offer: BuyerOffer;
  inquiry: BuyerInquiry;
  now: Date;
}) {
  const navigate = useAppStore((s) => s.navigate);
  const acceptOffer = useAcceptOffer();
  const badge = offerBadge(offer);
  const canAccept =
    offer.status === "quoted" &&
    !offer.isExpired &&
    offer.validUntil !== null &&
    new Date(offer.validUntil).getTime() > now.getTime() &&
    offer.quotedPriceKopecks !== null;

  // Инлайн-сообщение об ошибке действия (410 OFFER_EXPIRED / 409 OFFER_NO_PRICE)
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const handleAccept = () => {
    setActionNotice(null);
    acceptOffer.mutate(
      { negotiationId: offer.negotiationId },
      {
        onSuccess: () => {
          toast.success("Предложение принято", {
            description: "Цена зафиксирована — можно оформлять заказ",
          });
        },
        onError: (err: Error) => {
          const code = err instanceof NegotiationActionError ? err.code : null;
          if (code === "OFFER_EXPIRED") {
            setActionNotice("Предложение истекло — запросите новое у кондитера");
            toast.error("Предложение истекло", {
              description: "Запросите новое у кондитера",
            });
          } else if (code === "OFFER_NO_PRICE") {
            setActionNotice("Кондитер ещё не отправил цену — принять нельзя");
            toast.error("Нет цены в предложении", {
              description: "Дождитесь предложения кондитера",
            });
          } else {
            setActionNotice(err.message);
            toast.error("Не удалось принять предложение", { description: err.message });
          }
        },
      }
    );
  };

  /**
   * §B10 + ZV33-4b D4: custom-позиция корзины из снимка заявки +
   * pendingNegotiationId + agreedPriceRub. Binding сервера требует РОВНО ОДНУ
   * custom-позицию — другие custom-позиции (старые сборки конструктора)
   * убираем, товарные не трогаем. agreedPriceRub — ТОЛЬКО для честного
   * отображения (корзина/checkout показывают согласованную цену, а не
   * estimate конструктора); тело checkout цены по-прежнему НЕ содержит.
   */
  const goToCheckout = () => {
    if (offer.quotedPriceKopecks === null) return; // гейт кнопки это уже гарантирует
    const store = useAppStore.getState();
    const agreedPriceRub = offer.quotedPriceKopecks / 100;
    const config = buildInquiryBuilderConfig({
      event_type: inquiry.eventType,
      base: inquiry.base,
      filling: inquiry.filling,
      coating: inquiry.coating,
      decorations: inquiry.decorations,
      dietary: inquiry.dietary,
      servings: inquiry.servings,
      city: inquiry.city,
      delivery_date: inquiry.deliveryDate,
      delivery_type: inquiry.deliveryType,
      inscription: inquiry.inscription,
      comment: inquiry.comment,
    });
    for (const item of store.cart) {
      if (item.custom) {
        store.removeFromCart(item.itemId || item.productId);
      }
    }
    store.addCustomToCart({ config, quantity: 1, agreedPriceRub });
    store.setPendingNegotiationId(offer.negotiationId);
    toast.success("Торт добавлен в корзину", {
      description: `Цена по предложению: ${formatCurrency(agreedPriceRub)} — оформите заказ по этой цене`,
    });
    // ZV33-8d FIX C: view-router store живёт только на '/' — из /dashboard
    // navigate("checkout") был no-op (тот же дефект, что «Оформить заказ» в
    // cart-drawer, см. там комментарий). pendingNegotiationId персистится.
    if (typeof window !== "undefined" && window.location.pathname !== "/") {
      window.location.assign("/checkout");
      return;
    }
    navigate("checkout");
  };

  return (
    <Card
      className={`p-4 sm:p-5 ${offer.status === "quoted" && !offer.isExpired ? "border-primary/30 bg-primary/[0.03]" : ""}`}
    >
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10 shrink-0">
          {offer.confectionerAvatar ? (
            <AvatarImage src={offer.confectionerAvatar} alt={offer.confectionerName} />
          ) : null}
          <AvatarFallback>{offer.confectionerName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-sm">{offer.confectionerName}</span>
            <Badge variant="outline" className={`text-[10px] ${badge.className}`}>
              {badge.label}
            </Badge>
          </div>
          {offer.status === "pending" && (
            <p className="text-xs text-muted-foreground">
              Кондитер ещё не ответил — предложения приходят обычно в течение 48 часов
            </p>
          )}
        </div>
      </div>

      {/* Цена и условия предложения */}
      {offer.quotedPriceKopecks !== null && (
        <div className="mt-3 space-y-1.5 text-sm">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Цена предложения:</span>
            <span className="text-lg font-bold text-primary">
              {formatOfferPrice(offer.quotedPriceKopecks)}
            </span>
          </div>
          {offer.quotedPrepTime && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              Срок изготовления: {offer.quotedPrepTime}
            </div>
          )}
          {offer.quotedDeliveryCostKopecks !== null && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Truck className="h-3.5 w-3.5" aria-hidden />
              Доставка: {formatOfferPrice(offer.quotedDeliveryCostKopecks)}
            </div>
          )}
          {offer.validUntil && !offer.isExpired && offer.status !== "accepted" && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <History className="h-3.5 w-3.5" aria-hidden />
              Действует до {formatMoscowDate(offer.validUntil)} (МСК)
            </div>
          )}
          {offer.acceptedAt && offer.status === "accepted" && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-700">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
              Принято {formatMoscowDateTime(offer.acceptedAt)} (МСК) — цена зафиксирована
            </div>
          )}
          {(offer.isExpired || offer.status === "expired") && (
            <div className="flex items-start gap-1.5 text-xs text-red-700 bg-red-50 rounded p-2">
              <TimerOff className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
              <span>
                Предложение истекло — запросите новое у кондитера
                {offer.validUntil
                  ? ` (действовало до ${formatMoscowDate(offer.validUntil)})`
                  : ""}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Инлайн-ошибка действия (410/409) */}
      {actionNotice && (
        <div
          role="alert"
          className="mt-2 flex items-start gap-1.5 text-xs text-red-700 bg-red-50 rounded p-2"
        >
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Действия (§B7/B8) */}
      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        {offer.status === "quoted" && !offer.isExpired && (
          <Button
            className="w-full sm:w-auto min-h-[44px]"
            disabled={!canAccept || acceptOffer.isPending}
            title={
              offer.quotedPriceKopecks === null
                ? "В предложении нет цены — принять нельзя"
                : undefined
            }
            onClick={handleAccept}
          >
            {acceptOffer.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />
            ) : (
              <BadgeCheck className="h-4 w-4 mr-1" aria-hidden />
            )}
            Принять предложение
          </Button>
        )}
        {offer.status === "accepted" && (
          <>
            <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 px-1">
              <BadgeCheck className="h-4 w-4" aria-hidden />
              Цена зафиксирована
            </div>
            <Button
              className="w-full sm:w-auto min-h-[44px] sm:ml-auto"
              onClick={goToCheckout}
            >
              <ShoppingBag className="h-4 w-4 mr-1" aria-hidden />
              Перейти к оформлению заказа
            </Button>
          </>
        )}
      </div>

      {/* История предложения (§B9) */}
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors min-h-[44px] sm:min-h-0"
            aria-expanded={historyOpen}
          >
            <History className="h-3.5 w-3.5" aria-hidden />
            История предложения
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${historyOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 rounded-lg border border-border bg-muted/30">
            <OfferHistory negotiationId={offer.negotiationId} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ===== Вкладка =====

export function BuyerOffersTab() {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const { data: inquiries, isLoading, isError, error, refetch } = useBuyerOffers();
  // «Сейчас» для клиентского сравнения сроков: пересчёт на mount + тик раз в 60 с
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const totalOffers = useMemo(
    () => (inquiries || []).reduce((sum, i) => sum + i.offers.length, 0),
    [inquiries]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Предложения кондитеров</h1>
          <p className="text-sm text-muted-foreground">
            Индивидуальные предложения по вашим заявкам из конструктора. Примите
            предложение — и оформите заказ по зафиксированной цене.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isError && !!user && (
            <Badge variant="outline" className="text-[10px] shrink-0">
              Предложений: {totalOffers}
            </Badge>
          )}
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" aria-hidden />
            Обновить
          </Button>
        </div>
      </div>

      {isLoading && (
        <Card className="p-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Загружаем предложения…
        </Card>
      )}

      {isError && (
        <Card className="p-6 text-center space-y-3">
          <AlertCircle className="h-8 w-8 mx-auto text-destructive" aria-hidden />
          <p className="text-sm text-destructive">
            Не удалось загрузить предложения: {error.message}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" aria-hidden />
            Повторить
          </Button>
        </Card>
      )}

      {!isLoading && !isError && (inquiries || []).length === 0 && (
        <Card className="p-8 text-center space-y-3">
          <ShoppingBag className="h-10 w-10 mx-auto opacity-30" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Заявок пока нет. Соберите торт в конструкторе и отправьте запрос —
            предложения кондитеров появятся здесь.
          </p>
          <Button size="sm" onClick={() => navigate("cake-builder")}>
            Открыть конструктор
          </Button>
        </Card>
      )}

      {!(isLoading || isError) &&
        (inquiries || []).map((inquiry) => (
          <Card key={inquiry.id} className="p-4 sm:p-6">
            <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
              <div className="min-w-0">
                <div className="font-semibold text-sm">
                  {inquiry.eventType || "Индивидуальный торт"} • {inquiry.servings} порц.
                  {inquiry.city ? ` • ${inquiry.city}` : ""}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {inquiry.base || "—"} • {inquiry.filling || "—"}
                  {inquiry.deliveryDate
                    ? ` • к ${formatMoscowDate(inquiry.deliveryDate)}`
                    : ""}
                  {inquiry.estimatedPriceRub !== null
                    ? ` • ваша оценка ${formatCurrency(inquiry.estimatedPriceRub)}`
                    : ""}
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0">
                {INQUIRY_STATUS_LABELS[inquiry.inquiryStatus] || inquiry.inquiryStatus}
              </Badge>
            </div>
            {inquiry.comment && (
              <div className="text-sm text-muted-foreground mb-3 p-2 bg-muted/50 rounded">
                {inquiry.comment}
              </div>
            )}
            {inquiry.offers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Предложений пока нет — запрос ушёл кондитерам
              </p>
            ) : (
              <div className="space-y-3">
                {inquiry.offers.map((offer) => (
                  <OfferCard key={offer.negotiationId} offer={offer} inquiry={inquiry} now={now} />
                ))}
              </div>
            )}
          </Card>
        ))}
    </div>
  );
}
