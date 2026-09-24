"use client";

/**
 * BentoDashboard — современный Bento Grid обзор дашборда кондитера.
 *
 * Заменяет одинаковые табы на сетку карточек разного размера (как Apple/Linear):
 *   - Крупная KPI-карточка (баланс) — 2 cols × 2 rows
 *   - Средние (заказы, рейтинг) — 1×1
 *   - График — 2×1
 *   - Быстрые действия — 1×2
 *
 * Адаптив: на mobile — 1 колонка, на sm — 2, на lg — 4 колонки.
 */
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import {
  Coins, TrendingUp, ShoppingBag, Star, MessageCircle, ChefHat,
  Package, Calendar, Bell, ShieldCheck, Sparkles, ArrowRight,
  Zap, Heart, Users, Clock, AlertCircle, ChevronRight,
} from "lucide-react";
import { formatCurrency } from "@/lib/finance";

interface BentoDashboardProps {
  confectioner: any;
  myOrders: any[];
  inquiries: any[];
  tariff: any;
  trust: any;
  setActiveTab: (tab: string) => void;
  revenueData: any[];
}

export function BentoDashboard({
  confectioner,
  myOrders,
  inquiries,
  tariff,
  trust,
  setActiveTab,
  revenueData,
}: BentoDashboardProps) {
  const activeOrders = myOrders.filter((o) => !["COMPLETED", "CANCELLED"].includes(o.status));
  const pendingInquiries = inquiries.filter((i: any) => i.status === "new" || !i.status);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold mb-1">
            Кабинет кондитера
          </h1>
          <p className="text-muted-foreground flex items-center gap-2">
            {confectioner.businessName} • {confectioner.city}
            <Badge variant="outline" className="text-[10px]">
              <Clock className="h-2.5 w-2.5 mr-1" />
              обновлено только что
            </Badge>
          </p>
        </div>
        <Button onClick={() => setActiveTab("orders")} className="gap-2">
          <Zap className="h-4 w-4" />
          Быстрые действия
        </Button>
      </div>

      {/* === Bento Grid === */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 auto-rows-[minmax(140px,auto)]">

        {/* Balance — крупная (2×2) */}
        <Card
          className="sm:col-span-2 sm:row-span-2 p-5 bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 text-white border-0 relative overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setActiveTab("finance")}
        >
          {/* Декоративные круги */}
          <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-white/10" />
          <div className="absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-white/5" />

          <div className="relative z-10 h-full flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
                  <Coins className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium opacity-90">Баланс</span>
              </div>
              <Badge className="bg-white/20 text-white border-0">
                <TrendingUp className="h-3 w-3 mr-1" />
                +{formatCurrency(confectioner.monthlyEarnings || 0)}
              </Badge>
            </div>

            <div className="flex-1 flex flex-col justify-center">
              <div className="text-4xl lg:text-5xl font-display font-bold">
                {formatCurrency(confectioner.balance || 0)}
              </div>
              <div className="text-sm opacity-80 mt-1">доступно к выводу</div>
            </div>

            <div className="flex gap-2 mt-3">
              <Button
                size="sm"
                variant="secondary"
                className="bg-white text-emerald-700 hover:bg-white/90"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab("finance");
                }}
              >
                Вывести
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-white hover:bg-white/20"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab("finance");
                }}
              >
                История
                <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </div>
        </Card>

        {/* Активные заказы — средняя (1×1) */}
        <Card
          className="p-4 cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => setActiveTab("orders")}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center">
              <ShoppingBag className="h-4 w-4 text-amber-600" />
            </div>
            <Badge variant="outline" className="text-[10px]">
              активных
            </Badge>
          </div>
          <div className="text-3xl font-display font-bold">{activeOrders.length}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {pendingInquiries.length > 0 && (
              <span className="text-amber-600">
                +{pendingInquiries.length} новых заявок
              </span>
            )}
            {pendingInquiries.length === 0 && "нет новых заявок"}
          </div>
        </Card>

        {/* Рейтинг — средняя (1×1) */}
        <Card
          className="p-4 cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => setActiveTab("reviews-cf")}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="h-8 w-8 rounded-lg bg-purple-100 flex items-center justify-center">
              <Star className="h-4 w-4 text-purple-600" />
            </div>
            <Badge variant="outline" className="text-[10px]">
              {confectioner.reviewsCount} отз.
            </Badge>
          </div>
          <div className="text-3xl font-display font-bold flex items-center gap-1">
            {confectioner.rating.toFixed(1)}
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
          </div>
          <div className="text-xs text-muted-foreground mt-1">средняя оценка</div>
        </Card>

        {/* Уровень доверия — широкая (2×1) */}
        <Card className="sm:col-span-2 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium">Уровень доверия</span>
            </div>
            <Badge className={trust.color}>{trust.label}</Badge>
          </div>
          <div className="text-xs text-muted-foreground mb-2">{trust.description}</div>
          <Progress value={Math.min(100, (confectioner.ordersCount / 500) * 100)} className="h-2 mb-1" />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{confectioner.ordersCount} заказов</span>
            <span>500 до Master</span>
          </div>
        </Card>

        {/* График дохода — широкая (2×1) */}
        <Card className="sm:col-span-2 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Доход за 6 месяцев</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setActiveTab("analytics")}
              className="h-6 text-[10px] gap-0.5"
            >
              Подробнее
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={revenueData}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.90 0.015 70)" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="oklch(0.50 0.025 50)" />
              <YAxis tick={{ fontSize: 10 }} stroke="oklch(0.50 0.025 50)" tickFormatter={(v) => `${v / 1000}k`} />
              <Tooltip
                formatter={(v: number) => [formatCurrency(v), "Доход"]}
                contentStyle={{ fontSize: 11, borderRadius: 8 }}
              />
              <Bar dataKey="value" fill="oklch(0.42 0.18 25)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Тариф — средняя (1×1) */}
        <Card
          className="p-4 cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => setActiveTab("settings")}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-lg font-display font-bold">{tariff.name}</div>
          <div className="text-xs text-muted-foreground mt-1">
            Комиссия {Math.round(tariff.commission * 100)}%
          </div>
        </Card>

        {/* Чат — средняя (1×1) */}
        <Card
          className="p-4 cursor-pointer hover:border-primary/40 transition-colors relative"
          onClick={() => setActiveTab("inquiries")}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <MessageCircle className="h-4 w-4 text-blue-600" />
            </div>
            {pendingInquiries.length > 0 && (
              <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            )}
          </div>
          <div className="text-lg font-display font-bold">{pendingInquiries.length}</div>
          <div className="text-xs text-muted-foreground mt-1">новых заявок</div>
        </Card>

        {/* Каталог — широкая (2×1) */}
        <Card
          className="sm:col-span-2 p-4 cursor-pointer hover:border-primary/40 transition-colors group"
          onClick={() => setActiveTab("products")}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Каталог товаров</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Sparkles className="h-3 w-3" />
              AI-фото
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-1.5 mb-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="aspect-square rounded bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center"
              >
                <ChefHat className="h-4 w-4 text-primary/40" />
              </div>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">
            Управление товарами, ценами, наличием
          </div>
        </Card>

        {/* Календарь — средняя (1×1) */}
        <Card
          className="p-4 cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => setActiveTab("calendar")}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="h-8 w-8 rounded-lg bg-pink-100 flex items-center justify-center">
              <Calendar className="h-4 w-4 text-pink-600" />
            </div>
          </div>
          <div className="text-lg font-display font-bold">7</div>
          <div className="text-xs text-muted-foreground mt-1">заказов на неделе</div>
        </Card>

        {/* Напоминания — средняя (1×1) */}
        <Card
          className="p-4 cursor-pointer hover:border-primary/40 transition-colors relative"
          onClick={() => setActiveTab("reminders")}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="h-8 w-8 rounded-lg bg-orange-100 flex items-center justify-center">
              <Bell className="h-4 w-4 text-orange-600" />
            </div>
            <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-red-500" />
          </div>
          <div className="text-lg font-display font-bold">3</div>
          <div className="text-xs text-muted-foreground mt-1">напоминаний</div>
        </Card>

        {/* SimpleX (E2E) — широкая (2×1) с premium-стилем */}
        <Card
          className="sm:col-span-2 p-4 cursor-pointer hover:border-emerald-400 transition-colors bg-gradient-to-r from-emerald-50 to-primary/5 border-emerald-200"
          onClick={() => setActiveTab("simplex")}
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">SimpleX (E2E-чат)</span>
                <Badge className="bg-emerald-100 text-emerald-800 text-[9px]">PREMIUM</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Приватный канал для премиум-клиентов
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </Card>

        {/* Срезы тортов — средняя (1×1) */}
        <Card
          className="p-4 cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => setActiveTab("slices")}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="h-8 w-8 rounded-lg bg-purple-100 flex items-center justify-center">
              <ChefHat className="h-4 w-4 text-purple-600" />
            </div>
            <Badge variant="outline" className="text-[9px]">NEW</Badge>
          </div>
          <div className="text-sm font-display font-bold">Срезы тортов</div>
          <div className="text-xs text-muted-foreground mt-1">по начинкам</div>
        </Card>

        {/* Подписчики — средняя (1×1) */}
        <Card
          className="p-4 cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => setActiveTab("channel")}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="h-8 w-8 rounded-lg bg-rose-100 flex items-center justify-center">
              <Users className="h-4 w-4 text-rose-600" />
            </div>
            <Heart className="h-3.5 w-3.5 text-red-400 fill-red-400" />
          </div>
          <div className="text-lg font-display font-bold">{confectioner.followersCount || 0}</div>
          <div className="text-xs text-muted-foreground mt-1">подписчиков</div>
        </Card>
      </div>

      {/* Активные заказы (список) — полная ширина */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Активные заказы</h3>
          <Button variant="ghost" size="sm" onClick={() => setActiveTab("orders")}>
            Все заказы
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
        {activeOrders.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <ShoppingBag className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Нет активных заказов</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeOrders.slice(0, 3).map((order: any) => (
              <div
                key={order.id}
                className="flex items-center gap-3 p-2 border border-border rounded-lg hover:border-primary/30 cursor-pointer transition-colors"
                onClick={() => setActiveTab("orders")}
              >
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <ShoppingBag className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    Заказ #{order.id.slice(-6)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {order.status} · {formatCurrency(order.total || 0)}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Подсказка про AI-фото */}
      <Card className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-sm">Новая функция: AI-фото тортов</span>
              <Badge variant="outline" className="text-[9px] bg-purple-100 text-purple-700 border-purple-200">
                NEW
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Опишите торт словами — AI сгенерирует профессиональное фото для карточки товара.
              Без профессиональной съёмки, за 30 секунд.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setActiveTab("products")}
              className="gap-1"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Попробовать
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
