"use client";

/**
 * confectioner-dashboard-v2.tsx — дашборд кондитера на supabase-js (v2.0).
 *
 * Использует useConfectionerDashboard() — прямые supabase-js запросы.
 * Показывает: входящие inquiries, переговоры, активные заказы, товары, доход.
 */

import * as React from "react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  Package, Coins, TrendingUp, Settings, LogOut,
  MessageSquare, ShoppingBag, Star, Plus, Calendar, Cake,
} from "lucide-react";
import { formatCurrency, formatDate, ORDER_STATUS_LABELS } from "@/lib/finance";
import {
  DashboardSidebarLayout, SidebarStat, LoadingState, ErrorState,
} from "@/components/dashboard/_shared";
import { useConfectionerDashboard } from "@/lib/supabase/use-dashboards";

const TABS = [
  { id: "overview", label: "Обзор", icon: TrendingUp },
  { id: "inquiries", label: "Запросы", icon: MessageSquare },
  { id: "orders", label: "Заказы", icon: ShoppingBag },
  { id: "products", label: "Товары", icon: Package },
  { id: "earnings", label: "Финансы", icon: Coins },
  { id: "settings", label: "Настройки", icon: Settings },
];

export function ConfectionerDashboardV2(): React.JSX.Element {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const [activeTab, setActiveTab] = React.useState("overview");

  const { data, isLoading, error, refetch } = useConfectionerDashboard();

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>Войти</Button>
      </div>
    );
  }

  const content = (): React.JSX.Element => {
    if (isLoading) return <LoadingState message="Загружаем данные кондитера..." />;
    if (error) return <ErrorState error={error as Error} onRetry={() => refetch()} />;

    const stats = data?.stats;
    const inquiries = data?.incomingInquiries || [];
    const orders = data?.activeOrders || [];
    const products = data?.recentEarnings || [];

    switch (activeTab) {
      case "overview":
        return (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="font-display text-2xl font-bold">Кабинет кондитера</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {user.name} • {stats?.publishedProducts || 0} товаров опубликовано
                </p>
              </div>
              <Button onClick={() => toast.info("Открыть конструктор")}>
                <Plus className="h-4 w-4 mr-1" /> Создать товар
              </Button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SidebarStat icon={MessageSquare} label="Новых запросов" value={String(stats?.pendingInquiries || 0)} color="text-purple-600 bg-purple-100" />
              <SidebarStat icon={ShoppingBag} label="Активных заказов" value={String(stats?.activeOrders || 0)} color="text-blue-600 bg-blue-100" />
              <SidebarStat icon={Coins} label="Заработано" value={formatCurrency(stats?.totalEarnings || 0)} color="text-emerald-600 bg-emerald-100" />
              <SidebarStat icon={Star} label="Рейтинг" value={String(stats?.rating || "—")} color="text-amber-600 bg-amber-100" />
            </div>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Входящие запросы на торты</h3>
              <div className="space-y-2">
                {inquiries.slice(0, 5).map((inq) => (
                  <div key={inq.id} className="flex items-center gap-3 p-3 border border-border rounded">
                    <Cake className="h-5 w-5 text-primary" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{inq.event_type || "Индивидуальный торт"}</div>
                      <div className="text-xs text-muted-foreground">
                        {inq.servings} порц. • {inq.city || "—"} • {inq.filling || "—"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold">
                        {inq.estimated_price ? formatCurrency(inq.estimated_price) : "—"}
                      </div>
                      <Badge variant="secondary" className="text-[10px]">истекает {formatDate(inq.expires_at)}</Badge>
                    </div>
                  </div>
                ))}
                {inquiries.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Нет новых запросов. Подождите — пользователи найдут вас в каталоге.
                  </p>
                )}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Активные заказы (по датам доставки)</h3>
              <div className="space-y-2">
                {orders.slice(0, 5).map((order) => (
                  <div key={order.id} className="flex items-center gap-3 p-3 border border-border rounded">
                    <Calendar className="h-5 w-5 text-blue-500" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{order.number}</div>
                      <div className="text-xs text-muted-foreground">
                        {order.delivery_date ? formatDate(order.delivery_date) : "Срок не указан"} • {order.delivery_address || "—"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-sm">{formatCurrency(order.total)}</div>
                      <Badge variant="outline" className="text-[10px]">
                        {ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS]?.label || order.status}
                      </Badge>
                    </div>
                  </div>
                ))}
                {orders.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Нет активных заказов
                  </p>
                )}
              </div>
            </Card>
          </div>
        );

      case "inquiries":
        return (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">Запросы на торты</h1>
            <Card className="p-4">
              <div className="space-y-3">
                {inquiries.map((inq) => (
                  <div key={inq.id} className="p-3 border border-border rounded">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium">{inq.event_type || "Индивидуальный"}</div>
                      <Badge variant="outline">истекает {formatDate(inq.expires_at)}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Основа: {inq.base || "—"} • Начинка: {inq.filling || "—"} • {inq.servings} порций
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      Город: {inq.city || "—"}
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <div className="font-semibold">
                        {inq.estimated_price ? formatCurrency(inq.estimated_price) : "—"}
                      </div>
                      <Button size="sm">
                        <MessageSquare className="h-4 w-4 mr-1" /> Ответить
                      </Button>
                    </div>
                  </div>
                ))}
                {inquiries.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Нет запросов
                  </p>
                )}
              </div>
            </Card>
          </div>
        );

      case "orders":
        return (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">Активные заказы</h1>
            <div className="space-y-3">
              {orders.map((order) => (
                <Card key={order.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{order.number}</div>
                      <div className="text-sm text-muted-foreground">
                        {order.delivery_date ? formatDate(order.delivery_date) : "Срок не указан"}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {order.delivery_address || "—"}
                      </div>
                      {order.items && order.items.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {order.items.map((i) => `${i.product_title} ×${i.quantity}`).join(", ")}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-display font-bold">{formatCurrency(order.total)}</div>
                      <Badge variant="outline" className="text-[10px]">
                        {ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS]?.label || order.status}
                      </Badge>
                    </div>
                  </div>
                </Card>
              ))}
              {orders.length === 0 && (
                <Card className="p-8 text-center">
                  <ShoppingBag className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Нет активных заказов</p>
                </Card>
              )}
            </div>
          </div>
        );

      case "products":
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="font-display text-2xl font-bold">Мои товары ({stats?.productsCount || 0})</h1>
              <Button>
                <Plus className="h-4 w-4 mr-1" /> Добавить товар
              </Button>
            </div>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">
                Опубликовано: {stats?.publishedProducts || 0} из {stats?.productsCount || 0}
              </p>
            </Card>
            <Card className="p-8 text-center">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Управление товарами доступно в Studio или будет добавлено в v2.1
              </p>
            </Card>
          </div>
        );

      case "earnings":
        return (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">Финансы</h1>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SidebarStat icon={Coins} label="Всего заработано" value={formatCurrency(stats?.totalEarnings || 0)} color="text-emerald-600 bg-emerald-100" />
              <SidebarStat icon={ShoppingBag} label="Завершено заказов" value={String(stats?.completedOrders || 0)} color="text-blue-600 bg-blue-100" />
              <SidebarStat icon={TrendingUp} label="Средний чек" value={formatCurrency(stats?.completedOrders ? Math.round((stats.totalEarnings || 0) / stats.completedOrders) : 0)} color="text-purple-600 bg-purple-100" />
              <SidebarStat icon={Star} label="Рейтинг" value={String(stats?.rating || "—")} color="text-amber-600 bg-amber-100" />
            </div>
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Последние выплаты</h3>
              <div className="space-y-2">
                {products.map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between p-2 border border-border rounded text-sm">
                    <div>
                      <div className="font-medium">{payment.order?.number || "—"}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(payment.created_at)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-emerald-600">{formatCurrency(payment.amount)}</div>
                      <Badge variant="outline" className="text-[10px]">{payment.status}</Badge>
                    </div>
                  </div>
                ))}
                {products.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">Нет выплат</p>
                )}
              </div>
            </Card>
          </div>
        );

      case "settings":
        return (
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Настройки кондитера</h3>
            <p className="text-sm text-muted-foreground">
              Открыть полные настройки профиля и тариф.
            </p>
            <Button className="mt-3" onClick={() => navigate("settings" as never)}>
              <Settings className="h-4 w-4 mr-2" /> Открыть настройки
            </Button>
          </Card>
        );

      default:
        return <LoadingState />;
    }
  };

  return (
    <DashboardSidebarLayout
      user={user}
      logout={logout}
      role="Кондитер"
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

// Local import для toast (чтобы не было conflicts с sonner)
import { toast } from "sonner";
