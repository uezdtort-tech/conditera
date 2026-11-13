"use client";

/**
 * confectioner-inquiries-tab.tsx — ZV33-4: реальная вкладка «Заявки из
 * конструктора» кондитера (GET /api/inquiries?filter=available +
 * PATCH /api/negotiations/[id]).
 *
 * Что умеет (требования ZV33-4 §A):
 *   • форма предложения (Dialog): цена ₽ (обязательная, > 0, ×100 в копейки
 *     при отправке), комментарий, срок действия 1–60 дней (дефолт 14,
 *     клиентский кламп clampOfferValidityDays), живое превью «Действует до»;
 *   • бейджи статусов: Новая / Предложение отправлено / Принято покупателем /
 *     Истекло / Отклонена (+ встречное предложение); valid_until и accepted_at
 *     показываются на карточке, истечение сравнивается клиентски (тик раз в 60с
 *     + пересчёт на mount);
 *   • re-quote: «Пересчитать и отправить заново» — та же форма, prefill
 *     последней цены; сервер создаёт revision price_adjustment и обновляет
 *     valid_until;
 *   • accepted: бейдж + accepted_at, actions скрыты (сервер вернёт 409).
 *
 * Палитра — токены дашборда (milk/cream фон, graphite текст, berry primary);
 * никаких синих/индиго.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  History,
  Loader2,
  RefreshCw,
  Send,
  TimerOff,
} from "lucide-react";
import { formatCurrency } from "@/lib/finance";
import {
  clampOfferValidityDays,
  formatOfferPrice,
  formatMoscowDate,
  isOfferExpired,
  previewOfferValidUntil,
} from "@/lib/offer-format";
import {
  useRealInquiries,
  useQuoteNegotiation,
  useDeclineNegotiation,
  type ConfectionerInquiry,
  type ConfectionerInquiryStatus,
} from "@/lib/use-real-inquiries";

// ===== Бейджи статусов (палитра соседних вкладок: amber/emerald/red/muted) =====

interface StatusBadgeInfo {
  label: string;
  className: string;
}

function statusBadge(
  inquiry: ConfectionerInquiry,
  now: Date
): StatusBadgeInfo {
  // Клиентское сравнение срока: серверный статус может отставать (ленивый гард
  // в PATCH accept), поэтому quoted + valid_until в прошлом показываем как «Истекло».
  const expiredByDate =
    inquiry.status === "quoted" && isOfferExpired(inquiry.validUntil, now);
  switch (inquiry.status) {
    case "new":
      return {
        label: "Новая",
        className: "bg-primary text-primary-foreground border-primary",
      };
    case "quoted":
      return expiredByDate
        ? {
            label: "Истекло",
            className: "bg-red-50 text-red-700 border-red-200",
          }
        : {
            label: "Предложение отправлено",
            className: "bg-amber-100 text-amber-800 border-amber-200",
          };
    case "accepted":
      return {
        label: "Принято покупателем",
        className: "bg-emerald-100 text-emerald-800 border-emerald-200",
      };
    case "expired":
      return {
        label: "Истекло",
        className: "bg-red-50 text-red-700 border-red-200",
      };
    case "counter_offered":
      return {
        label: "Покупатель запросил изменение",
        className: "bg-amber-50 text-amber-700 border-amber-200",
      };
    case "declined":
      return {
        label: "Отклонена",
        className: "bg-muted text-muted-foreground border-border",
      };
  }
}

// ===== Диалог предложения (quote / re-quote) =====

interface OfferFormState {
  inquiry: ConfectionerInquiry;
  /** re-quote — prefill последней предложенной цены */
  isRequote: boolean;
}

function OfferFormDialog({
  form,
  onClose,
}: {
  form: OfferFormState | null;
  onClose: () => void;
}) {
  const quoteNegotiation = useQuoteNegotiation();
  const [priceInput, setPriceInput] = useState("");
  const [comment, setComment] = useState("");
  const [daysInput, setDaysInput] = useState("14");
  // Превью «Действует до» считается от текущего момента на каждое открытие формы
  const [now, setNow] = useState(() => new Date());

  // Prefill при открытии: re-quote → последняя предложенная цена; новая заявка → бюджет клиента
  useEffect(() => {
    if (!form) return;
    const prefill =
      form.isRequote && form.inquiry.quotedPriceRub !== null
        ? form.inquiry.quotedPriceRub
        : form.inquiry.budget > 0
          ? form.inquiry.budget
          : "";
    setPriceInput(prefill === "" ? "" : String(prefill));
    setComment(form.inquiry.comment || "");
    setDaysInput("14");
    setNow(new Date());
  }, [form?.inquiry.id, form?.isRequote]);

  const parsedPrice = Number(priceInput.replace(",", "."));
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice > 0;
  const daysClamped = clampOfferValidityDays(daysInput);
  const validUntilPreview = useMemo(
    () => previewOfferValidUntil(daysClamped, now),
    [daysClamped, now]
  );

  if (!form) return null;
  const { inquiry, isRequote } = form;

  const handleSubmit = () => {
    if (!inquiry.negotiationId) return;
    if (!priceValid) {
      toast.error("Укажите цену больше нуля");
      return;
    }
    quoteNegotiation.mutate(
      {
        negotiationId: inquiry.negotiationId,
        priceRub: parsedPrice,
        comment: comment.trim() || undefined,
        validDays: daysClamped,
      },
      {
        onSuccess: (data) => {
          const validUntil = data?.negotiation?.valid_until;
          toast.success(isRequote ? "Предложение обновлено" : "Предложение отправлено!", {
            description: validUntil
              ? `Цена: ${formatCurrency(parsedPrice)}. Действует до: ${formatMoscowDate(validUntil)}`
              : `Цена: ${formatCurrency(parsedPrice)}`,
          });
          onClose();
        },
        onError: (error: Error) => {
          toast.error("Не удалось отправить предложение", {
            description: error.message,
          });
        },
      }
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">
            {isRequote ? "Пересчитать и отправить заново" : "Предложить цену"}
          </DialogTitle>
          <DialogDescription>
            {inquiry.customerName ? `Заявка от ${inquiry.customerName}` : "Заявка из конструктора"}
            {" • "}
            {inquiry.servings} порц. • бюджет клиента {formatCurrency(inquiry.budget)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="offer-price">Цена, ₽ *</Label>
            <Input
              id="offer-price"
              inputMode="decimal"
              type="number"
              min="1"
              step="1"
              placeholder="Например 3500"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              aria-invalid={!priceValid && priceInput !== ""}
            />
            {!priceValid && priceInput !== "" && (
              <p className="text-xs text-destructive">Введите положительное число</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="offer-days">Срок действия предложения, дней</Label>
            <Input
              id="offer-days"
              inputMode="numeric"
              type="number"
              min="1"
              max="60"
              step="1"
              value={daysInput}
              onChange={(e) => setDaysInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Срок действия: 1–60 дней (по умолчанию 14)
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="offer-comment">Комментарий (необязательно)</Label>
            <Textarea
              id="offer-comment"
              placeholder="Что входит в цену, сроки изготовления, условия доставки…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <Clock className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="text-muted-foreground">
              Действует до:{" "}
              <span className="font-semibold text-foreground">
                {formatMoscowDate(validUntilPreview)}
              </span>{" "}
              (МСК, +{daysClamped} дн.)
            </span>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="w-full sm:w-auto min-h-[44px]"
            disabled={quoteNegotiation.isPending}
          >
            Отмена
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!priceValid || quoteNegotiation.isPending || !inquiry.negotiationId}
            className="w-full sm:w-auto min-h-[44px]"
          >
            {quoteNegotiation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />
            ) : (
              <Send className="h-4 w-4 mr-1" aria-hidden />
            )}
            {isRequote ? "Отправить заново" : "Отправить предложение"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===== Вкладка =====

export function ConfectionerInquiriesTab() {
  const { inquiries, isStale, isLoading, refetch } = useRealInquiries();
  const declineNegotiation = useDeclineNegotiation();
  const [form, setForm] = useState<OfferFormState | null>(null);
  // «Сейчас» для клиентского сравнения сроков: пересчёт на mount + тик раз в 60 с
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="font-display text-2xl font-bold">Заявки из конструктора</h1>
        <div className="flex items-center gap-2">
          {isStale && (
            <Badge
              variant="outline"
              className="text-[10px] bg-amber-50 text-amber-700 border-amber-200"
            >
              Офлайн-данные
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
          Загружаем заявки…
        </Card>
      )}

      {!isLoading && inquiries.length === 0 && (
        <Card className="p-8 text-center text-muted-foreground text-sm">
          Открытых заявок пока нет — новые появятся здесь автоматически
        </Card>
      )}

      <div className="space-y-3">
        {inquiries.map((inq) => {
          const badge = statusBadge(inq, now);
          const expiredByDate =
            (inq.status === "quoted" || inq.status === "expired") &&
            isOfferExpired(inq.validUntil, now);
          // ZV33-4 §A3: gate только accepted/declined (сервер 409 на quote по
          // accepted). Истёкшее по дате — МОЖНО отправить заново: PATCH quote
          // обновит valid_until (специально заложенный сервером re-quote-флоу,
          // см. комментарий к action:"quote" в /api/negotiations/[id]).
          const canQuote =
            !!inq.negotiationId &&
            inq.status !== "accepted" &&
            inq.status !== "declined";
          const isDemo = !inq.negotiationId;

          return (
            <Card key={inq.id} className="p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarFallback>
                    {inq.customerName ? inq.customerName[0] : "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold">{inq.customerName || "Запрос"}</span>
                    <Badge variant="outline" className={`text-[10px] ${badge.className}`}>
                      {badge.label}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">
                    {inq.eventType || "—"} • {inq.base || "—"} • {inq.filling || "—"} •{" "}
                    {inq.servings} порц. • {inq.city || "—"}
                    {inq.deliveryDate ? ` • к ${formatMoscowDate(inq.deliveryDate)}` : ""}
                  </div>
                  {inq.comment && (
                    <div className="text-sm text-muted-foreground mb-2 p-2 bg-muted/50 rounded">
                      {inq.comment}
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="text-xs text-muted-foreground">Бюджет клиента:</span>
                    <span className="font-semibold">{formatCurrency(inq.budget)}</span>
                  </div>

                  {/* Детали текущего предложения (ZV33-4 §A2) */}
                  {inq.quotedPriceKopecks !== null && (
                    <div className="mt-2 space-y-1 text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">Ваше предложение:</span>
                        <span className="font-semibold text-primary">
                          {formatOfferPrice(inq.quotedPriceKopecks)}
                        </span>
                        {inq.quotedPrepTime && (
                          <span className="text-xs text-muted-foreground">
                            • срок: {inq.quotedPrepTime}
                          </span>
                        )}
                      </div>
                      {inq.validUntil && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <History className="h-3 w-3" aria-hidden />
                          {expiredByDate
                            ? `Действовало до ${formatMoscowDate(inq.validUntil)} — срок истёк`
                            : `Действует до ${formatMoscowDate(inq.validUntil)} (МСК)`}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Принято покупателем (ZV33-4 §A4): accepted_at, без actions */}
                  {inq.status === "accepted" && (
                    <div className="mt-2 flex items-center gap-2 text-sm text-emerald-700">
                      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                      <span>
                        Цена зафиксирована
                        {inq.acceptedAt
                          ? ` — принято ${formatMoscowDate(inq.acceptedAt)} (МСК)`
                          : ""}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                {inq.status !== "accepted" && (
                  <div className="flex flex-col gap-2 shrink-0 w-full sm:w-auto">
                    <Button
                      size="sm"
                      className="min-h-[44px]"
                      disabled={!canQuote || isDemo}
                      title={
                        isDemo
                          ? "Демо-данные — отклик недоступен"
                          : expiredByDate
                            ? "Отправьте предложение заново — у покупателя появится новый срок действия"
                            : undefined
                      }
                      onClick={() =>
                        setForm({
                          inquiry: inq,
                          isRequote: inq.status === "quoted",
                        })
                      }
                    >
                      {expiredByDate ? (
                        <TimerOff className="h-4 w-4 mr-1" aria-hidden />
                      ) : inq.status === "quoted" ? (
                        <History className="h-4 w-4 mr-1" aria-hidden />
                      ) : (
                        <Send className="h-4 w-4 mr-1" aria-hidden />
                      )}
                      {expiredByDate
                        ? "Отправить новое предложение"
                        : inq.status === "quoted"
                          ? "Пересчитать и отправить заново"
                          : "Предложить цену"}
                    </Button>
                    {inq.status === "quoted" && inq.validUntil && !expiredByDate && (
                      <p className="text-[11px] text-muted-foreground sm:text-right">
                        Повторная отправка обновит цену и срок действия
                      </p>
                    )}
                    {expiredByDate && inq.validUntil && (
                      <p className="text-[11px] text-red-700 sm:text-right">
                        Срок истёк {formatMoscowDate(inq.validUntil)} — отправьте заново, покупатель
                        получит новый срок действия
                      </p>
                    )}
                    {(inq.status === "new" || inq.status === "counter_offered") && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-[44px]"
                            disabled={isDemo || declineNegotiation.isPending}
                            title={isDemo ? "Демо-данные — отклонение недоступно" : undefined}
                          >
                            Отклонить
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Отклонить заявку?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Заявка{" "}
                              {inq.customerName ? `от ${inq.customerName} ` : ""}
                              будет отклонена — покупатель увидит, что вы не участвуете в этом
                              запросе.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Вернуться</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => {
                                if (!inq.negotiationId) return;
                                declineNegotiation.mutate(
                                  { negotiationId: inq.negotiationId },
                                  {
                                    onSuccess: () => toast.success("Заявка отклонена"),
                                    onError: (error: Error) =>
                                      toast.error("Не удалось отклонить заявку", {
                                        description: error.message,
                                      }),
                                  }
                                );
                              }}
                            >
                              Отклонить заявку
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {!isLoading && inquiries.length > 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <AlertCircle className="h-3 w-3" aria-hidden />
          Срок действия предложения задаётся при отправке (1–60 дней, по умолчанию 14). Истёкшее
          предложение можно пересчитать и отправить заново.
        </p>
      )}

      <OfferFormDialog form={form} onClose={() => setForm(null)} />
    </div>
  );
}

// Реэкспорт для читаемости: статус используется при тестировании маппера
export type { ConfectionerInquiryStatus };
