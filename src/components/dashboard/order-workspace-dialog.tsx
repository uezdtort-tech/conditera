"use client";

/**
 * order-workspace-dialog.tsx — единая «Рабочая область заказа» (Task 9-a, P0.5).
 *
 * Данные:
 *   • GET /api/orders/{id}/lifecycle — статусная модель, риск, дедлайны, мощность;
 *   • GET /api/orders/{id}/breakdown — состав заказа + дефицит склада;
 *   • GET /api/orders/{id}/timeline  — события заказа (domain_events + статусы).
 *
 * Действия (таб «Производство»):
 *   • POST /api/orders/{id}/production/start    — CONFIRMED → PREPARING;
 *   • POST /api/orders/{id}/production/complete — этапы отмечаются выполненными;
 *   • POST /api/orders/{id}/ready               — PREPARING → READY (QC/фото-гейт;
 *     422 → тост с message + detail из ответа);
 *   • POST /api/orders/{id}/handoff             — READY → IN_DELIVERY/DELIVERED
 *     (body { executor: "admin" });
 *   • POST /api/orders/{id}/complete            — DELIVERED → COMPLETED.
 *
 * Таб «Ингредиенты»: read-only разбор (badges ok/shortage/no_stock/unit_mismatch)
 * + POST /api/orders/{id}/purchase-draft (422 NO_SHORTAGES → toast.info).
 *
 * Палитра риска: GREEN→emerald, YELLOW→amber, ORANGE→orange, RED→red (без синего).
 * После каждой мутации инвалидируются ["order-lifecycle", id], ["order-timeline", id]
 * и ["ops-orders-today"].
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Circle,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Loader2,
  PackageCheck,
  PackageSearch,
  Play,
  RefreshCw,
  Truck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { csrfFetch, getCsrfToken, getSessionAuthHeaders } from "@/lib/api-client";
import {
  formatRub,
  type BreakdownIngredient,
  type OrderBreakdownResponse,
  type PurchaseDraftResponse,
} from "@/lib/ops-client-types";
import {
  type LifecycleResponse,
  type TimelineResponse,
} from "@/lib/ops/lifecycle-client-types";

// ==================== UI-словари ====================

type RiskLevel = LifecycleResponse["risk"]["level"];
type BusinessStatus = LifecycleResponse["derived"]["businessStatus"];
type ProductionStatus = LifecycleResponse["derived"]["productionStatus"];
type AssignmentStatus = LifecycleResponse["derived"]["assignmentStatus"];
type DeliveryStatus = LifecycleResponse["derived"]["deliveryStatus"];

/** Палитра уровня риска (без синего). */
export const RISK_LEVEL_UI: Record<RiskLevel, { label: string; badge: string }> = {
  GREEN: { label: "В норме", badge: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  YELLOW: { label: "Внимание", badge: "border-amber-200 bg-amber-50 text-amber-700" },
  ORANGE: { label: "Под риском", badge: "border-orange-200 bg-orange-50 text-orange-700" },
  RED: { label: "Критично", badge: "border-red-200 bg-red-50 text-red-700" },
};

const BUSINESS_STATUS_UI: Record<BusinessStatus, { label: string; badge: string }> = {
  created: { label: "Создан", badge: "border-slate-200 bg-slate-50 text-slate-700" },
  confirmed: { label: "Подтверждён", badge: "border-amber-200 bg-amber-50 text-amber-700" },
  in_production: { label: "В производстве", badge: "border-orange-200 bg-orange-50 text-orange-700" },
  ready: { label: "Готов", badge: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  completed: { label: "Завершён", badge: "border-emerald-300 bg-emerald-100 text-emerald-800" },
  cancelled: { label: "Отменён", badge: "border-red-200 bg-red-50 text-red-700" },
};

const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  not_started: "Не начато",
  planned: "Запланировано",
  in_production: "В производстве",
  quality_check: "Контроль качества",
  ready: "Готово",
};

const ASSIGNMENT_STATUS_UI: Record<AssignmentStatus, { label: string; badge: string }> = {
  unassigned: { label: "Не назначен", badge: "border-slate-200 bg-slate-50 text-slate-600" },
  assigned: { label: "Назначен", badge: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  reassignment_required: { label: "Требуется переназначение", badge: "border-red-200 bg-red-50 text-red-700" },
};

const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  not_ready: "К выдаче не готов",
  ready_for_handoff: "Готов к передаче",
  handed_off: "Передан",
  in_delivery: "В доставке",
  delivered: "Доставлен",
};

function paymentStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case "paid":
      return "Оплачен";
    case "escrow":
      return "Эскроу";
    case "pending":
    case "unpaid":
      return "Не оплачен";
    case "refunded":
      return "Возврат";
    case "failed":
      return "Ошибка оплаты";
    default:
      return status;
  }
}

function paymentStatusBadge(status: string): string {
  const s = status.toLowerCase();
  if (s === "paid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (s === "escrow") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function deliveryTypeLabel(t: string | null): string {
  switch (t) {
    case "delivery":
      return "Доставка";
    case "pickup":
      return "Самовывоз";
    default:
      return t || "—";
  }
}

// ==================== Форматтеры ====================

/** "YYYY-MM-DD…" → "DD.MM.YYYY" (без Date — нет TZ-сдвигов). */
function formatDateRu(dateStr: string | null): string {
  if (!dateStr) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : dateStr;
}

/** ISO datetime → "DD.MM HH:MM". */
function formatDateTimeShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** ISO datetime → "HH:MM DD.MM" (для таймлайна). */
function formatTimelineTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} ${d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}`;
}

/** Минуты → "45 мин" / "2 ч 30 мин". */
function formatMinutes(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} мин`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

/** Минута дня → "HH:MM". */
function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ==================== Ошибки API ====================

interface ApiErrorBody {
  error?: string;
  message?: string;
  detail?: unknown;
}

function formatErrorDetail(detail: unknown): string {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  if (typeof detail === "number" || typeof detail === "boolean") return String(detail);
  try {
    return JSON.stringify(detail);
  } catch {
    return "";
  }
}

/** message + detail из ответа API (для 422-гейтов ready и пр.). */
function parseApiError(body: ApiErrorBody | null, fallback: string): string {
  if (!body) return fallback;
  const base = body.message || body.error || fallback;
  const detail = formatErrorDetail(body.detail);
  return detail ? `${base} (детали: ${detail})` : base;
}

async function readErrorBody(res: Response): Promise<ApiErrorBody | null> {
  return (await res.json().catch(() => null)) as ApiErrorBody | null;
}

// ==================== Статус ингредиента (переиспользование Task 3-D) ====================

function IngredientStatusBadge({ ing }: { ing: BreakdownIngredient }) {
  switch (ing.status) {
    case "ok":
      return (
        <Badge variant="outline" className="text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700">
          В наличии
        </Badge>
      );
    case "shortage":
      return (
        <Badge variant="outline" className="text-[10px] border-red-200 bg-red-50 text-red-700">
          Не хватает {Math.round(Math.max(0, ing.required - ing.stock) * 100) / 100} {ing.unit}
        </Badge>
      );
    case "no_stock":
      return (
        <Badge variant="outline" className="text-[10px] border-amber-200 bg-amber-50 text-amber-700">
          Нет на складе
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-600">
          Ед. изм. не совпадает
        </Badge>
      );
  }
}

// ==================== Действия производства ====================

type OrderActionKind =
  | "production-start"
  | "production-complete"
  | "ready"
  | "handoff"
  | "complete";

const ORDER_ACTIONS: Record<OrderActionKind, { path: string; body?: Record<string, unknown> }> = {
  "production-start": { path: "production/start" },
  "production-complete": { path: "production/complete" },
  ready: { path: "ready" },
  handoff: { path: "handoff", body: { executor: "admin" } },
  complete: { path: "complete" },
};

const ACTION_SUCCESS: Record<OrderActionKind, string> = {
  "production-start": "Производство начато",
  "production-complete": "Этапы производства отмечены выполненными",
  ready: "Заказ отмечен готовым",
  handoff: "Передача подтверждена",
  complete: "Заказ завершён",
};

// ==================== Основной компонент ====================

export function OrderWorkspaceDialog({
  orderId,
  open,
  onOpenChange,
}: {
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const lifecycleQuery = useQuery({
    queryKey: ["order-lifecycle", orderId],
    enabled: open && !!orderId,
    queryFn: async (): Promise<LifecycleResponse> => {
      const res = await csrfFetch(`/api/orders/${orderId}/lifecycle`);
      if (!res.ok) {
        throw new Error(parseApiError(await readErrorBody(res), `Не удалось загрузить жизненный цикл (HTTP ${res.status})`));
      }
      return (await res.json()) as LifecycleResponse;
    },
  });

  const breakdownQuery = useQuery({
    queryKey: ["order-breakdown", orderId],
    enabled: open && !!orderId,
    queryFn: async (): Promise<OrderBreakdownResponse> => {
      const res = await csrfFetch(`/api/orders/${orderId}/breakdown`);
      if (!res.ok) throw new Error(`Не удалось разобрать заказ (HTTP ${res.status})`);
      return (await res.json()) as OrderBreakdownResponse;
    },
  });

  const timelineQuery = useQuery({
    queryKey: ["order-timeline", orderId],
    enabled: open && !!orderId,
    queryFn: async (): Promise<TimelineResponse> => {
      const res = await csrfFetch(`/api/orders/${orderId}/timeline`);
      if (!res.ok) throw new Error(`Не удалось загрузить события (HTTP ${res.status})`);
      return (await res.json()) as TimelineResponse;
    },
  });

  /** Общая мутация производственных действий; после успеха — инвалидация контуров. */
  const actionMutation = useMutation({
    mutationFn: async (kind: OrderActionKind) => {
      const def = ORDER_ACTIONS[kind];
      const res = await csrfFetch(`/api/orders/${orderId}/${def.path}`, {
        method: "POST",
        headers: await getSessionAuthHeaders(await getCsrfToken()),
        body: JSON.stringify(def.body ?? {}),
      });
      if (!res.ok) {
        throw new Error(parseApiError(await readErrorBody(res), `HTTP ${res.status}`));
      }
      return (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string };
    },
    onSuccess: (_data, kind) => {
      toast.success(ACTION_SUCCESS[kind]);
      void queryClient.invalidateQueries({ queryKey: ["order-lifecycle", orderId] });
      void queryClient.invalidateQueries({ queryKey: ["order-timeline", orderId] });
      void queryClient.invalidateQueries({ queryKey: ["ops-orders-today"] });
    },
    onError: (error: Error) => {
      toast.error("Действие не выполнено", { description: error.message });
    },
  });

  /** Черновик закупки из дефицита (422 NO_SHORTAGES → toast.info). */
  const createDraftMutation = useMutation({
    mutationFn: async (): Promise<PurchaseDraftResponse> => {
      const res = await csrfFetch(`/api/orders/${orderId}/purchase-draft`, {
        method: "POST",
        headers: await getSessionAuthHeaders(await getCsrfToken()),
        body: JSON.stringify({}),
      });
      if (res.status === 422) {
        const err = await readErrorBody(res);
        if (err?.error === "NO_SHORTAGES") throw new Error("Нет дефицита — закупка не требуется");
        throw new Error(parseApiError(err, "Невозможно создать черновик закупки"));
      }
      if (!res.ok) throw new Error(parseApiError(await readErrorBody(res), `HTTP ${res.status}`));
      return (await res.json()) as PurchaseDraftResponse;
    },
    onSuccess: (data) => {
      toast.success("Черновик закупки создан", {
        description: `Статус: ${data.draft.status} — смотрите список закупок`,
      });
      void queryClient.invalidateQueries({ queryKey: ["order-breakdown", orderId] });
      void queryClient.invalidateQueries({ queryKey: ["ops-orders-today"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-today"] });
    },
    onError: (error: Error) => {
      if (error.message.includes("Нет дефицита")) {
        toast.info("Закупка не требуется", { description: error.message });
      } else {
        toast.error("Не удалось создать черновик закупки", { description: error.message });
      }
    },
  });

  const lc = lifecycleQuery.data;
  const derived = lc?.derived;
  const bs = derived?.businessStatus;
  const ds = derived?.deliveryStatus;
  const isActionBusy = (kind: OrderActionKind) =>
    actionMutation.isPending && actionMutation.variables === kind;

  interface ActionDef {
    kind: OrderActionKind;
    label: string;
    icon: LucideIcon;
    enabled: boolean;
    hint: string;
  }

  const actions: ActionDef[] = [
    {
      kind: "production-start",
      label: "Начать производство",
      icon: Play,
      enabled: bs === "confirmed",
      hint: "Доступно для подтверждённых заказов (CONFIRMED)",
    },
    {
      kind: "production-complete",
      label: "Завершить этапы",
      icon: ListChecks,
      enabled: bs === "in_production",
      hint: "Доступно в статусе «В производстве» (PREPARING)",
    },
    {
      kind: "ready",
      label: "Отметить готов",
      icon: PackageCheck,
      enabled: bs === "in_production",
      hint: "Требует завершённого чеклиста и фото готовности (если категория требует)",
    },
    {
      kind: "handoff",
      label: "Передать (курьер/клиент)",
      icon: Truck,
      enabled: bs === "ready",
      hint: "Доступно в статусе «Готов» (READY)",
    },
    {
      kind: "complete",
      label: "Завершить заказ",
      icon: CheckCircle2,
      enabled: ds === "delivered",
      hint: "Доступно после передачи заказа (DELIVERED)",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap pr-6">
            <LayoutDashboard className="h-5 w-5 text-primary" />
            Рабочая область{lc?.order.number ? ` — заказ № ${lc.order.number}` : ""}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Выдача: {formatDateRu(lc?.order.delivery_date ?? null)}</span>
            {lc?.order.delivery_time_window && <span>Окно: {lc.order.delivery_time_window}</span>}
            {lc && <span className="font-medium text-foreground">{formatRub(lc.order.total)}</span>}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="overview" className="gap-3">
          <TabsList className="w-full max-w-full overflow-x-auto sm:w-auto">
            <TabsTrigger value="overview" className="text-xs sm:text-sm">Обзор</TabsTrigger>
            <TabsTrigger value="production" className="text-xs sm:text-sm">Производство</TabsTrigger>
            <TabsTrigger value="ingredients" className="text-xs sm:text-sm">Ингредиенты</TabsTrigger>
            <TabsTrigger value="events" className="text-xs sm:text-sm">События</TabsTrigger>
          </TabsList>

          {/* ==================== ОБЗОР ==================== */}
          <TabsContent value="overview" className="space-y-3 mt-1">
            {lifecycleQuery.isLoading ? (
              <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">Загружаем жизненный цикл заказа...</p>
              </div>
            ) : lifecycleQuery.error ? (
              <QueryErrorBlock
                message={(lifecycleQuery.error as Error).message}
                onRetry={() => void lifecycleQuery.refetch()}
              />
            ) : lc && derived ? (
              <div className="space-y-3">
                {/* Следующее действие — самое заметное */}
                <div className="flex items-center gap-2.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <Zap className="h-5 w-5 text-primary shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Следующее действие</div>
                    <div className="text-sm font-semibold truncate">{lc.nextAction.label}</div>
                  </div>
                </div>

                {/* Статусы */}
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className={`text-[10px] ${BUSINESS_STATUS_UI[derived.businessStatus].badge}`}>
                    {BUSINESS_STATUS_UI[derived.businessStatus].label}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-600">
                    Производство: {PRODUCTION_STATUS_LABELS[derived.productionStatus]}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] ${ASSIGNMENT_STATUS_UI[derived.assignmentStatus].badge}`}>
                    {ASSIGNMENT_STATUS_UI[derived.assignmentStatus].label}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-600">
                    Выдача: {DELIVERY_STATUS_LABELS[derived.deliveryStatus]}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] ${paymentStatusBadge(lc.order.payment_status)}`}>
                    {paymentStatusLabel(lc.order.payment_status)}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-600">
                    {deliveryTypeLabel(lc.order.delivery_type)}
                  </Badge>
                </div>

                {/* Участники + сумма + выдача */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <InfoTile label="Кондитер" value={lc.order.confectioner_name || "Не назначен"} />
                  <InfoTile label="Клиент" value={lc.order.customer_id} mono />
                  <InfoTile label="Сумма" value={formatRub(lc.order.total)} />
                  <InfoTile
                    label="Выдача"
                    value={`${formatDateRu(lc.order.delivery_date)}${lc.order.delivery_time_window ? ` · ${lc.order.delivery_time_window}` : lc.order.delivery_time ? ` · ${lc.order.delivery_time}` : ""}`}
                  />
                </div>

                {/* Дедлайны */}
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="text-xs font-semibold flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                    Дедлайны производства
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                    <div>
                      <div className="text-[11px] text-muted-foreground">Готовность к</div>
                      <div className="font-medium tabular-nums">{formatDateTimeShort(lc.deadline.deadlineAt)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">Безопасный старт</div>
                      <div className="font-medium tabular-nums">{formatDateTimeShort(lc.deadline.latestSafeStartAt)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">Оценка производства</div>
                      <div className="font-medium flex items-center gap-1.5 flex-wrap">
                        {formatMinutes(lc.deadline.productionMinutes)}
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            lc.deadline.estimateApproximate
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-slate-200 text-slate-600"
                          }`}
                        >
                          {lc.deadline.estimateApproximate ? "оценка" : "конфиг"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Риск */}
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-xs font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                      Риск
                    </div>
                    <Badge variant="outline" className={`text-[10px] ${RISK_LEVEL_UI[lc.risk.level].badge}`}>
                      {RISK_LEVEL_UI[lc.risk.level].label}
                    </Badge>
                  </div>
                  {lc.risk.reasons.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Причин риска нет — заказ в графике.</p>
                  ) : (
                    <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                      {lc.risk.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                  {lc.risk.marginMinutes != null && (
                    <p className="text-[11px] text-muted-foreground">
                      Запас до дедлайна: {formatMinutes(lc.risk.marginMinutes)}
                    </p>
                  )}
                </div>

                {/* Мощность */}
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-xs font-semibold flex items-center gap-1.5">
                      <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                      Мощность кондитера
                    </div>
                    {lc.capacity && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          lc.capacity.utilizationPercent >= 90
                            ? "border-red-200 bg-red-50 text-red-700"
                            : lc.capacity.utilizationPercent >= 70
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {Math.round(lc.capacity.utilizationPercent)}% загрузки
                      </Badge>
                    )}
                  </div>
                  {lc.capacity ? (
                    <>
                      <Progress
                        value={Math.min(100, Math.max(0, lc.capacity.utilizationPercent))}
                        aria-label="Загрузка мощности кондитера"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Занято {formatMinutes(lc.capacity.busyMinutes)} · свободно {formatMinutes(lc.capacity.freeMinutes)}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">Нет данных о мощности (кондитер не назначен или окно не рассчитано).</p>
                  )}
                </div>

                {/* Резерв производства */}
                {lc.reservation && (
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-xs font-semibold mb-1">Резерв производства</div>
                    <div className="text-sm flex items-center gap-2 flex-wrap">
                      <span className="tabular-nums">
                        {formatDateRu(lc.reservation.date)} · {minutesToHHMM(lc.reservation.startMinute)}–{minutesToHHMM(lc.reservation.endMinute)}
                      </span>
                      <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-600">
                        {lc.reservation.status}
                      </Badge>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </TabsContent>

          {/* ==================== ПРОИЗВОДСТВО ==================== */}
          <TabsContent value="production" className="space-y-3 mt-1">
            {lifecycleQuery.isLoading || lifecycleQuery.error ? (
              lifecycleQuery.isLoading ? (
                <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <p className="text-sm">Загружаем чеклист производства...</p>
                </div>
              ) : (
                <QueryErrorBlock
                  message={(lifecycleQuery.error as Error).message}
                  onRetry={() => void lifecycleQuery.refetch()}
                />
              )
            ) : lc ? (
              <div className="space-y-3">
                {/* Факты производства */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Старт: {lc.production.startedAt ? formatDateTimeShort(lc.production.startedAt) : "—"}</span>
                  <span>Завершение: {lc.production.completedAt ? formatDateTimeShort(lc.production.completedAt) : "—"}</span>
                  {lc.production.readyPhotoRequired && (
                    <Badge variant="outline" className="text-[10px] border-amber-200 bg-amber-50 text-amber-700">
                      Требуется фото готовности
                    </Badge>
                  )}
                  {lc.production.checklistComplete && (
                    <Badge variant="outline" className="text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700">
                      Чеклист завершён
                    </Badge>
                  )}
                </div>

                {/* Чеклист этапов (read-only) */}
                <div className="rounded-lg border border-border max-h-64 overflow-y-auto">
                  {lc.production.checklist.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      <PackageSearch className="h-5 w-5 mx-auto mb-1" />
                      Чеклист ещё не сформирован — он появится после начала производства
                    </div>
                  ) : (
                    <ul className="divide-y divide-border">
                      {lc.production.checklist.map((stage) => (
                        <li key={stage.id} className="flex items-center gap-2.5 px-3 py-2.5">
                          {stage.is_done ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-label="Этап выполнен" />
                          ) : (
                            <Circle className="h-4 w-4 text-muted-foreground/50 shrink-0" aria-label="Этап не выполнен" />
                          )}
                          <span className={`text-sm min-w-0 truncate ${stage.is_done ? "text-muted-foreground line-through" : ""}`}>
                            {stage.label}
                          </span>
                          {stage.is_done && stage.done_at && (
                            <span className="ml-auto text-[10px] text-muted-foreground shrink-0 tabular-nums">
                              {formatDateTimeShort(stage.done_at)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Действия */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {actions.map((a) => {
                    const Icon = a.icon;
                    const busy = isActionBusy(a.kind);
                    return (
                      <Button
                        key={a.kind}
                        type="button"
                        variant={a.enabled ? "default" : "outline"}
                        disabled={!a.enabled || actionMutation.isPending}
                        title={a.hint}
                        className="min-h-[44px] sm:min-h-0 justify-start"
                        onClick={() => actionMutation.mutate(a.kind)}
                      >
                        {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Icon className="h-4 w-4 mr-1.5" />}
                        <span className="min-w-0 truncate">{a.label}</span>
                      </Button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Кнопки активны, когда статус заказа соответствует переходу. Наведите на кнопку, чтобы увидеть условие.
                </p>
              </div>
            ) : null}
          </TabsContent>

          {/* ==================== ИНГРЕДИЕНТЫ ==================== */}
          <TabsContent value="ingredients" className="space-y-3 mt-1">
            {breakdownQuery.isLoading ? (
              <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">Разбираем заказ по ингредиентам...</p>
              </div>
            ) : breakdownQuery.error ? (
              <QueryErrorBlock
                message={(breakdownQuery.error as Error).message}
                onRetry={() => void breakdownQuery.refetch()}
              />
            ) : breakdownQuery.data ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {breakdownQuery.data.can_produce ? (
                    <Badge variant="outline" className="text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700">
                      Можно производить
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] border-red-200 bg-red-50 text-red-700">
                      Дефицит {breakdownQuery.data.shortages.length} поз. (≈{formatRub(breakdownQuery.data.total_shortage_cost)})
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {breakdownQuery.data.items.map((it, idx) => (
                    <Badge key={`${it.product_id}-${idx}`} variant="secondary" className="text-[11px] font-normal">
                      {it.title} × {it.quantity}
                    </Badge>
                  ))}
                </div>

                <div className="rounded-lg border border-border max-h-80 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ингредиент</TableHead>
                        <TableHead className="text-right">Нужно</TableHead>
                        <TableHead className="text-right">На складе</TableHead>
                        <TableHead>Статус</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {breakdownQuery.data.ingredients.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                            <PackageSearch className="h-5 w-5 mx-auto mb-1" />
                            Рецепт не привязан или состав пуст — ингредиенты не определены
                          </TableCell>
                        </TableRow>
                      ) : (
                        breakdownQuery.data.ingredients.map((ing, idx) => (
                          <TableRow key={`${ing.name}-${idx}`}>
                            <TableCell className="font-medium text-sm">{ing.name}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              {Math.round(ing.required * 100) / 100} {ing.unit}
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              {Math.round(ing.stock * 100) / 100} {ing.unit}
                            </TableCell>
                            <TableCell>
                              <IngredientStatusBadge ing={ing} />
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  disabled={createDraftMutation.isPending}
                  onClick={() => createDraftMutation.mutate()}
                  className="min-h-[44px] sm:min-h-0"
                >
                  {createDraftMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <ClipboardList className="h-4 w-4 mr-1.5" />
                  )}
                  Создать закупку из дефицита
                </Button>
              </div>
            ) : null}
          </TabsContent>

          {/* ==================== СОБЫТИЯ ==================== */}
          <TabsContent value="events" className="mt-1">
            {timelineQuery.isLoading ? (
              <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">Загружаем события заказа...</p>
              </div>
            ) : timelineQuery.error ? (
              <QueryErrorBlock
                message={(timelineQuery.error as Error).message}
                onRetry={() => void timelineQuery.refetch()}
              />
            ) : timelineQuery.data ? (
              timelineQuery.data.timeline.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Событий пока нет — история появится после первых переходов
                </div>
              ) : (
                <div className="relative max-h-[22rem] overflow-y-auto pr-1">
                  <div className="ml-2 border-l-2 border-border space-y-3.5 py-1">
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
                          <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-600">
                            {item.kind === "status" ? "статус" : "событие"}
                          </Badge>
                        </div>
                        <div className="text-sm mt-0.5">{item.title}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            ) : null}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ==================== Вспомогательные блоки ====================

function InfoTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-2.5 min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium truncate ${mono ? "font-mono text-xs" : ""}`} title={value}>
        {value}
      </div>
    </div>
  );
}

function QueryErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="py-8 text-center space-y-3">
      <p className="text-sm text-destructive">{message || "Ошибка загрузки данных"}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-4 w-4 mr-1" />
        Повторить
      </Button>
    </div>
  );
}

// ==================== Кнопка-обёртка для карточек ====================

/**
 * OrderWorkspaceButton — кнопка «Рабочая область» с собственным состоянием
 * диалога: встраивается в карточки заказов (Control Tower, таб «Заказы»).
 */
export function OrderWorkspaceButton({
  orderId,
  label,
}: {
  orderId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="min-h-[44px] sm:min-h-0"
        onClick={() => setOpen(true)}
      >
        <LayoutDashboard className="h-3.5 w-3.5 mr-1" />
        <span className="min-w-0 truncate">{label ?? "Рабочая область"}</span>
      </Button>
      <OrderWorkspaceDialog orderId={orderId} open={open} onOpenChange={setOpen} />
    </>
  );
}
