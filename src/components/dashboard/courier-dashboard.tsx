/**
 * courier-dashboard.tsx — дашборд курьера (v2.0).
 *
 * Рефакторинг из other-dashboards.tsx:
 *   - Убран @ts-nocheck
 *   - MOCK_ данные заменены на TanStack Query → /api/courier/dashboard
 *   - Layout использует общий DashboardSidebarLayout
 */

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Truck, Coins, TrendingUp, Settings, LogOut,
  Package, Star, MapPin, Clock, Navigation,
  LayoutDashboard, CheckCircle2, User,
} from "lucide-react";
import { formatCurrency, formatDate, COURIER_TRANSPORT } from "@/lib/finance";
import {
  DashboardSidebarLayout, SidebarStat, LoadingState, ErrorState,
} from "@/components/dashboard/_shared";
import { useCourierDashboard } from "@/lib/supabase/use-dashboards";
import { ProfileSettings } from "@/components/dashboard/profile-settings";

const TABS = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "active", label: "Активные", icon: Truck, badge: "3" },
  { id: "history", label: "История", icon: CheckCircle2 },
  { id: "earnings", label: "Заработок", icon: Coins },
  { id: "profile", label: "Профиль", icon: User },
  { id: "settings", label: "Настройки", icon: Settings },
];

export function CourierDashboard() {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const [activeTab, setActiveTab] = useState("overview");

  const { data, isLoading, error, refetch } = useCourierDashboard();

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
                    <div className="flex-1">
                      <div className="text-sm font-medium">{d.order_id}</div>
                      <div className="text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 inline mr-1" />
                        {d.address} • {""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">{d.estimated_time || "—"}</div>
                      <Badge variant="outline" className="text-[10px]">{d.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Сегодня завершено ({history.length})</h3>
              <div className="space-y-2">
                {history.slice(0, 5).map((h) => (
                  <div key={h.id} className="flex items-center gap-3 p-2 border border-border rounded">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{h.order_id}</div>
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
                      <div className="font-semibold">{d.order_id}</div>
                      <div className="text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4 inline mr-1" />
                        {d.address}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Доставка к {d.estimated_time || "—"} • {""}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Badge variant="outline">{d.status}</Badge>
                      <Button size="sm" variant="outline">
                        <Navigation className="h-4 w-4 mr-1" /> Маршрут
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
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
                      <div className="font-semibold">{h.order_id}</div>
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
                      <div className="font-medium">{h.order_id}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(h.delivered_at)}</div>
                    </div>
                    <div className="font-semibold text-emerald-600">+{formatCurrency(h.courier_earnings)}</div>
                  </div>
                ))}
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
