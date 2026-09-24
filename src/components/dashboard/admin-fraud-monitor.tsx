"use client";

/**
 * AdminFraudMonitor — компонент для админ-панели.
 * Показывает:
 *  - Сводку (подозрительные пользователи, топ-IP, события за 24ч)
 *  - Список подозрительных пользователей (5+ IP за 24ч)
 *  - Топ-30 IP по активности
 *  - Статистику по типам действий
 *  - Ленту последних 50 событий
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Activity, Users, Globe, ShieldAlert } from "lucide-react";

interface FraudData {
  suspiciousUsers: { userId: string; _count: { ipHash: number } }[];
  topIps: { ipHash: string; count: number }[];
  actionsStats: { action: string; count: number }[];
  recentEvents: {
    id: string;
    ipHash: string;
    userId: string | null;
    action: string;
    deviceFp: string | null;
    createdAt: string;
  }[];
  summary: {
    totalEvents24h: number;
    suspiciousUsersCount: number;
    uniqueIps24h: number;
  };
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  order_create: { label: "Заказы", color: "bg-blue-100 text-blue-800" },
  register: { label: "Регистрации", color: "bg-amber-100 text-amber-800" },
  login: { label: "Логины", color: "bg-emerald-100 text-emerald-800" },
  review: { label: "Отзывы", color: "bg-purple-100 text-purple-800" },
};

export function AdminFraudMonitor() {
  const [data, setData] = useState<FraudData | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/fraud-monitor");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <Card className="p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-32 bg-muted rounded" />
          <div className="h-20 bg-muted/50 rounded" />
        </div>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="p-6 text-center text-muted-foreground">
        Не удалось загрузить данные anti-fraud мониторинга
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-medium flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-primary" />
            Anti-fraud монитор
          </h2>
          <p className="text-sm text-muted-foreground">
            Подозрительная активность за последние 24 часа
          </p>
        </div>
        <Badge variant="outline">Обновлено {new Date().toLocaleTimeString("ru-RU")}</Badge>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            Подозрительные пользователи
          </div>
          <div className="text-2xl font-bold mt-1">{data.summary.suspiciousUsersCount}</div>
          <div className="text-xs text-muted-foreground">5+ IP за 24 часа</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Globe className="h-4 w-4" />
            Уникальные IP
          </div>
          <div className="text-2xl font-bold mt-1">{data.summary.uniqueIps24h}</div>
          <div className="text-xs text-muted-foreground">за 24 часа</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Activity className="h-4 w-4" />
            Всего событий
          </div>
          <div className="text-2xl font-bold mt-1">{data.summary.totalEvents24h}</div>
          <div className="text-xs text-muted-foreground">за 24 часа</div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Suspicious users */}
        <Card className="p-4">
          <h3 className="font-display font-medium mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Подозрительные пользователи
          </h3>
          {data.suspiciousUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Подозрительных пользователей не обнаружено</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {data.suspiciousUsers.map((u, i) => (
                <div key={u.userId} className="flex items-center justify-between p-2 bg-amber-50 dark:bg-amber-950/30 rounded">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">#{i + 1}</span>
                    <code className="text-xs">{u.userId.slice(0, 12)}…</code>
                  </div>
                  <Badge className="bg-amber-100 text-amber-800">
                    {u._count.ipHash} IP
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Top IPs */}
        <Card className="p-4">
          <h3 className="font-display font-medium mb-3 flex items-center gap-2">
            <Globe className="h-4 w-4 text-blue-500" />
            Топ-30 IP по активности
          </h3>
          {data.topIps.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет данных</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {data.topIps.map((ip, i) => (
                <div key={ip.ipHash} className="flex items-center justify-between p-2 border-b last:border-b-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">#{i + 1}</span>
                    <code className="text-xs">{ip.ipHash}</code>
                  </div>
                  <Badge variant="outline">{ip.count}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Actions stats */}
      <Card className="p-4">
        <h3 className="font-display font-medium mb-3">Статистика по типам действий</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {data.actionsStats.map((a) => {
            const info = ACTION_LABELS[a.action] || { label: a.action, color: "bg-slate-100 text-slate-800" };
            return (
              <div key={a.action} className="p-3 border rounded-lg">
                <Badge className={info.color}>{info.label}</Badge>
                <div className="text-2xl font-bold mt-2">{a.count}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Recent events */}
      <Card className="p-4">
        <h3 className="font-display font-medium mb-3">Лента событий (последние 50)</h3>
        {data.recentEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет событий за последние 24 часа</p>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {data.recentEvents.map((e) => {
              const info = ACTION_LABELS[e.action] || { label: e.action, color: "bg-slate-100 text-slate-800" };
              return (
                <div key={e.id} className="flex items-center justify-between p-2 text-xs border-b last:border-b-0">
                  <div className="flex items-center gap-2">
                    <Badge className={info.color + " text-[10px] px-1.5 py-0"}>{info.label}</Badge>
                    <code className="text-muted-foreground">{e.ipHash}</code>
                    {e.userId && <code className="text-muted-foreground">user:{e.userId.slice(0, 8)}…</code>}
                  </div>
                  <span className="text-muted-foreground">{new Date(e.createdAt).toLocaleString("ru-RU")}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
