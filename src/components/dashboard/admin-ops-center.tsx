"use client";

/**
 * admin-ops-center.tsx — «Операционный центр» администратора (Task 3-A, P0.5: 9-a).
 *
 * Данные:
 *   • GET /api/ops/tasks?status=open&limit=100 — очередь задач (refetch 60с);
 *   • GET /api/ops/summary — сводка дня (refetch 60с);
 *   • GET /api/ops/orders-today — Control Tower «ЗАКАЗЫ СЕГОДНЯ» (refetch 60с).
 *
 * Секции: «Сегодня» (StatCard-сетка) → «ЗАКАЗЫ СЕГОДНЯ (Control Tower)»
 * (чипы-фильтры + карточки-башни с «Рабочей областью») → «Требуют внимания»
 * (severity-группы critical/important/info со сценариями resolve/dismiss)
 * → «Финансы» → «Система».
 *
 * Палитра: critical→red, important→amber, info→slate, ok→emerald,
 * риск: GREEN→emerald / YELLOW→amber / ORANGE→orange / RED→red (без синего).
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, BellOff, CheckCircle2, Coins, Database, Gauge,
  Loader2, Radar, RefreshCw, ShoppingCart, Truck, UserPlus, UtensilsCrossed,
  Wallet, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, StatCard } from "@/components/dashboard/_shared";
import { csrfFetch } from "@/lib/api-client";
import { useOpsTaskAction } from "@/lib/use-ops-task-actions";
import { OrderWorkspaceButton } from "@/components/dashboard/order-workspace-dialog";
import {
  SEVERITY_UI, extractPayloadInfo, formatRub,
  type OpsSeverity, type OpsSummaryResponse, type OpsTask, type OpsTasksResponse,
} from "@/lib/ops-client-types";
import {
  type OrdersTodayResponse, type TowerCard,
} from "@/lib/ops/lifecycle-client-types";

const REFETCH_MS = 60_000;

/** GET /api/ops/tasks?status=open&limit=100 (экспортируется для общего кэша в admin-dashboard). */
export async function fetchOpsTasks(): Promise<OpsTasksResponse> {
  const res = await csrfFetch("/api/ops/tasks?status=open&limit=100");
  if (!res.ok) throw new Error(`Не удалось загрузить задачи (HTTP ${res.status})`);
  return (await res.json()) as OpsTasksResponse;
}

/** GET /api/ops/summary (экспортируется для общего кэша в admin-dashboard). */
export async function fetchOpsSummary(): Promise<OpsSummaryResponse> {
  const res = await csrfFetch("/api/ops/summary");
  if (!res.ok) throw new Error(`Не удалось загрузить сводку (HTTP ${res.status})`);
  return (await res.json()) as OpsSummaryResponse;
}

/** GET /api/ops/orders-today — Control Tower «ORDERS TODAY» (P0.5). */
async function fetchOrdersToday(): Promise<OrdersTodayResponse> {
  const res = await csrfFetch("/api/ops/orders-today");
  if (!res.ok) throw new Error(`Не удалось загрузить Control Tower (HTTP ${res.status})`);
  return (await res.json()) as OrdersTodayResponse;
}

// ==================== Control Tower: словари и хелперы ====================

type TowerFilter = "today" | "all" | "onTrack" | "attention" | "atRisk" | "overdue" | "unassigned";

type TowerRiskLevel = TowerCard["risk"]["level"];

/** Риск-палитра башни: GREEN→emerald, YELLOW→amber, ORANGE→orange, RED→red. */
const TOWER_RISK_UI: Record<TowerRiskLevel, { label: string; border: string; badge: string }> = {
  GREEN: { label: "В норме", border: "border-emerald-200", badge: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  YELLOW: { label: "Внимание", border: "border-amber-200", badge: "border-amber-200 bg-amber-50 text-amber-700" },
  ORANGE: { label: "Под риском", border: "border-orange-200", badge: "border-orange-200 bg-orange-50 text-orange-700" },
  RED: { label: "Критично", border: "border-red-200", badge: "border-red-200 bg-red-50 text-red-700" },
};

interface TowerChipDef {
  key: TowerFilter;
  label: string;
  idle: string;
  active: string;
}

/** Чипы-фильтры: активный чип подсвечивается цветом группы (без синего). */
const TOWER_CHIPS: TowerChipDef[] = [
  { key: "today", label: "Заказов сегодня", idle: "border-border text-foreground", active: "border-primary bg-primary/10 text-primary" },
  { key: "all", label: "Всего", idle: "border-border text-foreground", active: "border-primary bg-primary/10 text-primary" },
  { key: "onTrack", label: "On track", idle: "border-emerald-200 text-emerald-700", active: "border-emerald-300 bg-emerald-100 text-emerald-800" },
  { key: "attention", label: "Внимание", idle: "border-amber-200 text-amber-700", active: "border-amber-300 bg-amber-100 text-amber-800" },
  { key: "atRisk", label: "Под риском", idle: "border-orange-200 text-orange-700", active: "border-orange-300 bg-orange-100 text-orange-800" },
  { key: "overdue", label: "Просрочено", idle: "border-red-200 text-red-700", active: "border-red-300 bg-red-100 text-red-800" },
  { key: "unassigned", label: "Не назначено", idle: "border-slate-200 text-slate-600", active: "border-slate-300 bg-slate-100 text-slate-800" },
];

function towerChipCount(key: TowerFilter, counts: OrdersTodayResponse["counts"] | undefined): number {
  if (!counts) return 0;
  switch (key) {
    case "today": return counts.ordersToday;
    case "all": return counts.all;
    case "onTrack": return counts.onTrack;
    case "attention": return counts.attention;
    case "atRisk": return counts.atRisk;
    case "overdue": return counts.overdue;
    case "unassigned": return counts.unassigned;
  }
}

/** "YYYY-MM-DD…" → "DD.MM" (без Date — нет TZ-сдвигов). */
function formatTowerDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  return m ? `${m[3]}.${m[2]}` : dateStr;
}

/** ISO datetime → "DD.MM HH:MM". */
function formatTowerDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Карточка Control Tower: сводка состояния заказа + вход в «Рабочую область». */
function TowerOrderCard({ card }: { card: TowerCard }) {
  const risk = TOWER_RISK_UI[card.risk.level] ?? TOWER_RISK_UI.GREEN;
  const capacityText = card.capacityOk === null ? "—" : card.capacityOk ? "OK" : "нет окна";
  const capacityBadge =
    card.capacityOk === true
      ? "border-emerald-200 text-emerald-700"
      : card.capacityOk === false
        ? "border-amber-200 text-amber-700"
        : "border-slate-200 text-slate-600";
  const inventoryBadge = card.inventoryOk
    ? "border-emerald-200 text-emerald-700"
    : "border-amber-200 text-amber-700";

  return (
    <div className={`rounded-lg border ${risk.border} bg-card p-3 flex flex-col gap-2 min-w-0`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate" title={`Заказ № ${card.number}`}>№ {card.number}</div>
          <div className="text-xs text-muted-foreground truncate" title={card.confectionerName ?? undefined}>
            {card.confectionerName || "Не назначен"}
          </div>
        </div>
        <Badge variant="outline" className={`text-[10px] shrink-0 ${risk.badge}`}>
          {risk.label}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {card.deliveryDate && (
          <Badge variant="secondary" className="text-[10px]">
            {formatTowerDate(card.deliveryDate)}{card.isToday ? " · сегодня" : ""}
          </Badge>
        )}
        <Badge variant="outline" className={`text-[10px] ${card.productionStarted ? "border-orange-200 text-orange-700" : "border-slate-200 text-slate-600"}`}>
          {card.productionStarted ? "производство идёт" : "не начато"}
        </Badge>
        <Badge variant="outline" className={`text-[10px] ${capacityBadge}`}>
          Мощность: {capacityText}
        </Badge>
        <Badge variant="outline" className={`text-[10px] ${inventoryBadge}`}>
          Ингредиенты: {card.inventoryOk ? "OK" : "дефицит"}
        </Badge>
      </div>

      {card.latestSafeStartAt && (
        <div className="text-[11px] text-muted-foreground">
          Безопасный старт: <span className="tabular-nums">{formatTowerDateTime(card.latestSafeStartAt)}</span>
        </div>
      )}

      {card.risk.details.length > 0 && (
        <div className="space-y-0.5">
          {card.risk.details.slice(0, 2).map((d, i) => (
            <p key={i} className="text-[11px] text-muted-foreground line-clamp-1" title={d}>{d}</p>
          ))}
        </div>
      )}

      <div className="mt-auto pt-2 border-t border-border">
        <OrderWorkspaceButton orderId={card.id} label="Рабочая область" />
      </div>
    </div>
  );
}

function formatDueAt(dueAt: string): string {
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return dueAt;
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Карточка одной задачи очереди. */
function OpsTaskCard({
  task,
  onNavigateTab,
  busy,
  onResolve,
  onDismiss,
}: {
  task: OpsTask;
  onNavigateTab?: (tabId: string) => void;
  busy: boolean;
  onResolve: () => void;
  onDismiss: () => void;
}) {
  const sev = SEVERITY_UI[(task.severity as OpsSeverity) ?? "info"] ?? SEVERITY_UI.info;
  const payload = extractPayloadInfo(task.payload);
  const isDashboardLink = typeof task.action_url === "string" && task.action_url.startsWith("/dashboard?tab=");

  const handlePrimary = () => {
    if (isDashboardLink && onNavigateTab) {
      // "/dashboard?tab=orders" → "orders" — переключаем таб дашборда
      const tab = new URLSearchParams(task.action_url!.split("?")[1]).get("tab");
      if (tab) onNavigateTab(tab);
      return;
    }
    // Иной сценарий — считаем действие выполненным (задача закрыта)
    onResolve();
  };

  return (
    <div className={`rounded-lg border ${sev.border} bg-card p-3 transition hover:shadow-sm`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${sev.dot}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <div className={`text-sm font-semibold ${sev.text}`}>{task.title}</div>
              {task.description && (
                <div className="text-xs text-muted-foreground mt-0.5">{task.description}</div>
              )}
            </div>
            {task.due_at && (
              <Badge variant="outline" className={`text-[10px] shrink-0 ${sev.border} ${sev.text}`}>
                до {formatDueAt(task.due_at)}
              </Badge>
            )}
          </div>

          {/* payload-детали: сумма, номер заказа и прочее */}
          {(payload.total != null || payload.orderNumber || payload.extras.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {payload.orderNumber && (
                <Badge variant="secondary" className="text-[10px]">Заказ {payload.orderNumber}</Badge>
              )}
              {payload.total != null && (
                <Badge variant="secondary" className="text-[10px]">{formatRub(payload.total)}</Badge>
              )}
              {payload.extras.map((e) => (
                <Badge key={e.key} variant="outline" className="text-[10px] text-muted-foreground">
                  {e.key}: {e.value}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mt-3">
            {task.action_label && (
              <Button
                size="sm"
                className="min-h-[44px] sm:min-h-0"
                disabled={busy}
                onClick={handlePrimary}
              >
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <AlertTriangle className="h-4 w-4 mr-1" />}
                {task.action_label}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="min-h-[44px] sm:min-h-0 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
              disabled={busy}
              onClick={onResolve}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Готово
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-[44px] sm:min-h-0 text-muted-foreground"
              disabled={busy}
              onClick={onDismiss}
            >
              <BellOff className="h-4 w-4 mr-1" />
              Скрыть
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Строка раздела «Система». */
function SystemRow({
  icon: Icon,
  label,
  state,
}: {
  icon: typeof Database;
  label: string;
  state: { ok: boolean; text: string; muted?: boolean };
}) {
  return (
    <div className="flex items-center justify-between gap-2 p-2.5 border border-border rounded-lg text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <Badge
        variant="outline"
        className={`text-[10px] shrink-0 ${
          state.muted
            ? "border-slate-200 text-slate-600"
            : state.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
        }`}
      >
        {state.muted ? "•" : state.ok ? "🟢" : "🔴"} {state.text}
      </Badge>
    </div>
  );
}

export function AdminOpsCenter({ onNavigateTab }: { onNavigateTab?: (tabId: string) => void }) {
  const tasksQuery = useQuery({
    queryKey: ["ops-tasks"],
    queryFn: fetchOpsTasks,
    refetchInterval: REFETCH_MS,
  });
  const summaryQuery = useQuery({
    queryKey: ["ops-summary"],
    queryFn: fetchOpsSummary,
    refetchInterval: REFETCH_MS,
  });

  const actionMutation = useOpsTaskAction();

  // Control Tower: авто-фильтр «Под риском», пока пользователь не выбрал свой
  const towerQuery = useQuery({
    queryKey: ["ops-orders-today"],
    queryFn: fetchOrdersToday,
    refetchInterval: REFETCH_MS,
  });
  const [towerUserFilter, setTowerUserFilter] = useState<TowerFilter | null>(null);
  const towerCounts = towerQuery.data?.counts;
  const towerFilter: TowerFilter = towerUserFilter ?? (towerCounts && towerCounts.atRisk > 0 ? "atRisk" : "all");

  const towerCards = useMemo<TowerCard[]>(() => {
    const d = towerQuery.data;
    if (!d) return [];
    switch (towerFilter) {
      case "today": return d.cards.filter((c) => c.isToday);
      case "all": return d.cards;
      case "onTrack": return d.groups.onTrack;
      case "attention": return d.groups.attention;
      case "atRisk": return d.groups.atRisk;
      case "overdue": return d.groups.overdue;
      case "unassigned": return d.groups.unassigned;
    }
  }, [towerQuery.data, towerFilter]);

  const tasks = tasksQuery.data?.tasks ?? [];
  const counts = summaryQuery.data?.attention ?? tasksQuery.data?.counts ?? { critical: 0, important: 0, info: 0 };

  const grouped = useMemo(() => {
    const order: OpsSeverity[] = ["critical", "important", "info"];
    return order.map((sev) => ({
      severity: sev,
      items: tasks.filter((t) => (t.severity as OpsSeverity) === sev),
    }));
  }, [tasks]);

  const today = summaryQuery.data?.today;
  const system = summaryQuery.data?.system;

  const storageState = useMemo((): { ok: boolean; text: string; muted: boolean } => {
    const s = system?.storage;
    if (s == null) return { ok: false, text: "нет данных", muted: true };
    if (typeof s === "string") return { ok: s === "ok", text: s, muted: false };
    if (typeof s === "object" && "ok" in (s as Record<string, unknown>)) {
      const ok = Boolean((s as Record<string, unknown>).ok);
      return { ok, text: ok ? "ok" : "fail", muted: false };
    }
    return { ok: true, text: "ok", muted: false };
  }, [system?.storage]);

  const isBusy = (id: string) => actionMutation.isPending && actionMutation.variables?.id === id;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Gauge className="h-6 w-6 text-primary" />
          Операционный центр
        </h1>
        <div className="flex items-center gap-2">
          {tasksQuery.isFetching && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Обновление" />
          )}
          <Button size="sm" variant="outline" onClick={() => { void tasksQuery.refetch(); void summaryQuery.refetch(); }}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Обновить
          </Button>
        </div>
      </div>

      {/* ==================== СЕГОДНЯ ==================== */}
      <section aria-label="Сегодня">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Сегодня</h2>
        {summaryQuery.isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 bg-muted/50 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : summaryQuery.error ? (
          <ErrorState error={summaryQuery.error as Error} onRetry={() => void summaryQuery.refetch()} />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <StatCard icon={ShoppingCart} label="Заказы" value={String(today?.orders ?? 0)} color="text-primary bg-primary/10" />
            <StatCard icon={UtensilsCrossed} label="На производстве" value={String(today?.inProduction ?? 0)} color="text-amber-600 bg-amber-100" />
            <StatCard icon={Truck} label="Доставок" value={String(today?.deliveries ?? 0)} color="text-emerald-600 bg-emerald-100" />
            <StatCard icon={UserPlus} label="Новые клиенты" value={String(today?.newCustomers ?? 0)} color="text-purple-600 bg-purple-100" />
            <StatCard icon={Wallet} label="Выручка сегодня" value={formatRub(today?.revenueToday ?? 0)} color="text-emerald-700 bg-emerald-100" />
            <StatCard icon={Coins} label="Выручка за месяц" value={formatRub(today?.revenueMonth ?? 0)} color="text-amber-700 bg-amber-100" />
          </div>
        )}
      </section>

      {/* ==================== ЗАКАЗЫ СЕГОДНЯ (CONTROL TOWER) ==================== */}
      <section aria-label="Заказы сегодня (Control Tower)">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Radar className="h-3.5 w-3.5 text-primary" />
            Заказы сегодня (Control Tower)
          </h2>
          {towerQuery.data?.generatedAt && (
            <span className="text-[10px] text-muted-foreground">
              Срез: {new Date(towerQuery.data.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>

        {towerQuery.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-36 bg-muted/50 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : towerQuery.error ? (
          <ErrorState error={towerQuery.error as Error} onRetry={() => void towerQuery.refetch()} />
        ) : (
          <div className="space-y-3">
            {/* Чипы-фильтры: горизонтальный скролл на мобиле, без overflow 375px */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {TOWER_CHIPS.map((chip) => {
                const isActive = towerFilter === chip.key;
                return (
                  <button
                    key={chip.key}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setTowerUserFilter(chip.key)}
                    className={`shrink-0 whitespace-nowrap rounded-full border px-3 min-h-[44px] sm:min-h-0 sm:py-1 text-xs font-medium transition ${
                      isActive ? chip.active : chip.idle
                    }`}
                  >
                    {chip.label}: <span className="font-bold tabular-nums">{towerChipCount(chip.key, towerCounts)}</span>
                  </button>
                );
              })}
            </div>

            {towerCards.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Заказов в группе нет"
                text="Control Tower не видит заказов в выбранной группе — переключите фильтр"
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {towerCards.map((card) => (
                  <TowerOrderCard key={card.id} card={card} />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ==================== ТРЕБУЕТ ВНИМАНИЯ ==================== */}
      <section aria-label="Требует внимания">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            Требует внимания
          </h2>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] border-red-200 text-red-700">🔴 {counts.critical}</Badge>
            <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-700">🟠 {counts.important}</Badge>
            <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-600">🔵 {counts.info}</Badge>
          </div>
        </div>

        {tasksQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 bg-muted/50 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : tasksQuery.error ? (
          <ErrorState error={tasksQuery.error as Error} onRetry={() => void tasksQuery.refetch()} />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Все задачи обработаны"
            text="Операционная очередь пуста — новые события появятся здесь автоматически"
          />
        ) : (
          <div className="space-y-4">
            {grouped.map(({ severity, items }) => {
              if (items.length === 0) return null;
              const sev = SEVERITY_UI[severity];
              return (
                <div key={severity}>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <span aria-hidden>{sev.emoji}</span> {sev.label}
                    <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
                  </h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {items.map((t) => (
                      <OpsTaskCard
                        key={t.id}
                        task={t}
                        onNavigateTab={onNavigateTab}
                        busy={isBusy(t.id)}
                        onResolve={() => actionMutation.mutate({ id: t.id, action: "resolve" })}
                        onDismiss={() => actionMutation.mutate({ id: t.id, action: "dismiss" })}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ==================== ФИНАНСЫ ==================== */}
      <section aria-label="Финансы">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Финансы</h2>
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="text-xs text-emerald-700">Выручка сегодня</div>
              <div className="font-display font-bold text-lg text-emerald-800">{formatRub(today?.revenueToday ?? 0)}</div>
            </div>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
              <div className="text-xs text-amber-700">Выручка за месяц</div>
              <div className="font-display font-bold text-lg text-amber-800">{formatRub(today?.revenueMonth ?? 0)}</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Wallet className="h-3.5 w-3.5" />
            Комиссии и выплаты — в разделе «Финансы».
          </p>
        </Card>
      </section>

      {/* ==================== СИСТЕМА ==================== */}
      <section aria-label="Система">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Система</h2>
        <Card className="p-4 space-y-2">
          <SystemRow
            icon={Database}
            label="База данных"
            state={system ? { ok: system.db === "ok", text: system.db === "ok" ? "ok" : "fail" } : { ok: false, text: "нет данных", muted: true }}
          />
          <SystemRow
            icon={Wallet}
            label="Платежи (YooKassa)"
            state={system ? { ok: system.payments.configured, text: system.payments.configured ? "настроен" : "не настроен", muted: !system.payments.configured } : { ok: false, text: "нет данных", muted: true }}
          />
          <SystemRow
            icon={Zap}
            label="Автоматизация (n8n)"
            state={system ? { ok: system.automation.configured, text: system.automation.configured ? "настроен" : "не настроен", muted: !system.automation.configured } : { ok: false, text: "нет данных", muted: true }}
          />
          <SystemRow icon={Truck} label="Хранилище (storage)" state={storageState} />
          {summaryQuery.data?.generatedAt && (
            <p className="text-[11px] text-muted-foreground pt-1">
              Сводка сформирована: {new Date(summaryQuery.data.generatedAt).toLocaleString("ru-RU")}
            </p>
          )}
        </Card>
      </section>
    </div>
  );
}
