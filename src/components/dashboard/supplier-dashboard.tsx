/**
 * supplier-dashboard.tsx — дашборд поставщика (v2.0, прямой supabase-js).
 *
 * Использует useSupplierDashboard() из use-dashboards.ts — прямые supabase-js запросы.
 * 8 tabs: Обзор, Заказы, Товары, Финансы, Аналитика, Anti-fraud, Кондитеры, Настройки
 */

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line,
} from "recharts";
import {
  Package, Coins, TrendingUp, Settings, LogOut,
  ShoppingCart, Star, MapPin, Clock,
  FileText, ShieldAlert, UserCheck, LayoutDashboard, Plus,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/finance";
import { AdminFraudMonitor } from "@/components/dashboard/admin-fraud-monitor";
import { AdminConfectionerVerification } from "@/components/dashboard/admin-confectioner-verification";
import { toast } from "sonner";
import { ProfileSettings } from "@/components/dashboard/profile-settings";
import { SupplierProductsManager } from "@/components/dashboard/supplier-products-manager";
import {
  DashboardSidebarLayout, SidebarStat, LoadingState, ErrorState,
} from "@/components/dashboard/_shared";
import { useSupplierDashboard } from "@/lib/supabase/use-dashboards";

const TABS = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "orders", label: "Заказы", icon: ShoppingCart },
  { id: "products", label: "Товары", icon: Package },
  { id: "finance", label: "Финансы", icon: Coins },
  { id: "analytics", label: "Аналитика", icon: TrendingUp },
  { id: "fraud", label: "Anti-fraud", icon: ShieldAlert },
  { id: "confectioners", label: "Кондитеры", icon: UserCheck },
  { id: "settings", label: "Настройки", icon: Settings },
];

export function SupplierDashboard() {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const [activeTab, setActiveTab] = useState("overview");

  const { data, isLoading, error, refetch } = useSupplierDashboard();

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>Войти</Button>
      </div>
    );
  }

  const stats = data?.stats;
  const recentOrders = data?.recentOrders || [];
  const products = data?.products || [];

  const content = () => {
    if (isLoading && activeTab === "overview") return <LoadingState message="Загружаем данные поставщика..." />;
    if (error && activeTab === "overview") return <ErrorState error={error as Error} onRetry={() => refetch()} />;

    switch (activeTab) {
      case "overview":
        return (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="font-display text-2xl font-bold">Кабинет поставщика</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {user.name} • {stats?.totalProducts || 0} товаров
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SidebarStat icon={Coins} label="Доход" value={formatCurrency(stats?.revenue || 0)} color="text-emerald-600 bg-emerald-100" />
              <SidebarStat icon={ShoppingCart} label="Активных заказов" value={String(stats?.activeOrders || 0)} color="text-primary bg-primary/10" />
              <SidebarStat icon={Package} label="Товаров" value={String(stats?.totalProducts || 0)} color="text-amber-600 bg-amber-100" />
              <SidebarStat icon={ShieldAlert} label="Низкий остаток" value={String(stats?.lowStockItems || 0)} color="text-red-600 bg-red-100" />
            </div>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Последние заказы</h3>
              <div className="space-y-2">
                {recentOrders.slice(0, 4).map((o) => (
                  <div key={o.id} className="flex items-center gap-3 p-2 border border-border rounded">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{o.number}</div>
                      <div className="text-xs text-muted-foreground">{o.customer_name} • {o.items_count} тов.</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-sm">{formatCurrency(o.total)}</div>
                      <Badge variant="outline" className="text-[10px]">{o.status}</Badge>
                    </div>
                  </div>
                ))}
                {recentOrders.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">Пока нет заказов</p>
                )}
              </div>
            </Card>
          </div>
        );

      case "orders":
        return (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">Заказы</h1>
            <div className="space-y-3">
              {recentOrders.map((o) => (
                <Card key={o.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{o.number}</div>
                      <div className="text-sm text-muted-foreground">{o.customer_name} • {formatDate(o.created_at)}</div>
                      <div className="text-xs text-muted-foreground mt-1">{o.items_count} товаров</div>
                    </div>
                    <div className="text-right">
                      <div className="font-display font-bold">{formatCurrency(o.total)}</div>
                      <Badge variant="outline" className="text-[10px]">{o.status}</Badge>
                    </div>
                  </div>
                </Card>
              ))}
              {recentOrders.length === 0 && (
                <Card className="p-8 text-center">
                  <ShoppingCart className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Заказов пока нет</p>
                </Card>
              )}
            </div>
          </div>
        );

      case "products":
        return <SupplierProductsManager />;

      case "finance":
        return (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">Финансы</h1>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SidebarStat icon={Coins} label="Доход" value={formatCurrency(stats?.revenue || 0)} color="text-emerald-600 bg-emerald-100" />
              <SidebarStat icon={TrendingUp} label="Активные заказы" value={String(stats?.activeOrders || 0)} color="text-primary bg-primary/10" />
              <SidebarStat icon={Clock} label="Ожидают оплаты" value="—" color="text-amber-600 bg-amber-100" />
              <SidebarStat icon={FileText} label="Завершено" value={String(stats?.completedOrders || 0)} color="text-purple-600 bg-purple-100" />
            </div>
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Транзакции</h3>
              <div className="space-y-2">
                {recentOrders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between p-2 border border-border rounded text-sm">
                    <div>
                      <div className="font-medium">{o.number}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(o.created_at)}</div>
                    </div>
                    <div className="font-semibold text-emerald-600">+{formatCurrency(o.total)}</div>
                  </div>
                ))}
                {recentOrders.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">Транзакций пока нет</p>
                )}
              </div>
            </Card>
          </div>
        );

      case "analytics":
        return (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">Аналитика</h1>
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Выручка по месяцам</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={recentOrders.map((o) => ({ month: formatDate(o.created_at), value: o.total }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.90 0.015 70)" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v / 1000}k`} />
                  <Tooltip formatter={(v: number) => [formatCurrency(v), "Выручка"]} />
                  <Line type="monotone" dataKey="value" stroke="oklch(0.55 0.18 25)" strokeWidth={3} dot={{ fill: "oklch(0.55 0.18 25)", r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </div>
        );

      case "fraud":
        return <AdminFraudMonitor />;

      case "confectioners":
        return <AdminConfectionerVerification />;

      case "settings":
        return <ProfileSettings />;

      default:
        return <LoadingState />;
    }
  };

  return (
    <DashboardSidebarLayout
      user={user}
      logout={logout}
      role="Поставщик"
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
