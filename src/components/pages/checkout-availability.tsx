"use client";

/**
 * CheckoutAvailabilityBanner — клиентская проверка выполнимости заказа
 * ещё ДО оплаты (ТЗ P0.5 §29).
 *
 * POST /api/orders/availability (auth Bearer + CSRF, read-only).
 * Поведение:
 *  - available / загрузка / ошибка / выключено → рендерит НИЧЕГО
 *    (без layout-джанка; серверный гейт 422 в POST /api/checkout —
 *     последняя инстанция);
 *  - available_with_warning → amber-карточка: причины + подсказки;
 *  - unavailable → red-карточка: «выполнить не получится» +
 *    ближайшее альтернативное окно + причины.
 *
 * Debounce: staleTime 60с — дата/корзина входят в queryKey, поэтому
 * перерисовки полей формы (адрес/город) не триггерят лишние запросы.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarX2, Lightbulb, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { csrfFetch, getSessionAuthHeaders } from "@/lib/api-client";
import type { AvailabilityResponse } from "@/lib/ops/lifecycle-client-types";

export interface CheckoutAvailabilityCartItem {
  productId: string;
  quantity: number;
}

/** «2026-02-14» + «15:30[:00]» → «14.02 15:30» (null — если распарсить не удалось). */
export function formatAlternativeWindowShort(
  w: { date?: string; start?: string } | null | undefined
): string | null {
  if (!w || typeof w.date !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(w.date);
  if (!m) return null;
  const time = typeof w.start === "string" ? w.start.slice(0, 5) : "";
  return time ? `${m[3]}.${m[2]} ${time}` : `${m[3]}.${m[2]}`;
}

/** Ближайшее окно: min по (date, start) — защита от несортированного массива. */
function pickNearestWindow(
  windows: AvailabilityResponse["alternativeWindows"]
): AvailabilityResponse["alternativeWindows"][number] | null {
  if (!windows || windows.length === 0) return null;
  return [...windows].sort((a, b) => {
    const ka = `${a.date}T${a.start}`;
    const kb = `${b.date}T${b.start}`;
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  })[0];
}

export function CheckoutAvailabilityBanner({
  cart,
  deliveryDate,
  enabled = true,
}: {
  cart: CheckoutAvailabilityCartItem[];
  deliveryDate: string;
  /** false → проверка не выполняется (например, гость не вошёл). */
  enabled?: boolean;
}) {
  const cartHash = useMemo(
    () => cart.map((i) => `${i.productId}:${i.quantity}`).join("|"),
    [cart]
  );
  const isActive = enabled && deliveryDate.trim().length > 0 && cart.length > 0;

  const { data, isError } = useQuery({
    queryKey: ["checkout-availability", deliveryDate, cartHash],
    queryFn: async (): Promise<AvailabilityResponse> => {
      const headers = await getSessionAuthHeaders();
      const res = await csrfFetch("/api/orders/availability", {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: cart.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
          })),
          deliveryDate,
        }),
      });
      if (!res.ok) throw new Error(`availability ${res.status}`);
      return (await res.json()) as AvailabilityResponse;
    },
    enabled: isActive,
    staleTime: 60_000,
    retry: 1,
  });

  // available / загрузка / ошибка сети / проверка выключена → ничего не рисуем
  if (!isActive || isError || !data || data.availability === "available") {
    return null;
  }

  const reasons = data.reasons.slice(0, 3);
  const suggestions = data.suggestions.slice(0, 2);

  if (data.availability === "available_with_warning") {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-medium text-amber-800">
              Проверка возможности выполнения
            </p>
            {reasons.length > 0 && (
              <ul className="list-disc space-y-1 pl-4 text-sm text-amber-900/90">
                {reasons.map((r, idx) => (
                  <li key={`${r.code}:${idx}`}>{r.message}</li>
                ))}
              </ul>
            )}
            {suggestions.length > 0 && (
              <ul className="space-y-1">
                {suggestions.map((s, idx) => (
                  <li
                    key={`${s.code}:${idx}`}
                    className="flex items-start gap-1.5 text-sm text-muted-foreground"
                  >
                    <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                    <span className="min-w-0">{s.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // unavailable — красная карточка с ближайшим альтернативным окном
  const when = formatAlternativeWindowShort(pickNearestWindow(data.alternativeWindows));

  return (
    <Card className="border-red-500/40 bg-red-500/5 p-4" role="alert">
      <div className="flex items-start gap-3">
        <CalendarX2 className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium text-red-800">
            На выбранное время заказ выполнить не получится
          </p>
          {when && (
            <p className="text-sm text-red-700">
              Ближайшее доступное время — <span className="font-semibold tnum">{when}</span>.
              Поменяйте дату доставки.
            </p>
          )}
          {reasons.length > 0 && (
            <ul className="list-disc space-y-1 pl-4 text-sm text-red-800/80">
              {reasons.map((r, idx) => (
                <li key={`${r.code}:${idx}`}>{r.message}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
