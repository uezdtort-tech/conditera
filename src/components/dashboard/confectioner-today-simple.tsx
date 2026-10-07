"use client";

/**
 * confectioner-today-simple.tsx — простой экран «Сегодня» для домашнего
 * кондитера (P0.5 Core Adaptive, ТЗ-корректировка).
 *
 * Принцип: сложность находится внутри системы, а не перекладывается на
 * пользователя. Здесь нет слов «production», «capacity reservation», «SLA» —
 * только:
 *
 *   Заказ №1045 — Торт «Красный бархат»
 *   🕐 Выдать к 17:00
 *   👤 Анна
 *   🟢 Всё необходимое есть
 *   [Начать приготовление]
 *
 *   ⚠️ Не хватает сливок — 500 мл. Нужно купить до 12:00, чтобы успеть.
 *   [Создать покупку]
 *
 *   ⚠️ На сегодня много заказов — есть риск не успеть.
 *   Ближайшее свободное время: 18:30
 *
 * Кнопка на карточке вызывает СУЩЕСТВУЮЩИЕ lifecycle-эндпоинты (start / ready
 * / handoff / accept) — никакого второго набора действий.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import {
  AlertTriangle, ArrowRight, Camera, CheckCircle2, ChefHat, Clock, Loader2,
  Package, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { EmptyState } from "@/components/dashboard/_shared";
import { csrfFetch } from "@/lib/api-client";
import { formatRub } from "@/lib/ops-client-types";
import type { CapacityAlert, SimpleOrderCard } from "@/lib/ops/lifecycle-client-types";

// ---------------------------------------------------------------------------
// Действия lifecycle (существующие эндпоинты P0.5)
// ---------------------------------------------------------------------------

const TODO_ENDPOINTS: Record<
  NonNullable<SimpleOrderCard["todo"]>["code"],
  (orderId: string) => string
> = {
  accept: (id) => `/api/orders/${id}/accept`,
  start: (id) => `/api/orders/${id}/production/start`,
  ready: (id) => `/api/orders/${id}/ready`,
  handoff: (id) => `/api/orders/${id}/handoff`,
};

/** Требуется фото готовности (гейт §35) — открываем разбор заказа. */
export class ReadyPhotoNeededError extends Error {
  constructor() {
    super("Добавьте фото готового заказа");
    this.name = "ReadyPhotoNeededError";
  }
}

async function runOrderAction(orderId: string, code: string): Promise<void> {
  const call = () => csrfFetch(TODO_ENDPOINTS[code](orderId), { method: "POST" });
  let res = await call();
  let body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;

  // Сложность внутри системы (ТЗ-корректировка): чеклист производства —
  // внутренняя механика. Если движок требует завершённых этапов (QC-гейт),
  // отмечаем их автоматически и повторяем попытку.
  if (!res.ok && body?.error === "QC_GATE_FAILED") {
    const done = await csrfFetch(`/api/orders/${orderId}/production/complete`, { method: "POST" });
    if (done.ok) {
      res = await call();
      body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
    }
  }

  if (!res.ok && res.status !== 409) {
    if (body?.error === "READY_PHOTO_REQUIRED") throw new ReadyPhotoNeededError();
    throw new Error(body?.message || `Не получилось (HTTP ${res.status})`);
  }
}

// ---------------------------------------------------------------------------
// Вспомогательные подписи (без ERP-терминов)
// ---------------------------------------------------------------------------

const AVAILABILITY_UI: Record<
  NonNullable<SimpleOrderCard["availability"]>,
  { label: string; dot: string; text: string }
> = {
  ok: { label: "Всё необходимое есть", dot: "bg-emerald-500", text: "text-emerald-700" },
  missing_ingredients: { label: "Не хватает ингредиентов", dot: "bg-red-500", text: "text-red-700" },
  unknown: { label: "Проверяем наличие", dot: "bg-amber-400", text: "text-amber-700" },
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Ждёт подтверждения",
  CONFIRMED: "Подтверждён",
  PREPARING: "Готовится",
  READY: "Готов",
  IN_DELIVERY: "В доставке",
  DELIVERED: "Доставлен",
  COMPLETED: "Завершён",
};

function formatShortage(shortage: number | null, unit: string): string {
  if (shortage == null) return unit;
  const rounded = Math.round(shortage * 100) / 100;
  return `${rounded} ${unit}`.trim();
}

/** «Нужно купить до 12:00» — из крайнего безопасного срока старта. */
function buyByLabel(latestSafeStartAt: string | null): string | null {
  if (!latestSafeStartAt) return null;
  const d = new Date(latestSafeStartAt);
  if (Number.isNaN(d.getTime())) return null;
  return `до ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Карточка заказа
// ---------------------------------------------------------------------------

function SimpleOrderCardView({
  order,
  onOpenBreakdown,
}: {
  order: SimpleOrderCard;
  onOpenBreakdown: (orderId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [needsPhoto, setNeedsPhoto] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const mutation = useMutation({
    mutationFn: () => runOrderAction(order.orderId, order.todo!.code),
    onSuccess: () => {
      toast.success(`Заказ №${order.number}: ${order.todo?.label.toLowerCase()} ✓`);
      void queryClient.invalidateQueries({ queryKey: ["ops-today"] });
    },
    onError: (err: Error) => {
      if (err instanceof ReadyPhotoNeededError) {
        // Фото готовности обязательно (по категории товара) — просим прямо на карточке
        setNeedsPhoto(true);
        toast.info("Добавьте фото готового заказа");
        return;
      }
      toast.error(err.message || "Что-то пошло не так");
    },
  });

  // Загрузка фото готовности: POST /api/orders/[id]/media → автоповтор «Заказ готов»
  const photoMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await csrfFetch(`/api/orders/${order.orderId}/media`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message || `Не удалось загрузить фото (HTTP ${res.status})`);
      }
    },
    onSuccess: () => {
      toast.success("Фото загружено — завершаем заказ");
      void queryClient.invalidateQueries({ queryKey: ["ops-today"] });
      if (order.todo?.code === "ready") {
        mutation.mutate();
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const availability = order.availability ? AVAILABILITY_UI[order.availability] : null;
  const buyBy = buyByLabel(order.latestSafeStartAt);
  const isDone = !order.todo && order.status !== "PENDING";

  return (
    <Card className={`p-4 sm:p-5 ${order.availability === "missing_ingredients" ? "border-amber-300 bg-amber-50/50" : ""}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h3 className="font-semibold text-base min-w-0 truncate">
          Заказ №{order.number}
          {order.title ? <> — {order.title}</> : null}
          {order.extraItems > 0 ? (
            <span className="text-muted-foreground font-normal"> +{order.extraItems}</span>
          ) : null}
        </h3>
        <Badge variant="outline" className="text-xs shrink-0">
          {STATUS_LABELS[order.status] ?? order.status}
        </Badge>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {order.deliverAt && (
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-4 w-4" aria-hidden />
            Выдать к {order.deliverAt}
          </span>
        )}
        {order.customerName && (
          <span className="inline-flex items-center gap-1.5">
            <User className="h-4 w-4" aria-hidden />
            {order.customerName}
          </span>
        )}
        <span className="tabular-nums font-medium text-foreground">{formatRub(order.total)}</span>
      </div>

      {/* Наличие продуктов — человеческим языком */}
      {availability && (
        <div className={`mt-3 inline-flex items-center gap-2 text-sm font-medium ${availability.text}`}>
          <span className={`h-2 w-2 rounded-full ${availability.dot}`} aria-hidden />
          {availability.label}
        </div>
      )}

      {order.missing.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3" role="alert">
          {order.missing.slice(0, 3).map((m) => (
            <div key={m.name} className="flex items-start gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" aria-hidden />
              <span>
                Не хватает <strong>{m.name}</strong>
                {m.shortage != null ? <> — {formatShortage(m.shortage, m.unit)}</> : null}
                {buyBy ? <> — нужно купить {buyBy}, чтобы успеть к заказу</> : null}
              </span>
            </div>
          ))}
          {order.missing.length > 3 && (
            <div className="text-xs text-amber-700 mt-1">и ещё {order.missing.length - 3} поз.</div>
          )}
          <Button
            size="sm"
            variant="outline"
            className="mt-2 border-amber-400 text-amber-800 hover:bg-amber-100 min-h-[44px] sm:min-h-0"
            onClick={() => onOpenBreakdown(order.orderId)}
          >
            <Package className="h-4 w-4 mr-1.5" aria-hidden />
            Создать покупку
          </Button>
        </div>
      )}

      {/* Фото готовности обязательно для этой категории (гейт §35) */}
      {needsPhoto && (
        <div className="mt-3 rounded-lg border border-sky-300 bg-sky-50 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-sky-800">
            <Camera className="h-4 w-4 shrink-0" aria-hidden />
            Прикрепите фото готового заказа
          </div>
          <p className="text-xs text-sky-700 mt-1">
            Клиент увидит фото в уведомлении «Заказ готов».
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="mt-2 block w-full text-xs text-sky-800 file:mr-2 file:rounded-md file:border-0 file:bg-sky-600 file:px-3 file:py-2 file:text-xs file:font-medium file:text-white hover:file:bg-sky-700"
            aria-label="Фото готового заказа"
            disabled={photoMutation.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) photoMutation.mutate(file);
            }}
          />
          {photoMutation.isPending && (
            <div className="mt-2 inline-flex items-center gap-2 text-xs text-sky-700">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Загружаем фото…
            </div>
          )}
        </div>
      )}

      {/* Одна понятная кнопка на текущем этапе */}
      {order.todo && (
        <Button
          className="mt-4 w-full sm:w-auto min-h-[44px]"
          disabled={mutation.isPending || photoMutation.isPending}
          onClick={() => (needsPhoto ? fileRef.current?.click() : mutation.mutate())}
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
          ) : needsPhoto ? (
            <Camera className="h-4 w-4 mr-2" aria-hidden />
          ) : (
            <ArrowRight className="h-4 w-4 mr-2" aria-hidden />
          )}
          {needsPhoto && order.todo.code === "ready" ? "Прикрепить фото" : order.todo.label}
        </Button>
      )}
      {isDone && (
        <div className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
          Дальше система напомнит сама
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Экран
// ---------------------------------------------------------------------------

export function ConfectionerTodaySimple({
  orders,
  capacityAlert,
  isLoading,
  onOpenBreakdown,
}: {
  orders: SimpleOrderCard[];
  capacityAlert: CapacityAlert | null;
  isLoading: boolean;
  /** Открывает диалог разбора заказа (создание закупки из дефицита). */
  onOpenBreakdown: (orderId: string) => void;
}) {
  const todayLabel = new Date().toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Активные (не завершены) вверху — по времени выдачи
  const sorted = [...orders].sort((a, b) => {
    const rank = (o: SimpleOrderCard) => (o.todo ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return (a.deliverAt ?? "99:99").localeCompare(b.deliverAt ?? "99:99");
  });
  const activeCount = sorted.filter((o) => o.todo).length;
  const problems = sorted.filter((o) => o.availability === "missing_ingredients").length;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-48 bg-muted/60 rounded animate-pulse" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 bg-muted/50 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="font-display text-2xl font-bold capitalize">Сегодня</h1>
        <p className="text-sm text-muted-foreground">{todayLabel}</p>
      </div>

      <p className="text-sm text-muted-foreground">
        {sorted.length === 0
          ? "Заказов на сегодня нет"
          : `${sorted.length} ${sorted.length === 1 ? "заказ" : sorted.length < 5 ? "заказа" : "заказов"}`}
        {activeCount > 0 ? ` · ${activeCount} ждут действия` : ""}
        {problems > 0 ? ` · ${problems} с проблемой` : ""}
      </p>

      {capacityAlert?.active && (
        <Card className="p-4 border-amber-400/60 bg-amber-50" role="alert">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-5 w-5 mt-0.5 text-amber-600 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium text-sm">{capacityAlert.message}</p>
              {capacityAlert.nearestWindow && (
                <p className="text-sm text-muted-foreground mt-1">
                  Ближайшее свободное время:{" "}
                  <strong className="text-foreground">
                    {capacityAlert.nearestWindow.startTime}
                  </strong>{" "}
                  {capacityAlert.nearestWindow.date !==
                  new Date().toISOString().slice(0, 10)
                    ? `(${new Date(capacityAlert.nearestWindow.date).toLocaleDateString("ru-RU", { day: "numeric", month: "numeric" })})`
                    : ""}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Новые заказы на это время система предложит автоматически.
              </p>
            </div>
          </div>
        </Card>
      )}

      {sorted.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            icon={ChefHat}
            title="Сегодня спокойно"
            text="Новых заказов нет. Отдохните или займитесь витриной."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {sorted.map((o) => (
            <SimpleOrderCardView key={o.orderId} order={o} onOpenBreakdown={onOpenBreakdown} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Система сама проверяет продукты и сроки. Если что-то пойдёт не по плану —
        подсветим и подскажем.
      </p>
    </div>
  );
}
