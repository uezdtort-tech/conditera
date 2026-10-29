"use client";

/**
 * OrderTimelineEvents — история событий и переходов статусов заказа.
 *
 * Данные — СУЩЕСТВУЮЩИЙ эндпоинт GET /api/orders/[id]/timeline
 * (domain_events + order_status_history, ТЗ §41); тип ответа переиспользуется
 * из lifecycle-client-types. Разметка повторяет вкладку «События» админского
 * order-workspace-dialog (тот же queryKey «order-timeline» → общий кэш).
 *
 * Используется в карточке заказа кондитера (confectioner-dashboard, таб «Заказы»)
 * как схлопываемый блок «История статусов» — подгрузка ленивая, по раскрытию.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { TimelineResponse } from "@/lib/ops/lifecycle-client-types";
import { getSessionAuthHeaders } from "@/lib/api-client";

function formatTimelineTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrderTimelineEvents({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);

  const timelineQuery = useQuery<TimelineResponse, Error>({
    queryKey: ["order-timeline", orderId],
    enabled: open,
    staleTime: 15_000,
    retry: 1,
    queryFn: async () => {
      const headers = await getSessionAuthHeaders();
      const res = await fetch(`/api/orders/${orderId}/timeline`, {
        headers,
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as TimelineResponse;
    },
  });

  return (
    <div className="mt-3">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 mr-1" aria-hidden />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 mr-1" aria-hidden />
        )}
        <History className="h-3.5 w-3.5 mr-1" aria-hidden />
        История статусов
      </Button>

      {open && (
        <div className="mt-1">
          {timelineQuery.isLoading ? (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Загружаем историю...
            </div>
          ) : timelineQuery.error ? (
            <div className="flex items-center gap-2 py-3 text-xs text-destructive">
              {(timelineQuery.error as Error).message || "Не удалось загрузить историю"}
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={() => void timelineQuery.refetch()}
              >
                <RefreshCw className="h-3 w-3 mr-1" aria-hidden />
                Повторить
              </Button>
            </div>
          ) : timelineQuery.data ? (
            timelineQuery.data.timeline.length === 0 ? (
              <div className="py-2 text-xs text-muted-foreground">
                Событий пока нет — история появится после первых переходов
              </div>
            ) : (
              <div className="ml-2 border-l-2 border-border space-y-2.5 py-1">
                {timelineQuery.data.timeline.map((item, idx) => (
                  <div key={`${item.at}-${idx}`} className="relative pl-4">
                    <span
                      className={`absolute -left-[5px] top-1 h-2 w-2 rounded-full ${
                        item.kind === "status" ? "bg-primary" : "bg-muted-foreground/50"
                      }`}
                      aria-hidden
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {formatTimelineTime(item.at)}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] border-slate-200 text-slate-600"
                      >
                        {item.kind === "status" ? "статус" : "событие"}
                      </Badge>
                    </div>
                    <div className="text-sm mt-0.5">{item.title}</div>
                  </div>
                ))}
              </div>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
