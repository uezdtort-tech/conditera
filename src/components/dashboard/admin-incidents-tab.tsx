"use client";

/**
 * Admin tab: Инциденты (DEPLOY-01 §4.2).
 *
 * Единый реестр инцидентов:
 *   • список с фильтрами (статус/приоритет/компонент) и поиском
 *     по ID / fingerprint / title;
 *   • сводка (counts по статусам и приоритетам, last 24h);
 *   • смена статуса (NEW → TRIAGED → IN_PROGRESS → FIXED → VERIFIED →
 *     CLOSED; REOPENED/IGNORED) — серверная валидация переходов;
 *   • история смен статусов;
 *   • связь с версией приложения (first_version/last_version).
 *
 * ДОСТУП: API сам проверяет серверные права (ADMIN/SUPER_ADMIN);
 * UI-скрытие — не механизм безопасности.
 */
import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  RefreshCw,
  History as HistoryIcon,
  Search,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { formatDistanceToNow } from "@/lib/utils";
import { csrfFetch } from "@/lib/api-client";

interface Incident {
  id: string;
  fingerprint: string;
  title: string;
  component: string;
  priority: string;
  status: string;
  severity: string;
  error_code: string | null;
  last_route: string | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  first_version: string | null;
  last_version: string | null;
  resolved_at: string | null;
  fix_commit: string | null;
  ignore_reason: string | null;
}

interface HistoryEntry {
  id: string;
  from_status: string | null;
  to_status: string;
  actor_id: string | null;
  actor_name: string | null;
  note: string | null;
  created_at: string;
}

interface Summary {
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  openTotal: number;
  last24h: number;
}

/** Метрики процесса/канала диагностики (GET /api/admin/diagnostics/metrics). */
interface MetricsSnapshot {
  process?: {
    pid: number;
    uptimeSec: number;
    memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
    cpu: { load1: number };
  };
  eventStore?: { queueLength: number; circuitOpen: boolean; totalDropped: number };
  events?: {
    last1h: { total: number; critical: number; http5xx: number };
    last24h: { total: number; critical: number; http5xx: number };
  };
}

/** Raw-событие (GET /api/admin/diagnostics/events?fingerprint=...). */
interface RawEvent {
  event_id: string;
  occurred_at: string;
  severity: string;
  error_code: string | null;
  message: string;
  route: string | null;
  http_status: number | null;
  app_version: string;
}

const ALL_STATUSES = [
  "NEW",
  "TRIAGED",
  "IN_PROGRESS",
  "FIXED",
  "VERIFIED",
  "CLOSED",
  "REOPENED",
  "IGNORED",
];

const PRIORITY_STYLES: Record<string, string> = {
  P0: "bg-red-100 text-red-800 border-red-300",
  P1: "bg-orange-100 text-orange-800 border-orange-300",
  P2: "bg-amber-100 text-amber-800 border-amber-300",
  P3: "bg-slate-100 text-slate-700 border-slate-300",
};

const STATUS_STYLES: Record<string, string> = {
  NEW: "bg-blue-50 text-blue-700 border-blue-200",
  TRIAGED: "bg-violet-50 text-violet-700 border-violet-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 border-amber-200",
  FIXED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  VERIFIED: "bg-green-50 text-green-700 border-green-200",
  CLOSED: "bg-slate-50 text-slate-600 border-slate-200",
  REOPENED: "bg-red-50 text-red-700 border-red-200",
  IGNORED: "bg-zinc-50 text-zinc-500 border-zinc-200",
};

/** Допустимые переходы — подсказка UI; сервер валидирует окончательно. */
const ALLOWED_NEXT: Record<string, string[]> = {
  NEW: ["TRIAGED", "IN_PROGRESS", "IGNORED", "CLOSED"],
  TRIAGED: ["IN_PROGRESS", "IGNORED", "CLOSED"],
  IN_PROGRESS: ["FIXED", "IGNORED", "CLOSED"],
  FIXED: ["VERIFIED", "CLOSED"],
  VERIFIED: ["CLOSED", "REOPENED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["TRIAGED", "IN_PROGRESS", "FIXED", "IGNORED", "CLOSED"],
  IGNORED: ["REOPENED"],
};

export function AdminIncidentsTab() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [eventsFor, setEventsFor] = useState<string | null>(null);
  const [events, setEvents] = useState<RawEvent[]>([]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (priorityFilter !== "all") params.set("priority", priorityFilter);
      if (search.trim()) params.set("q", search.trim());
      params.set("limit", "100");
      const res = await csrfFetch(`/api/admin/diagnostics/incidents?${params}`);
      const data = (await res.json()) as { items?: Incident[]; total?: number; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setIncidents(data.items || []);
      setTotal(data.total || 0);

      const sumRes = await csrfFetch("/api/admin/diagnostics/incidents?summary=1");
      const sumData = (await sumRes.json()) as { summary?: Summary };
      setSummary(sumData.summary || null);

      // Метрики — необязательная панель: сбой/недоступность не ломают список
      try {
        const mRes = await csrfFetch("/api/admin/diagnostics/metrics");
        if (mRes.ok) setMetrics((await mRes.json()) as MetricsSnapshot);
      } catch {
        /* метрики недоступны — панель просто не показывается */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить инциденты");
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, priorityFilter, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadHistory = useCallback(async (incidentId: string) => {
    if (historyFor === incidentId) {
      setHistoryFor(null);
      setHistory([]);
      return;
    }
    try {
      const res = await csrfFetch(
        `/api/admin/diagnostics/incidents?incidentId=${encodeURIComponent(incidentId)}`
      );
      const data = (await res.json()) as { history?: HistoryEntry[] };
      setHistoryFor(incidentId);
      setHistory(data.history || []);
    } catch {
      setHistoryFor(incidentId);
      setHistory([]);
    }
  }, [historyFor]);

  const loadEvents = useCallback(async (fingerprint: string) => {
    if (eventsFor === fingerprint) {
      setEventsFor(null);
      setEvents([]);
      return;
    }
    try {
      const res = await csrfFetch(
        `/api/admin/diagnostics/events?fingerprint=${encodeURIComponent(fingerprint)}&limit=25`
      );
      const data = (await res.json()) as { events?: RawEvent[] };
      setEventsFor(fingerprint);
      setEvents(data.events || []);
    } catch {
      setEventsFor(fingerprint);
      setEvents([]);
    }
  }, [eventsFor]);

  const transition = useCallback(
    async (incidentId: string, toStatus: string, ignoreReason?: string) => {
      setActionError(null);
      try {
        const res = await csrfFetch("/api/admin/diagnostics/incidents", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            incidentId,
            toStatus,
            ignoreReason: toStatus === "IGNORED" ? ignoreReason || "Без причины — заполните" : undefined,
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        await load();
        if (historyFor === incidentId) await loadHistory(incidentId);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Не удалось изменить статус");
      }
    },
    [load, historyFor, loadHistory]
  );

  return (
    <div className="space-y-4" role="region" aria-label="Реестр инцидентов">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-primary" />
          Инциденты
          {total > 0 && (
            <Badge variant="outline" className="ml-1">
              {total}
            </Badge>
          )}
        </h1>
        <Button onClick={load} variant="outline" size="sm" aria-label="Обновить">
          <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {error && (
        <Card className="p-3 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {error}
        </Card>
      )}
      {actionError && (
        <Card className="p-3 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {actionError}
        </Card>
      )}

      {/* Сводка */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryStat label="Открытых" value={String(summary.openTotal)} tone="text-amber-600 bg-amber-100" />
          <SummaryStat label="За 24 часа" value={String(summary.last24h)} tone="text-primary bg-primary/10" />
          <SummaryStat
            label="P0 + P1"
            value={String((summary.byPriority.P0 || 0) + (summary.byPriority.P1 || 0))}
            tone="text-red-600 bg-red-100"
          />
          <SummaryStat
            label="Закрытых"
            value={String((summary.byStatus.CLOSED || 0) + (summary.byStatus.VERIFIED || 0))}
            tone="text-emerald-600 bg-emerald-100"
          />
        </div>
      )}

      {/* Метрики процесса/канала (§5) — необязательная панель */}
      {metrics?.process && (
        <Card className="p-4" role="region" aria-label="Метрики диагностики">
          <div className="flex items-center gap-2 mb-2 text-sm font-medium">
            <Activity className="h-4 w-4 text-primary" aria-hidden />
            Метрики диагностики
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            <MetricCell
              label="RSS / Heap"
              value={`${(metrics.process.memory.rssBytes / 1048576).toFixed(0)} / ${(metrics.process.memory.heapUsedBytes / 1048576).toFixed(0)} МБ`}
            />
            <MetricCell label="Uptime" value={`${Math.floor(metrics.process.uptimeSec / 60)} мин`} />
            <MetricCell label="Load (1м)" value={metrics.process.cpu.load1.toFixed(2)} />
            <MetricCell
              label="Очередь событий"
              value={`${metrics.eventStore?.queueLength ?? 0}${metrics.eventStore?.circuitOpen ? " (circuit open!)" : ""}`}
              tone={metrics.eventStore?.circuitOpen ? "text-red-600" : undefined}
            />
            <MetricCell
              label="События 1ч / 24ч"
              value={`${metrics.events?.last1h.total ?? 0} / ${metrics.events?.last24h.total ?? 0}`}
            />
            <MetricCell
              label="5xx за 24ч (крит.)"
              value={`${metrics.events?.last24h.http5xx ?? 0} (${metrics.events?.last24h.critical ?? 0})`}
              tone={(metrics.events?.last24h.critical ?? 0) > 0 ? "text-red-600" : undefined}
            />
          </div>
        </Card>
      )}

      {/* Фильтры */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по ID / fingerprint / заголовку"
              className="pl-8"
              aria-label="Поиск инцидентов"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[170px]" aria-label="Фильтр по статусу">
              <SelectValue placeholder="Статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {ALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-[120px]" aria-label="Фильтр по приоритету">
              <SelectValue placeholder="Приоритет" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              {["P0", "P1", "P2", "P3"].map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Список */}
      {isLoading && incidents.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground text-sm">Загрузка...</Card>
      ) : incidents.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground text-sm">
          <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
          Инцидентов не найдено — новых проблем не зафиксировано.
        </Card>
      ) : (
        <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
          {incidents.map((inc) => {
            const nextStates = ALLOWED_NEXT[inc.status] || [];
            return (
              <Card key={inc.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Badge variant="outline" className={`text-[10px] font-semibold ${PRIORITY_STYLES[inc.priority] || ""}`}>
                        {inc.priority}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[inc.status] || ""}`}>
                        {inc.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{inc.component}</span>
                      {inc.error_code && (
                        <span className="text-xs font-mono text-muted-foreground">{inc.error_code}</span>
                      )}
                    </div>
                    <p className="text-sm font-medium break-words">{inc.title}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>Повторов: <strong>{inc.occurrence_count}</strong></span>
                      {inc.last_route && <span className="font-mono">{inc.last_route}</span>}
                      <span>последний: {formatDistanceToNow(new Date(inc.last_seen_at))} назад</span>
                      <span title={inc.fingerprint} className="font-mono">
                        fp:{inc.fingerprint.slice(0, 12)}…
                      </span>
                      {inc.first_version && (
                        <span>
                          версии: {inc.first_version.slice(0, 7)} → {inc.last_version?.slice(0, 7)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void loadEvents(inc.fingerprint)}
                      aria-label="Сырые события"
                      title="Сырые события по fingerprint"
                      className="min-h-[44px]"
                    >
                      <Activity className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void loadHistory(inc.id)}
                      aria-label="История статусов"
                      className="min-h-[44px]"
                    >
                      <HistoryIcon className="h-4 w-4" />
                    </Button>
                    {nextStates.map((s) => (
                      <Button
                        key={s}
                        variant="outline"
                        size="sm"
                        className="min-h-[44px] text-xs"
                        onClick={() => void transition(inc.id, s)}
                      >
                        → {s}
                      </Button>
                    ))}
                  </div>
                </div>

                {historyFor === inc.id && (
                  <div className="mt-3 pt-3 border-t border-border max-h-56 overflow-y-auto">
                    {history.length === 0 ? (
                      <p className="text-xs text-muted-foreground">История пуста.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {history.map((h) => (
                          <li key={h.id} className="text-xs text-muted-foreground">
                            <span className="font-mono">
                              {h.from_status || "—"} → <strong>{h.to_status}</strong>
                            </span>{" "}
                            {h.actor_name || (h.actor_id ? h.actor_id.slice(0, 8) : "system")} ·{" "}
                            {formatDistanceToNow(new Date(h.created_at))} назад
                            {h.note ? ` · ${h.note}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {eventsFor === inc.fingerprint && (
                  <div className="mt-3 pt-3 border-t border-border max-h-72 overflow-y-auto">
                    <p className="text-xs font-medium mb-1.5 text-muted-foreground">
                      Сырые события (последние {events.length}):
                    </p>
                    {events.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Событий нет (raw-записи могли быть ограничены rate-limit или очищены).</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {events.map((ev) => (
                          <li key={ev.event_id} className="text-xs text-muted-foreground">
                            <span className="font-mono text-foreground">
                              [{ev.severity}]{ev.http_status ? ` ${ev.http_status}` : ""}
                            </span>{" "}
                            {formatDistanceToNow(new Date(ev.occurred_at))} назад ·{" "}
                            <span className="font-mono">{ev.app_version.slice(0, 7)}</span> ·{" "}
                            {ev.error_code ? <span className="font-mono">{ev.error_code}</span> : null} {ev.message.slice(0, 120)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${tone}`} aria-hidden>
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xl font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
    </Card>
  );
}

function MetricCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <p className={`font-semibold leading-tight ${tone || ""}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}
