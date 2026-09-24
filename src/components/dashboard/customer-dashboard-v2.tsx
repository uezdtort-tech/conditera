"use client";

/**
 * customer-dashboard-v2.tsx — дашборд покупателя на supabase-js (v2.0).
 *
 * Использует useCustomerDashboard() — прямые supabase-js запросы.
 * Показывает: заказы, избранное, бонусы, переговоры.
 */

import * as React from "react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Package, Heart, Coins, TrendingUp, Clock, Star, Settings, LogOut,
  ChevronLeft, ShoppingBag, Gift, MessageSquare, Calendar,
} from "lucide-react";
import { formatCurrency, formatDate, ORDER_STATUS_LABELS } from "@/lib/finance";
import {
  DashboardSidebarLayout, SidebarStat, LoadingState, ErrorState,
} from "@/components/dashboard/_shared";
import { useCustomerDashboard } from "@/lib/supabase/use-dashboards";

const TABS = [
  { id: "overview", label: "Обзор", icon: Package },
  { id: "orders", label: "Заказы", icon: ShoppingBag },
  { id: "favorites", label: "Избранное", icon: Heart },
  { id: "inquiries", label: "Запросы", icon: MessageSquare, badge: "0" },
  { id: "bonuses", label: "Бонусы", icon: Coins },
  { id: "settings", label: "Настройки", icon: Settings },
];

export function CustomerDashboardV2(): React.JSX.Element {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const [activeTab, setActiveTab] = React.useState("overview");

  const { data, isLoading, error, refetch } = useCustomerDashboard();

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>Войти</Button>
      </div>
    );
  }

  const content = (): React.JSX.Element => {
    if (isLoading) return <LoadingState message="Загружаем ваши данные..." />;
    if (error) return <ErrorState error={error as Error} onRetry={() => refetch()} />;

    const stats = data?.stats;
    const recentOrders = data?.recentOrders || [];
    const favorites = data?.favorites || [];
    const inquiries = data?.activeInquiriesList || [];

    switch (activeTab) {
      case "overview":
        return (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="font-display text-2xl font-bold">Личный кабинет</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Добро пожаловать, {user.name}!
                </p>
              </div>
              <Badge variant="outline" className="bg-amber-50">
                <Star className="h-3 w-3 mr-1 fill-amber-400 text-amber-400" />
                {stats?.loyaltyLevel || "BRONZE"}
              </Badge>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SidebarStat icon={ShoppingBag} label="Активных заказов" value={String(stats?.activeOrders || 0)} color="text-blue-600 bg-blue-100" />
              <SidebarStat icon={Coins} label="Бонусов" value={String(stats?.bonusBalance || 0)} color="text-amber-600 bg-amber-100" />
              <SidebarStat icon={Heart} label="В избранном" value={String(stats?.favoritesCount || 0)} color="text-rose-600 bg-rose-100" />
              <SidebarStat icon={MessageSquare} label="Переговоры" value={String(stats?.activeNegotiations || 0)} color="text-purple-600 bg-purple-100" />
            </div>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Последние заказы</h3>
              <div className="space-y-2">
                {recentOrders.slice(0, 5).map((order) => (
                  <div key={order.id} className="flex items-center justify-between p-2 border border-border rounded text-sm">
                    <div>
                      <div className="font-medium">{order.number}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(order.created_at)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{formatCurrency(order.total)}</div>
                      <Badge variant="outline" className="text-[10px]">{order.status}</Badge>
                    </div>
                  </div>
                ))}
                {recentOrders.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Пока нет заказов. <a href="/catalog" className="text-primary hover:underline">Посмотреть каталог →</a>
                  </p>
                )}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Активные запросы на торт</h3>
              <div className="space-y-2">
                {inquiries.map((inq) => (
                  <div key={inq.id} className="flex items-center justify-between p-2 border border-border rounded text-sm">
                    <div>
                      <div className="font-medium">{inq.event_type || "Индивидуальный"}</div>
                      <div className="text-xs text-muted-foreground">
                        {inq.city} • {inq.negotiations_count} предлож.
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline" className="text-[10px]">{inq.status}</Badge>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Истекает: {formatDate(inq.expires_at)}
                      </div>
                    </div>
                  </div>
                ))}
                {inquiries.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Нет активных запросов. <a href="/" className="text-primary hover:underline">Создать запрос через конструктор →</a>
                  </p>
                )}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Избранные товары</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {favorites.slice(0, 4).map((fav) => (
                  <div key={fav.id} className="p-2 border border-border rounded">
                    <div className="aspect-square rounded bg-muted mb-1" />
                    <div className="text-xs font-medium line-clamp-2">{fav.product?.title || "—"}</div>
                    <div className="text-xs text-primary font-semibold mt-1">
                      {fav.product ? formatCurrency(fav.product.price) : "—"}
                    </div>
                  </div>
                ))}
                {favorites.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 col-span-full text-center">
                    Избранное пусто. Добавляйте товары через ❤
                  </p>
                )}
              </div>
            </Card>
          </div>
        );

      case "orders":
        return (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">Мои заказы</h1>
            <div className="space-y-3">
              {recentOrders.map((order) => (
                <Card key={order.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{order.number}</div>
                      <div className="text-sm text-muted-foreground">{formatDate(order.created_at)}</div>
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
              {recentOrders.length === 0 && (
                <Card className="p-8 text-center">
                  <ShoppingBag className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">У вас пока нет заказов</p>
                </Card>
              )}
            </div>
          </div>
        );

      case "favorites":
        return (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">Избранное ({favorites.length})</h1>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {favorites.map((fav) => (
                <Card key={fav.id} className="p-3">
                  <div className="aspect-square rounded bg-muted mb-2" />
                  <div className="font-medium text-sm line-clamp-2">{fav.product?.title || "—"}</div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-semibold">{fav.product ? formatCurrency(fav.product.price) : "—"}</span>
                    <Button size="sm" variant="ghost"><Heart className="h-4 w-4 fill-rose-500 text-rose-500" /></Button>
                  </div>
                </Card>
              ))}
              {favorites.length === 0 && (
                <Card className="p-12 text-center col-span-full">
                  <Heart className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">В избранном пока нет товаров</p>
                </Card>
              )}
            </div>
          </div>
        );

      case "inquiries":
        return (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">Запросы на индивидуальный торт</h1>
            <Card className="p-4">
              <div className="space-y-3">
                {inquiries.map((inq) => (
                  <div key={inq.id} className="p-3 border border-border rounded">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium">{inq.event_type || "Индивидуальный"}</div>
                      <Badge variant="outline">{inq.status}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Город: {inq.city || "—"} • {inq.negotiations_count} предложений
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Истекает: {formatDate(inq.expires_at)}
                    </div>
                  </div>
                ))}
                {inquiries.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Нет активных запросов
                  </p>
                )}
              </div>
            </Card>
          </div>
        );

      case "bonuses":
        return (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">Бонусы и лояльность</h1>
            <Card className="p-6">
              <div className="text-center">
                <div className="text-4xl font-display font-bold text-amber-600">
                  {stats?.bonusBalance || 0}
                </div>
                <div className="text-sm text-muted-foreground mt-1">бонусов</div>
                <Badge variant="outline" className="mt-3">
                  <Star className="h-3 w-3 mr-1 fill-amber-400 text-amber-400" />
                  Уровень: {stats?.loyaltyLevel || "BRONZE"}
                </Badge>
              </div>
            </Card>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SidebarStat icon={TrendingUp} label="Всего потрачено" value={formatCurrency(stats?.totalSpent || 0)} color="text-emerald-600 bg-emerald-100" />
              <SidebarStat icon={ShoppingBag} label="Заказов" value={String(stats?.completedOrders || 0)} color="text-blue-600 bg-blue-100" />
              <SidebarStat icon={Gift} label="Бонусов" value={String(stats?.bonusBalance || 0)} color="text-amber-600 bg-amber-100" />
              <SidebarStat icon={Calendar} label="До следующего уровня" value="— дней" color="text-purple-600 bg-purple-100" />
            </div>
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Уровни лояльности</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between p-2 rounded bg-amber-50">
                  <span>🥉 BRONZE</span>
                  <span className="text-muted-foreground">0+ бонусов · 3% кэшбэк</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-slate-100">
                  <span>🥈 SILVER</span>
                  <span className="text-muted-foreground">10 000+ · 5% кэшбэк</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-yellow-50">
                  <span>🥇 GOLD</span>
                  <span className="text-muted-foreground">50 000+ · 7% кэшбэк</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-purple-50">
                  <span>💎 PLATINUM</span>
                  <span className="text-muted-foreground">200 000+ · 10% кэшбэк</span>
                </div>
              </div>
            </Card>
          </div>
        );

      case "settings":
        return (
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Настройки профиля</h3>
            <p className="text-sm text-muted-foreground">
              Открыть полные настройки профиля через кнопку ниже.
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
      role="Покупатель"
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
