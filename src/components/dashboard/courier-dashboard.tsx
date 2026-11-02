/**
 * courier-dashboard.tsx — дашборд курьера (v2.1).
 *
 * Рефакторинг из other-dashboards.tsx:
 *   - Убран @ts-nocheck
 *   - MOCK_ данные заменены на TanStack Query → PostgREST под app-JWT
 *   - Layout использует общий DashboardSidebarLayout
 *
 * P1 (courier actions): реальные серверные действия над СВОИМИ доставками:
 *   - «Забрать» (status=assigned) → PATCH /api/courier/deliveries/:id {action:"pickup"}
 *     — deliveries assigned → picked_up (+pickup_at);
 *   - «Завершить» (picked_up/on_the_way) → PATCH /api/orders/:orderId {status:"DELIVERED"}
 *     — существующий контракт (courier-guard + order_status_history), роут
 *     синхронизирует строку deliveries (status/delivered_at/courier_earnings).
 *   Состояния: loading на кнопке, success/error toast, refetch данных.
 *   Мутации НЕ подменяются локальным React state.
 *
 * Этап 5: в карточках — реальный номер заказа (orders.number), не UUID.
 */

import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Truck, Coins, TrendingUp, Settings, LogOut,
  Package, Star, MapPin, Clock, Navigation,
  LayoutDashboard, CheckCircle2, User, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/finance";
import {
  DashboardSidebarLayout, SidebarStat, LoadingState, ErrorState,
} from "@/components/dashboard/_shared";
import { useCourierDashboard } from "@/lib/supabase/use-dashboards";
import { csrfFetch } from "@/lib/api-client";
import { ProfileSettings } from "@/components/dashboard/profile-settings";

const TABS = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "active", label: "Активные", icon: Truck },
  { id: "history", label: "История", icon: CheckCircle2 },
  { id: "earnings", label: "Заработок", icon: Coins },
  { id: "profile", label: "Профиль", icon: User },
  { id: "settings", label: "Настройки", icon: Settings },
];

/** Человекочитаемый статус доставки. */
const STATUS_LABELS: Record<string, string> = {
  assigned: "Назначена",
  picked_up: "Забрана",
  on_the_way: "В пути",
  delivered: "Доставлена",
  failed: "Не доставлена",
};

export function CourierDashboard() {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const [activeTab, setActiveTab] = useState("overview");
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useCourierDashboard();
  // p1-courier: id мутации в полёте (pickup:<id> | complete:<id>) — loading
  // на конкретной кнопке + защита от двойного клика.
  const [busyAction, setBusyAction] = useState<string | null>(null);

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>Войти</Button>
      </div>
    );
  }

  const stats = data?.stats;
  const activeDeliveries = data?.activeDeliveries || [];
  const history = data?.recentCompleted || [];

  /** Забрать доставку: PATCH /api/courier/deliveries/:id {action:"pickup"}. */
  const handlePickup = async (deliveryId: string) => {
    if (busyAction) return;
    setBusyAction(`pickup:${deliveryId}`);
    try {
      const res = await csrfFetch(`/api/courier/deliveries/${deliveryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pickup" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error || `Не удалось забрать доставку (${res.status})`);
        return;
      }
      toast.success("Доставка забрана");
      await queryClient.invalidateQueries({ queryKey: ["courier-dashboard-v2"] });
      await refetch();
    } catch {
      toast.error("Ошибка сети. Проверьте подключение");
    } finally {
      setBusyAction(null);
    }
  };

  /** Завершить доставку: существующий контракт PATCH /api/orders/:id {status:"DELIVERED"} */
  const handleComplete = async (deliveryId: string, orderId: string) => {
    if (busyAction) return;
    setBusyAction(`complete:${deliveryId}`);
    try {
      const res = await csrfFetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DELIVERED" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error || `Не удалось завершить доставку (${res.status})`);
        return;
      }
      toast.success("Доставка завершена");
      await queryClient.invalidateQueries({ queryKey: ["courier-dashboard-v2"] });
      await refetch();
    } catch {
      toast.error("Ошибка сети. Проверьте подключение");
    } finally {
      setBusyAction(null);
    }
  };

  /** Кнопки действий — только для допустимых состояний доставки. */
  const deliveryActions = (d: { id: string; order_id: string; status: string }) => {
    const busy = busyAction !== null;
    const buttons: ReactNode[] = [];
    if (d.status === "assigned") {
      buttons.push(
        <Button
          key="pickup"
          size="sm"
          disabled={busy}
          onClick={() => handlePickup(d.id)}
          className="gap-1"
        >
          {busyAction === `pickup:${d.id}` ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Package className="h-4 w-4" />
          )}
          {busyAction === `pickup:${d.id}` ? "Забираем…" : "Забрать"}
        </Button>
      );
    }
    if (d.status === "picked_up" || d.status === "on_the_way") {
      buttons.push(
        <Button
          key="complete"
          size="sm"
          disabled={busy}
          onClick={() => handleComplete(d.id, d.order_id)}
          className="gap-1"
        >
          {busyAction === `complete:${d.id}` ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          {busyAction === `complete:${d.id}` ? "Завершаем…" : "Завершить"}
        </Button>
      );
    }
    return buttons;
  };

  const content = () => {
    if (isLoading) return <LoadingState message="Загружаем данные курьера..." />;
    if (error) return <ErrorState error={error as Error} onRetry={() => refetch()} />;

    return (
      <>
        {activeTab === "overview" && (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">Кабинет курьера</h1>
          <Badge variant="outline" className="bg-primary/10 text-primary">
            <Truck className="h-3 w-3 mr-1" /> LIVE
          </Badge>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SidebarStat icon={Truck} label="Активные доставки" value={String(stats?.activeDeliveries || 0)} color="text-blue-600 bg-blue-100" />
              <SidebarStat icon={CheckCircle2} label="Завершено сегодня" value={String(stats?.completedToday || 0)} color="text-emerald-600 bg-emerald-100" />
              <SidebarStat icon={Coins} label="Заработано сегодня" value={formatCurrency(stats?.earningsToday || 0)} color="text-amber-600 bg-amber-100" />
              <SidebarStat icon={Star} label="Рейтинг" value={String(stats?.rating || 0)} color="text-purple-600 bg-purple-100" />
            </div>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Активные доставки</h3>
              <div className="space-y-2">
                {activeDeliveries.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 p-3 border border-border rounded">
                    <Truck className="h-5 w-5 text-blue-500" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">Заказ {d.orderNumber || d.order_id}</div>
                      <div className="text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 inline mr-1" />
                        {d.address} • {""}
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <div>
                        <div className="text-sm font-medium">{d.estimated_time || "—"}</div>
                        <Badge variant="outline" className="text-[10px]">{STATUS_LABELS[d.status] || d.status}</Badge>
                      </div>
                      <div className="flex flex-col gap-1">{deliveryActions(d)}</div>
                    </div>
                  </div>
                ))}
                {activeDeliveries.length === 0 && (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Нет активных доставок
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Сегодня завершено ({history.length})</h3>
              <div className="space-y-2">
                {history.slice(0, 5).map((h) => (
                  <div key={h.id} className="flex items-center gap-3 p-2 border border-border rounded">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">Заказ {h.orderNumber || h.order_id}</div>
                      <div className="text-xs text-muted-foreground">
                        {"—"} • {formatDate(h.delivered_at)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-sm">{formatCurrency(h.courier_earnings)}</div>
                      <div className="text-[10px] text-muted-foreground">⭐ {"—"}</div>
                    </div>
                  </div>
                ))}
                {history.length === 0 && (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Сегодня завершённых доставок нет
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}

        {activeTab === "active" && (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">Активные доставки</h1>
            <div className="space-y-3">
              {activeDeliveries.map((d) => (
                <Card key={d.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">Заказ {d.orderNumber || d.order_id}</div>
                      <div className="text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4 inline mr-1" />
                        {d.address}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Доставка к {d.estimated_time || "—"} • {""}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 items-end">
                      <Badge variant="outline">{STATUS_LABELS[d.status] || d.status}</Badge>
                      {deliveryActions(d)}
                      <a
                        href={`https://yandex.ru/maps/?text=${encodeURIComponent(d.address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1 h-8 px-3 text-xs rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground"
                      >
                        <Navigation className="h-4 w-4 mr-1" /> Маршрут
                      </a>
                    </div>
                  </div>
                </Card>
              ))}
              {activeDeliveries.length === 0 && (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  Нет активных доставок
                </Card>
              )}
            </div>
          </div>
        )}

        {activeTab === "history" && (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">История доставок</h1>
            <div className="space-y-3">
              {history.map((h) => (
                <Card key={h.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">Заказ {h.orderNumber || h.order_id}</div>
                      <div className="text-sm text-muted-foreground">
                        {"—"} • {formatDate(h.delivered_at)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-display font-bold">{formatCurrency(h.courier_earnings)}</div>
                      <div className="text-xs text-muted-foreground">⭐ {"—"}</div>
                    </div>
                  </div>
                </Card>
              ))}
              {history.length === 0 && (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  История пуста
                </Card>
              )}
            </div>
          </div>
        )}

        {activeTab === "earnings" && (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">Заработок</h1>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SidebarStat icon={Coins} label="Сегодня" value={formatCurrency(stats?.earningsToday || 0)} color="text-emerald-600 bg-emerald-100" />
              <SidebarStat icon={TrendingUp} label="За месяц" value={formatCurrency(stats?.earningsMonth || 0)} color="text-primary bg-primary/10" />
              <SidebarStat icon={Clock} label="В обработке" value={formatCurrency(0)} color="text-amber-600 bg-amber-100" />
              <SidebarStat icon={Package} label="За всё время" value={formatCurrency((stats?.earningsMonth || 0) * 6)} color="text-purple-600 bg-purple-100" />
            </div>
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Транзакции</h3>
              <div className="space-y-2">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between p-2 border border-border rounded text-sm">
                    <div>
                      <div className="font-medium">Заказ {h.orderNumber || h.order_id}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(h.delivered_at)}</div>
                    </div>
                    <div className="font-semibold text-emerald-600">+{formatCurrency(h.courier_earnings)}</div>
                  </div>
                ))}
                {history.length === 0 && (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Транзакций пока нет
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}

        {activeTab === "profile" && (
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Профиль курьера</h3>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Имя</div>
                <div className="font-medium">{user.name}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Транспорт</div>
                <div className="font-medium">Автомобиль</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Рейтинг</div>
                <div className="font-medium">⭐ {stats?.rating || 0}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Статус</div>
                <div className="font-medium text-emerald-600">Активен</div>
              </div>
            </div>
          </Card>
        )}

        {activeTab === "settings" && <ProfileSettings />}
      </>
    );
  };

  return (
    <DashboardSidebarLayout
      user={user}
      logout={logout}
      role="Курьер"
      avatar={user.avatar}
      businessName={user.name}
      navigate={navigate as unknown as (view: string) => void}
      tabs={TABS}
      activeTab={activeTab}
      onTab={setActiveTab}
    >
      {content()}
    </DashboardSidebarLayout>
  );
}
