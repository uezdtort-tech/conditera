"use client";

/**
 * confectioner-p05-cards.tsx — карточки P0.5 «Order Lifecycle & Capacity Engine»
 * для таба «Сегодня» кондитера (ТЗ §31, Task 9-b).
 *
 * Данные приходят в ТОМ ЖЕ ответе GET /api/ops/confectioner-today
 * (см. ConfectionerTodayP05 в lifecycle-client-types) — новых fetch не нужно.
 *
 *   • NextActionBanner   — «Следующее действие» (самый ранний шаг плана);
 *   • CapacityCard       — «Ёмкость сегодня» (загрузка, окно работы);
 *   • ProductionPlanCard — «Производство сегодня» (таймлайн + «Начать»);
 *   • AttentionCard      — счётчики «Требует внимания»;
 *   • DraftEtaSetter     — ETA поставки черновика закупки
 *                          (PATCH /api/purchase-drafts/[id] {expectedEta}).
 *
 * Мутации: POST /api/orders/[id]/production/start, PATCH /api/purchase-drafts/[id]
 * (csrfFetch + Bearer + x-csrf-token — как в order-breakdown-dialog).
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, BellRing, CalendarClock, ClipboardList, Factory, Gauge,
  Loader2, MessageCircle, Package, Play,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { csrfFetch, getCsrfToken, getSessionAuthHeaders } from "@/lib/api-client";
import { EmptyState } from "@/components/dashboard/_shared";
import { ORDER_STATUS_LABELS } from "@/lib/finance";
import {
  type ConfectionerTodayP05,
  type TodayPlanEntry,
  type TodayPlanStage,
} from "@/lib/ops/lifecycle-client-types";

// ==================== Хелперы ====================

/** 150 → «2ч 30м», 45 → «45м», 0 → «0м». */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}м`;
  if (rest === 0) return `${h}ч`;
  return `${h}ч ${rest}м`;
}

/** 570 → «09:30». */
export function minuteToTime(minute: number): string {
  const m = Math.max(0, Math.floor(minute));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Обёртка в стиле SectionCard таба «Сегодня» (эмодзи/иконка + заголовок + счётчик). */
function P05Card({
  icon: Icon,
  title,
  count,
  className = "",
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  count?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={`p-4 min-w-0 ${className}`}>
      <h3 className="font-semibold mb-3 flex items-center gap-1.5 text-sm min-w-0">
        <Icon className="h-4 w-4 text-primary shrink-0" aria-hidden />
        <span className="truncate">{title}</span>
        {count && <span className="text-xs font-normal text-muted-foreground shrink-0">({count})</span>}
      </h3>
      {children}
    </Card>
  );
}

// ==================== Next action banner ====================

/** «Следующее действие» — первый (самый заметный) блок таба. */
export function NextActionBanner({
  nextAction,
  onOpenBreakdown,
}: {
  nextAction: ConfectionerTodayP05["nextAction"] | undefined;
  onOpenBreakdown: (orderId: string) => void;
}) {
  if (!nextAction) return null;
  return (
    <Card
      className="p-4 border-emerald-300 bg-emerald-50 min-w-0"
      role="region"
      aria-label="Следующее действие"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
          <Play className="h-5 w-5 text-emerald-700" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            Следующее действие
          </div>
          <p className="text-sm font-semibold leading-snug mt-0.5 break-words">{nextAction.action}</p>
        </div>
        <Button
          size="sm"
          className="min-h-[44px] sm:min-h-0 shrink-0"
          onClick={() => onOpenBreakdown(nextAction.orderId)}
        >
          <ClipboardList className="h-4 w-4 mr-1" />
          Открыть разбор
        </Button>
      </div>
    </Card>
  );
}

// ==================== Ёмкость сегодня ====================

type TodayCapacity = NonNullable<ConfectionerTodayP05["capacity"]>;

/** Цвет полосы загрузки: emerald <70%, amber <100%, red ≥100%. */
function utilizationTone(percent: number): { bar: string; text: string } {
  if (percent >= 100) return { bar: "[&>div]:bg-red-500", text: "text-red-700" };
  if (percent >= 70) return { bar: "[&>div]:bg-amber-500", text: "text-amber-700" };
  return { bar: "[&>div]:bg-emerald-500", text: "text-emerald-700" };
}

export function CapacityCard({
  capacity,
  className = "",
}: {
  capacity: TodayCapacity | null | undefined;
  className?: string;
}) {
  if (!capacity) return null;
  const percent = Math.min(999, Math.max(0, Math.round(capacity.utilizationPercent)));
  const tone = utilizationTone(percent);

  return (
    <P05Card icon={Gauge} title="Ёмкость сегодня" className={className}>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-2 min-w-0">
          <span className={`font-display text-2xl font-bold tabular-nums ${tone.text}`}>
            {percent}%
          </span>
          <span className="text-xs text-muted-foreground shrink-0">
            {capacity.isDefault ? "конфигурация по умолчанию" : "окно настроено"}
          </span>
        </div>
        <Progress
          value={Math.min(100, percent)}
          className={`h-2.5 ${tone.bar}`}
          aria-label={`Загрузка ёмкости ${percent}%`}
        />
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Доступно</div>
            <div className="font-semibold tabular-nums text-emerald-700">
              {formatMinutes(capacity.freeMinutes)}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Занято</div>
            <div className="font-semibold tabular-nums">
              {formatMinutes(capacity.busyMinutes)}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground min-w-0">
          <span className="flex items-center gap-1 shrink-0">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            Окно работы
          </span>
          <span className="tabular-nums truncate">
            {minuteToTime(capacity.workdayStartMinute)}–{minuteToTime(capacity.workdayEndMinute)}
          </span>
          {capacity.isDefault && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="text-[10px] font-normal cursor-help border-slate-200 text-slate-500 shrink-0"
                >
                  базовая конфигурация
                </Badge>
              </TooltipTrigger>
              <TooltipContent>настройте окно работы</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </P05Card>
  );
}

// ==================== Производство сегодня ====================

/** Бейдж риска: показываем только ORANGE/RED (GREEN/YELLOW — шум). */
function RiskBadge({ level }: { level: string | null }) {
  if (level === "RED") {
    return (
      <Badge variant="outline" className="text-[10px] border-red-200 bg-red-50 text-red-700">
        🔴 Критичный риск
      </Badge>
    );
  }
  if (level === "ORANGE") {
    return (
      <Badge variant="outline" className="text-[10px] border-amber-200 bg-amber-50 text-amber-700">
        ⚠ Риск
      </Badge>
    );
  }
  return null;
}

/** Полоски этапов чеклиста: выполнено → emerald, впереди → slate. */
function StageDots({ stages }: { stages: TodayPlanStage[] }) {
  const done = stages.filter((s) => s.isDone).length;
  if (stages.length === 0) return null;
  return (
    <div
      className="flex items-center gap-1 mt-1.5"
      role="img"
      aria-label={`Этапы: ${done} из ${stages.length} выполнено`}
    >
      {stages.map((st, idx) => (
        <span
          key={`${st.stageKey}-${idx}`}
          title={`${st.label}: ${st.startTime}–${st.endTime}${st.isDone ? " ✓" : ""}`}
          className={`h-1.5 w-4 rounded-full ${st.isDone ? "bg-emerald-400" : "bg-slate-200"}`}
        />
      ))}
      <span className="text-[10px] text-muted-foreground ml-0.5 tabular-nums shrink-0">
        {done}/{stages.length}
      </span>
    </div>
  );
}

function PlanRow({
  entry,
  busy,
  onStart,
  onOpenBreakdown,
}: {
  entry: TodayPlanEntry;
  busy: boolean;
  onStart: () => void;
  onOpenBreakdown: (orderId: string) => void;
}) {
  const canStart = entry.status === "CONFIRMED";
  const status = ORDER_STATUS_LABELS[entry.status] ?? { label: entry.status, color: "" };

  return (
    <div className="flex items-start gap-3 p-2.5 border border-border rounded-lg bg-card min-w-0">
      {/* Тайм-рейл: 09:30–12:30 + длительность */}
      <div className="shrink-0 w-16 text-right" aria-hidden>
        <div className="text-sm font-bold tabular-nums">{entry.startTime}</div>
        <div className="text-[10px] text-muted-foreground tabular-nums">– {entry.endTime}</div>
        <div className="text-[10px] text-muted-foreground">{formatMinutes(entry.estimatedMinutes)}</div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span className="text-sm font-semibold truncate">№ {entry.orderNumber}</span>
          <Badge variant="outline" className={`text-[10px] ${status.color}`}>
            {status.label}
          </Badge>
          <RiskBadge level={entry.riskLevel} />
        </div>
        {entry.nextStage && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            Следующий этап: {entry.nextStage}
          </div>
        )}
        <StageDots stages={entry.stages} />
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <Button
            size="sm"
            className="h-8 text-xs min-h-[44px] sm:min-h-0"
            disabled={!canStart || busy}
            title={canStart ? "Запустить производство" : "Производство доступно после подтверждения заказа"}
            onClick={onStart}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-1" />
            )}
            Начать
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs min-h-[44px] sm:min-h-0"
            onClick={() => onOpenBreakdown(entry.orderId)}
          >
            <ClipboardList className="h-3.5 w-3.5 mr-1" />
            Разбор
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ProductionPlanCard({
  plan,
  onOpenBreakdown,
  className = "",
}: {
  plan: TodayPlanEntry[];
  onOpenBreakdown: (orderId: string) => void;
  className?: string;
}) {
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: async (orderId: string): Promise<{ ok: boolean; status: string; startedAt: string }> => {
      const res = await csrfFetch(`/api/orders/${orderId}/production/start`, {
        method: "POST",
        headers: await getSessionAuthHeaders(await getCsrfToken()),
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
        throw new Error(err?.message || err?.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as { ok: boolean; status: string; startedAt: string };
    },
    onSuccess: (data) => {
      toast.success("Производство начато", {
        description: `Статус заказа: ${data.status}`,
      });
      void queryClient.invalidateQueries({ queryKey: ["ops-today"] });
    },
    onError: (error: Error) => {
      toast.error("Не удалось начать производство", { description: error.message });
    },
  });

  const isBusy = (orderId: string) => startMutation.isPending && startMutation.variables === orderId;

  return (
    <P05Card icon={Factory} title="Производство сегодня" count={String(plan.length)} className={className}>
      {plan.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Нет заказов в плане на сегодня"
          text="Резервы появятся, когда подтверждённые заказы получат слот производства"
        />
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {plan.map((entry) => (
            <PlanRow
              key={entry.orderId}
              entry={entry}
              busy={isBusy(entry.orderId)}
              onStart={() => startMutation.mutate(entry.orderId)}
              onOpenBreakdown={onOpenBreakdown}
            />
          ))}
        </div>
      )}
    </P05Card>
  );
}

// ==================== Требует внимания ====================

/** Три счётчика: риски / остатки / чаты. Оранжевый акцент при значении > 0. */
export function AttentionCard({
  attention,
  className = "",
}: {
  attention: ConfectionerTodayP05["attention"] | undefined;
  className?: string;
}) {
  const items: { icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; value: number; label: string }[] = [
    { icon: AlertTriangle, value: attention?.atRiskOrders ?? 0, label: "заказов под риском" },
    { icon: Package, value: attention?.lowStockItems ?? 0, label: "низкие остатки" },
    { icon: MessageCircle, value: attention?.unansweredChats ?? 0, label: "сообщения без ответа" },
  ];
  const hasAttention = items.some((i) => i.value > 0);

  return (
    <P05Card
      icon={BellRing}
      title="Требует внимания"
      className={`${className} ${hasAttention ? "border-amber-300 bg-amber-50/60" : ""}`}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {items.map((item) => {
          const active = item.value > 0;
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className={`flex items-center gap-2.5 rounded-lg border p-2.5 min-w-0 ${
                active ? "border-amber-200 bg-amber-50" : "border-border bg-card"
              }`}
            >
              <span
                className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
                  active ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"
                }`}
                aria-hidden
              >
                <Icon className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0">
                <div
                  className={`font-display text-lg font-bold leading-none tabular-nums ${
                    active ? "text-amber-700" : "text-muted-foreground"
                  }`}
                >
                  {item.value}
                </div>
                <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{item.label}</div>
              </div>
            </div>
          );
        })}
      </div>
    </P05Card>
  );
}

// ==================== ETA черновика закупки ====================

/**
 * Компактный сеттер ETA поставки для черновика закупки.
 * Пустой ввод + «Указать ETA» → expectedEta: null (сброс).
 */
export function DraftEtaSetter({ draftId }: { draftId: string }) {
  const [eta, setEta] = useState("");
  const queryClient = useQueryClient();

  const etaMutation = useMutation({
    mutationFn: async (): Promise<{ draft?: { id: string; expectedEta?: string | null } }> => {
      const parsed = eta ? new Date(eta) : null;
      if (eta && (!parsed || Number.isNaN(parsed.getTime()))) {
        throw new Error("Укажите корректные дату и время поставки");
      }
      const res = await csrfFetch(`/api/purchase-drafts/${draftId}`, {
        method: "PATCH",
        headers: await getSessionAuthHeaders(await getCsrfToken()),
        body: JSON.stringify({ expectedEta: parsed ? parsed.toISOString() : null }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
        throw new Error(err?.message || err?.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as { draft?: { id: string; expectedEta?: string | null } };
    },
    onSuccess: () => {
      toast.success(eta ? "ETA поставки указана" : "ETA поставки очищена");
      void queryClient.invalidateQueries({ queryKey: ["ops-today"] });
    },
    onError: (error: Error) => {
      toast.error("Не удалось сохранить ETA", { description: error.message });
    },
  });

  return (
    <div className="flex items-center gap-1.5 mt-2 min-w-0">
      <Input
        type="datetime-local"
        className="h-8 text-xs min-w-0 flex-1"
        value={eta}
        onChange={(e) => setEta(e.target.value)}
        aria-label="ETA поставки"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-xs shrink-0"
        disabled={etaMutation.isPending}
        onClick={() => etaMutation.mutate()}
      >
        {etaMutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
        ) : (
          <CalendarClock className="h-3.5 w-3.5 mr-1" />
        )}
        Указать ETA
      </Button>
    </div>
  );
}
