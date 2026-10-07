"use client";

/**
 * confectioner-today-tab.tsx — таб «Сегодня» кондитера (Task 3-C, P0.5 §31 — Task 9-b).
 *
 * Данные: GET /api/ops/confectioner-today (refetch 60с) — bento-компоновка:
 *   • ⏭ Следующее действие (P0.5, banner);
 *   • 🔴 Требуют действия (severity-счётчики + топ-5 задач, resolve/dismiss);
 *   • 🟠 Заказы сегодня (+ кнопка «Разбор» → OrderBreakdownDialog);
 *   • 🟢 В производстве;
 *   • 🏭 Производство сегодня + 📊 Ёмкость сегодня (P0.5);
 *   • 📦 Нужно докупить (низкие остатки + черновики закупок + ETA поставки);
 *   • 🔔 Требует внимания (P0.5); 💬 Сообщения; 💰 Выручка сегодня.
 *
 * P0.5-поля (capacity/productionPlan/nextAction/attention) приходят в ТОМ ЖЕ
 * ответе — новые fetch не нужны, см. confectioner-p05-cards.tsx.
 */

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ConfectionerTodayP05 } from "@/lib/ops/lifecycle-client-types";
import {
  AttentionCard, CapacityCard, DraftEtaSetter, NextActionBanner, ProductionPlanCard,
} from "@/components/dashboard/confectioner-p05-cards";
import {
  AlertTriangle, BellOff, CheckCircle2, ChefHat, ClipboardList, Coins,
  Loader2, MessageSquare, Package, RefreshCw, ShoppingBag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { EmptyState, StatCard } from "@/components/dashboard/_shared";
import { csrfFetch } from "@/lib/api-client";
import { useOpsTaskAction } from "@/lib/use-ops-task-actions";
import { ORDER_STATUS_LABELS } from "@/lib/finance";
import {
  SEVERITY_UI, extractPayloadInfo, formatRub, purchaseDraftSourceLabel,
  type ConfectionerTodayOrder, type ConfectionerTodayResponse,
  type OpsSeverity, type OpsTask,
} from "@/lib/ops-client-types";

/** P0.5-дополнения опциональны: capacity/nextAction — null, остальные могут отсутствовать. */
type ConfectionerTodayResponseP05 = ConfectionerTodayResponse & Partial<ConfectionerTodayP05>;

async function fetchConfectionerToday(): Promise<ConfectionerTodayResponseP05> {
  const res = await csrfFetch("/api/ops/confectioner-today");
  if (!res.ok) throw new Error(`Не удалось загрузить данные дня (HTTP ${res.status})`);
  return (await res.json()) as ConfectionerTodayResponseP05;
}

function orderTime(o: ConfectionerTodayOrder): string {
  return o.delivery_time_window || o.delivery_time || "—";
}

function OrderRow({
  order,
  showBreakdown,
  onOpenBreakdown,
}: {
  order: ConfectionerTodayOrder;
  showBreakdown?: boolean;
  onOpenBreakdown?: (orderId: string) => void;
}) {
  const status = ORDER_STATUS_LABELS[order.status] ?? { label: order.status, color: "" };
  return (
    <div className="flex items-start gap-3 p-2.5 border border-border rounded-lg">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{order.number}</span>
          <Badge variant="outline" className={`text-[10px] ${status.color}`}>{status.label}</Badge>
          <Badge variant="secondary" className="text-[10px]">🕐 {orderTime(order)}</Badge>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 truncate">
          {order.product_titles?.slice(0, 3).join(" • ")}
          {order.items_count > 3 ? ` +${order.items_count - 3}` : ""}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-bold tabular-nums">{formatRub(order.total)}</div>
        {showBreakdown && onOpenBreakdown && (
          <Button
            size="sm"
            variant="outline"
            className="mt-1 h-8 text-xs"
            onClick={() => onOpenBreakdown(order.id)}
          >
            <ClipboardList className="h-3.5 w-3.5 mr-1" />
            Разбор
          </Button>
        )}
      </div>
    </div>
  );
}

/** Компактная карточка задачи (топ-5). */
function TaskRow({
  task,
  busy,
  onNavigateTab,
  onResolve,
  onDismiss,
}: {
  task: OpsTask;
  busy: boolean;
  onNavigateTab?: (tab: string) => void;
  onResolve: () => void;
  onDismiss: () => void;
}) {
  const sev = SEVERITY_UI[(task.severity as OpsSeverity) ?? "info"] ?? SEVERITY_UI.info;
  const payload = extractPayloadInfo(task.payload);
  const isDashboardLink =
    typeof task.action_url === "string" && task.action_url.startsWith("/dashboard?tab=");

  const handlePrimary = () => {
    if (isDashboardLink && onNavigateTab) {
      const tab = new URLSearchParams(task.action_url!.split("?")[1]).get("tab");
      if (tab) {
        onNavigateTab(tab);
        return;
      }
    }
    onResolve();
  };

  return (
    <div className="flex items-start gap-2.5 p-2.5 border border-border rounded-lg bg-card">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sev.dot}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-snug">{task.title}</div>
        {task.description && (
          <div className="text-xs text-muted-foreground mt-0.5">{task.description}</div>
        )}
        {(payload.total != null || payload.orderNumber) && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {payload.orderNumber && (
              <Badge variant="secondary" className="text-[10px]">Заказ {payload.orderNumber}</Badge>
            )}
            {payload.total != null && (
              <Badge variant="secondary" className="text-[10px]">{formatRub(payload.total)}</Badge>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {task.action_label && (
            <Button size="sm" className="h-8 text-xs min-h-[44px] sm:min-h-0" disabled={busy} onClick={handlePrimary}>
              {task.action_label}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs min-h-[44px] sm:min-h-0 text-emerald-700 border-emerald-300"
            disabled={busy}
            onClick={onResolve}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            Готово
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs min-h-[44px] sm:min-h-0 text-muted-foreground"
            disabled={busy}
            onClick={onDismiss}
          >
            <BellOff className="h-3.5 w-3.5 mr-1" />
            Скрыть
          </Button>
        </div>
      </div>
    </div>
  );
}

function SectionCard({
  emoji,
  title,
  count,
  children,
  className = "",
}: {
  emoji: string;
  title: string;
  count?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`p-4 ${className}`}>
      <h3 className="font-semibold mb-3 flex items-center gap-1.5 text-sm">
        <span aria-hidden>{emoji}</span> {title}
        {count && <span className="text-xs font-normal text-muted-foreground">({count})</span>}
      </h3>
      {children}
    </Card>
  );
}

export function ConfectionerTodayTab({
  onNavigateTab,
  onOpenBreakdown,
}: {
  onNavigateTab?: (tab: string) => void;
  onOpenBreakdown: (orderId: string) => void;
}) {
  const todayQuery = useQuery({
    queryKey: ["ops-today"],
    queryFn: fetchConfectionerToday,
    refetchInterval: 60_000,
  });

  const actionMutation = useOpsTaskAction([["ops-today"], ["ops-tasks"]]);
  const isBusy = (id: string) => actionMutation.isPending && actionMutation.variables?.id === id;

  const data = todayQuery.data;
  const taskCounts = data?.tasks?.counts ?? { critical: 0, important: 0, info: 0 };
  const tasksTotal = taskCounts.critical + taskCounts.important + taskCounts.info;
  const hasAutoDraft = (data?.purchaseDrafts ?? []).some((d) => d.source === "low_stock_auto");

  const handleCreatePurchase = () => {
    if (hasAutoDraft) {
      toast.info("Черновик уже создан автоматически — см. Закупки");
      return;
    }
    toast.info("Черновики закупок создаются автоматически при низких остатках или из разбора заказа (кнопка «Разбор»)");
  };

  const todayLabel = new Date().toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="font-display text-2xl font-bold capitalize">
          Производственный центр — {todayLabel}
        </h1>
        <div className="flex items-center gap-2">
          {todayQuery.isFetching && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Обновление" />
          )}
          <Button size="sm" variant="outline" onClick={() => void todayQuery.refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Обновить
          </Button>
        </div>
      </div>

      {todayQuery.isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-24 bg-muted/50 rounded-lg animate-pulse" />
            ))}
          </div>
          <div className="h-48 bg-muted/50 rounded-lg animate-pulse" />
        </div>
      ) : todayQuery.error ? (
        <Card className="p-8 text-center border-destructive/30 bg-destructive/5">
          <p className="text-sm text-destructive mb-3">
            {(todayQuery.error as Error).message || "Не удалось загрузить данные дня"}
          </p>
          <Button variant="outline" size="sm" onClick={() => void todayQuery.refetch()}>
            Повторить
          </Button>
        </Card>
      ) : !data ? null : (
        <>
          {/* P0.5: Следующее действие — первый, самый заметный блок таба */}
          <NextActionBanner nextAction={data.nextAction} onOpenBreakdown={onOpenBreakdown} />

          {/* Стат-строка */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard icon={AlertTriangle} label="Требуют действий" value={String(tasksTotal)} color="text-red-600 bg-red-100" />
            <StatCard icon={ShoppingBag} label="Заказы сегодня" value={String(data.ordersToday?.length ?? 0)} color="text-amber-600 bg-amber-100" />
            <StatCard icon={ChefHat} label="В производстве" value={String(data.inProduction?.length ?? 0)} color="text-emerald-600 bg-emerald-100" />
            <StatCard icon={Coins} label="Выручка сегодня" value={formatRub(data.revenueToday ?? 0)} color="text-emerald-700 bg-emerald-100" />
            <StatCard icon={MessageSquare} label="Сообщения" value={String(data.messagesUnread ?? 0)} color="text-purple-600 bg-purple-100" />
          </div>

          <div className="grid grid-cols-1 min-w-0 lg:grid-cols-3 gap-4">
            {/* Требуют действия */}
            <SectionCard
              emoji="🔴"
              title="Требуют действия"
              count={`${taskCounts.critical}/${taskCounts.important}/${taskCounts.info}`}
              className="lg:col-span-3"
            >
              {(data.tasks?.items?.length ?? 0) === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="Все задачи обработаны"
                  text="Операционная очередь пуста — можно заняться производством"
                />
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {data.tasks.items.slice(0, 5).map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      busy={isBusy(t.id)}
                      onNavigateTab={onNavigateTab}
                      onResolve={() => actionMutation.mutate({ id: t.id, action: "resolve" })}
                      onDismiss={() => actionMutation.mutate({ id: t.id, action: "dismiss" })}
                    />
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Заказы сегодня */}
            <SectionCard
              emoji="🟠"
              title="Заказы сегодня"
              count={String(data.ordersToday?.length ?? 0)}
              className="lg:col-span-2"
            >
              {(data.ordersToday?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Заказов на сегодня нет
                </p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {data.ordersToday.map((o) => (
                    <OrderRow key={o.id} order={o} showBreakdown onOpenBreakdown={onOpenBreakdown} />
                  ))}
                </div>
              )}
            </SectionCard>

            {/* В производстве */}
            <SectionCard emoji="🟢" title="В производстве" count={String(data.inProduction?.length ?? 0)}>
              {(data.inProduction?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Ничего не готовится — самое время принять новые заказы
                </p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {data.inProduction.map((o) => (
                    <OrderRow key={o.id} order={o} showBreakdown onOpenBreakdown={onOpenBreakdown} />
                  ))}
                </div>
              )}
            </SectionCard>

            {/* P0.5: Производство сегодня (план) + Ёмкость сегодня */}
            <ProductionPlanCard
              plan={data.productionPlan ?? []}
              onOpenBreakdown={onOpenBreakdown}
              className="lg:col-span-2"
            />
            <CapacityCard capacity={data.capacity} />

            {/* Нужно докупить */}
            <SectionCard
              emoji="📦"
              title="Нужно докупить"
              count={String(data.lowStock?.length ?? 0)}
              className="lg:col-span-2"
            >
              {(data.lowStock?.length ?? 0) === 0 && (data.purchaseDrafts?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Запасы в норме — докупать ничего не нужно
                </p>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {(data.lowStock?.length ?? 0) > 0 && (
                    <div className="space-y-1.5">
                      {data.lowStock.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 p-2 border border-amber-200 bg-amber-50 rounded-lg text-sm"
                        >
                          <span className="font-medium truncate">{item.name}</span>
                          <span className="text-xs text-amber-700 shrink-0 tabular-nums">
                            {item.quantity} / мин. {item.min_quantity} {item.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(data.purchaseDrafts?.length ?? 0) > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Черновики закупок
                      </div>
                      {data.purchaseDrafts.map((d) => (
                        <div key={d.id} className="p-2 border border-border rounded-lg text-sm min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-600 mr-2">
                                {purchaseDraftSourceLabel(d.source)}
                              </Badge>
                              <Badge variant="secondary" className="text-[10px]">{d.status}</Badge>
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                              {d.items_count} поз. · ≈{formatRub(d.total_estimated)}
                            </span>
                          </div>
                          {/* P0.5: ETA поставки (PATCH /api/purchase-drafts/[id]) */}
                          <DraftEtaSetter draftId={d.id} />
                        </div>
                      ))}
                    </div>
                  )}
                  <Button size="sm" variant="outline" onClick={handleCreatePurchase}>
                    <Package className="h-4 w-4 mr-1" />
                    Создать закупку
                  </Button>
                </div>
              )}
            </SectionCard>

            {/* Сообщения + выручка */}
            <div className="space-y-4">
              <SectionCard emoji="💬" title="Сообщения" count={String(data.messagesUnread ?? 0)}>
                <p className="text-sm text-muted-foreground">
                  {data.messagesUnread > 0
                    ? `Непрочитанных сообщений: ${data.messagesUnread} — проверьте чаты с клиентами`
                    : "Новых сообщений нет"}
                </p>
              </SectionCard>
              <SectionCard emoji="💰" title="Выручка сегодня">
                <div className="font-display font-bold text-2xl text-emerald-700">
                  {formatRub(data.revenueToday ?? 0)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Комиссии и выплаты — в разделе «Финансы»
                </p>
              </SectionCard>
            </div>

            {/* P0.5: Требует внимания (риски / остатки / чаты) */}
            <AttentionCard attention={data.attention} className="lg:col-span-3" />
          </div>
        </>
      )}
    </div>
  );
}
