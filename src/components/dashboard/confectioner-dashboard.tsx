"use client";

import { useAppStore } from "@/lib/store";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  ShoppingBag,
  Package,
  Coins,
  TrendingUp,
  Settings,
  LogOut,
  ChevronLeft,
  Star,
  MessageCircle,
  LayoutDashboard,
  Users,
  Calendar,
  Image as ImageIcon,
  Calculator,
  FileText,
  Utensils,
  Plus,
  Printer,
  Check,
  Clock,
  AlertCircle,
  ShieldCheck,
  Gift,
  ChefHat,
  Boxes,
  BellRing,
  Bell,
  CreditCard,
  Truck,
  MapPin,
  Target,
  Cake,
  Brain,
  Trophy,
  Camera,
  School,
  Store,
  User as UserIcon,
} from "lucide-react";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  TARIFFS,
  TRUST_LEVELS,
  LEGAL_STATUS_INFO,
  formatCurrency,
  formatDate,
  calculateCommission,
  calculateConfectionerPayout,
  calculateTaxByLegalStatus,
} from "@/lib/finance";
import { CONFECTIONER_ANALYTICS } from "@/lib/mock-data";
import {
  ConfectionerInventoryTab,
  ConfectionerGanttTab,
  ConfectionerRemindersTab,
} from "@/components/dashboard/confectioner-extra-tabs";
import { ConfectionerPaymentTab } from "@/components/dashboard/confectioner-payment-tab";
import { ConfectionerNegotiationTab } from "@/components/dashboard/negotiation-tabs";
import { ConfectionerChannelTab } from "@/components/dashboard/confectioner-channel-tab";
import { ConfectionerTastingTab } from "@/components/dashboard/confectioner-tasting-tab";
import { ConfectionerCatalogManager } from "@/components/dashboard/confectioner-catalog-manager";
import {
  ConfectionerPromotionsManager,
  ConfectionerRecipesManager,
} from "@/components/dashboard/confectioner-promotions-recipes-manager";
import { ConfectionerCalendarManager } from "@/components/dashboard/confectioner-calendar-manager";
import { TfaSettings } from "@/components/dashboard/tfa-settings";
import { ProfileSettings } from "@/components/dashboard/profile-settings";
import { VerificationStatusBanner } from "@/components/dashboard/verification-status-banner";
import {
  ConfectionerReviewsTab,
  ConfectionerClientsTab,
  ConfectionerMarketingTab,
  ConfectionerPrintingTab,
  ConfectionerDeliveryTab,
} from "@/components/dashboard/confectioner-extra-tabs-2";
import { ConfectionerRecipeStatsTab } from "@/components/dashboard/confectioner-recipe-stats-tab";
import { ConfectionerSimpleXTab } from "@/components/dashboard/confectioner-simplex-tab";
import { ConfectionerSliceEditorTab } from "@/components/dashboard/confectioner-slice-editor-tab";
import { BentoDashboard } from "@/components/dashboard/bento-dashboard";
import { PredictiveAnalyticsWidget } from "@/components/dashboard/predictive/predictive-analytics-widget";
import { ConfectionerAtelierTab } from "@/components/dashboard/confectioner-atelier-tab";
import { ConfectionerLessonsTab } from "@/components/dashboard/confectioner-lessons-tab";
import { GamificationWidget } from "@/components/gamification/gamification-widget";
import { AiPhotoGenerator } from "@/components/ai/ai-photo-generator";
import { toast } from "sonner";

export function ConfectionerDashboard() {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const confectioners = useAppStore((s) => s.confectioners);
  const orders = useAppStore((s) => s.orders);
  const allProducts = useAppStore((s) => s.products);
  const inquiries = useAppStore((s) => s.inquiries);
  const teamTasks = useAppStore((s) => s.teamTasks);
  const channelPosts = useAppStore((s) => s.channelPosts);
  const promotions = useAppStore((s) => s.promotions);
  const recipes = useAppStore((s) => s.recipes);
  const inventory = useAppStore((s) => s.inventory);
  const ganttTasks = useAppStore((s) => s.ganttTasks);
  const reminders = useAppStore((s) => s.reminders);
  const negotiations = useAppStore((s) => s.negotiations);
  const logout = useAppStore((s) => s.logout);
  const updateOrderStatus = useAppStore((s) => s.updateOrderStatus);
  const updateTaskStatus = useAppStore((s) => s.updateTaskStatus);
  const respondToInquiry = useAppStore((s) => s.respondToInquiry);

  const [activeTab, setActiveTab] = useState(
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("tab") || "overview"
      : "overview"
  );
  const [showTariffDialog, setShowTariffDialog] = useState(false);
  const updateConfectionerTariff = useAppStore((s) => s.updateConfectionerTariff);

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h2 className="font-display text-2xl font-bold mb-2">Войдите как кондитер</h2>
        <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>
          Войти
        </Button>
      </div>
    );
  }

  const confectioner = confectioners.find((c) => c.userId === user.id) || confectioners[0];
  const myOrders = orders.filter((o) => o.confectionerId === confectioner.id);
  const myProducts = allProducts.filter(
    (p) => p.confectionerId === confectioner.id
  );
  const myPosts = channelPosts.filter((p) => p.confectionerId === confectioner.id);

  const tariff = TARIFFS[confectioner.tariff];
  const trust = TRUST_LEVELS[confectioner.trustLevel] ?? TRUST_LEVELS.NEW;

  // Подсчёты для бейджей в sidebar
  const promotionsCount = promotions.filter(
    (p) => p.confectionerId === confectioner.id && p.status === "active"
  ).length;
  const recipesCount = recipes.filter((r) => r.confectionerId === confectioner.id).length;
  const lowStockCount = inventory.filter(
    (i) => i.confectionerId === confectioner.id && i.quantity <= i.minQuantity
  ).length;
  const activeOrdersCount = ganttTasks.filter(
    (t) => t.status === "in_progress" || t.status === "pending"
  ).length;
  const unreadRemindersCount = reminders.filter((r) => !r.isRead && !r.isDone).length;
  const negotiationsPendingCount = negotiations.filter(
    (n) => n.confectionerId === confectioner.id && n.status === "pending_confectioner"
  ).length;

  const totalRevenue = myOrders
    .filter((o) => o.paymentStatus === "released")
    .reduce((sum, o) => sum + o.total, 0);
  const pendingPayout = myOrders
    .filter((o) => o.paymentStatus === "escrow")
    .reduce((sum, o) => sum + o.total, 0);

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="container mx-auto px-4 py-6">
        <button
          onClick={() => navigate("home")}
          className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
          На главную
        </button>

        <div className="grid lg:grid-cols-[260px_1fr] gap-4 lg:gap-6">
          {/* Sidebar */}
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <Card className="p-3 lg:p-4">
              <div className="flex items-center gap-3 mb-3 lg:mb-4">
                <Avatar className="h-10 w-10 lg:h-12 lg:w-12 shrink-0">
                  <AvatarImage src={confectioner.avatar} alt={confectioner.businessName} />
                  <AvatarFallback>{confectioner.businessName.slice(0, 2)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{confectioner.businessName}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Check className="h-3 w-3 text-primary" />
                    {trust.label} • {tariff.name}
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <SidebarTab icon={LayoutDashboard} label="Обзор" active={activeTab === "overview"} onClick={() => setActiveTab("overview")} />
                <SidebarTab icon={ShoppingBag} label="Заказы" badge={String(myOrders.length)} active={activeTab === "orders"} onClick={() => setActiveTab("orders")} />
                <SidebarTab icon={Package} label="Каталог" badge={String(myProducts.length)} active={activeTab === "products"} onClick={() => setActiveTab("products")} />
                <SidebarTab icon={Coins} label="Финансы" active={activeTab === "finance"} onClick={() => setActiveTab("finance")} />
                <SidebarTab icon={Calculator} label="НПД и налоги" active={activeTab === "tax"} onClick={() => setActiveTab("tax")} />
                <SidebarTab icon={Gift} label="Акции" badge={String(promotionsCount)} active={activeTab === "promotions"} onClick={() => setActiveTab("promotions")} />
                <SidebarTab icon={ChefHat} label="Рецепты" badge={String(recipesCount)} active={activeTab === "recipes"} onClick={() => setActiveTab("recipes")} />
                <SidebarTab icon={Target} label="Статистика рецептов" active={activeTab === "recipe-stats"} onClick={() => setActiveTab("recipe-stats")} />
                <SidebarTab icon={Cake} label="Срезы тортов" active={activeTab === "slices"} onClick={() => setActiveTab("slices")} />
                <SidebarTab icon={Brain} label="Прогноз спроса (AI)" active={activeTab === "predictions"} onClick={() => setActiveTab("predictions")} />
                <SidebarTab icon={Camera} label="AI-фото тортов" active={activeTab === "ai-photo"} onClick={() => setActiveTab("ai-photo")} />
                <SidebarTab icon={Trophy} label="Бейджи и челленджи" active={activeTab === "gamification"} onClick={() => setActiveTab("gamification")} />
                <SidebarTab icon={ShieldCheck} label="SimpleX (E2E)" active={activeTab === "simplex"} onClick={() => setActiveTab("simplex")} />
                <SidebarTab icon={Boxes} label="Склад" badge={String(lowStockCount)} active={activeTab === "inventory"} onClick={() => setActiveTab("inventory")} />
                <SidebarTab icon={Calendar} label="Производство" badge={String(activeOrdersCount)} active={activeTab === "gantt"} onClick={() => setActiveTab("gantt")} />
                <SidebarTab icon={BellRing} label="Напоминания" badge={String(unreadRemindersCount)} active={activeTab === "reminders"} onClick={() => setActiveTab("reminders")} />
                <SidebarTab icon={MessageCircle} label="Заявки" badge={String(inquiries.length)} active={activeTab === "inquiries"} onClick={() => setActiveTab("inquiries")} />
                <SidebarTab icon={FileText} label="Согласование" badge={String(negotiationsPendingCount)} active={activeTab === "negotiations"} onClick={() => setActiveTab("negotiations")} />
                <SidebarTab icon={ImageIcon} label="Канал" badge={String(myPosts.length)} active={activeTab === "channel"} onClick={() => setActiveTab("channel")} />
                <SidebarTab icon={Utensils} label="Где попробовать" active={activeTab === "tasting"} onClick={() => setActiveTab("tasting")} />
                <SidebarTab icon={Star} label="Отзывы" active={activeTab === "reviews-cf"} onClick={() => setActiveTab("reviews-cf")} />
                <SidebarTab icon={Users} label="Клиенты (CRM)" active={activeTab === "clients"} onClick={() => setActiveTab("clients")} />
                <SidebarTab icon={Gift} label="Маркетинг" active={activeTab === "marketing"} onClick={() => setActiveTab("marketing")} />
                <SidebarTab icon={Printer} label="Печать на пряниках" active={activeTab === "printing-cf"} onClick={() => setActiveTab("printing-cf")} />
                <SidebarTab icon={Truck} label="Доставка" active={activeTab === "delivery"} onClick={() => setActiveTab("delivery")} />
                <SidebarTab icon={Users} label="Команда" active={activeTab === "team"} onClick={() => setActiveTab("team")} />
                <SidebarTab icon={TrendingUp} label="Аналитика" active={activeTab === "analytics"} onClick={() => setActiveTab("analytics")} />
                <SidebarTab icon={Calendar} label="Календарь" active={activeTab === "calendar"} onClick={() => setActiveTab("calendar")} />
                <SidebarTab icon={Store} label="Моё ателье" active={activeTab === "atelier"} onClick={() => setActiveTab("atelier")} />
                <SidebarTab icon={School} label="Уроки и МК" active={activeTab === "lessons"} onClick={() => setActiveTab("lessons")} />
                <SidebarTab icon={Settings} label="Настройки" active={activeTab === "settings"} onClick={() => setActiveTab("settings")} />
                <SidebarTab icon={CreditCard} label="Оплата и рассрочка" active={activeTab === "payment"} onClick={() => setActiveTab("payment")} />
              </div>

              <div className="pt-4 mt-4 border-t">
                <Button variant="ghost" size="sm" onClick={logout} className="w-full justify-start text-destructive">
                  <LogOut className="h-4 w-4 mr-2" />
                  Выйти
                </Button>
              </div>
            </Card>
          </aside>

          {/* Main */}
          <div>
            {activeTab === "overview" && (
              <BentoDashboard
                confectioner={confectioner}
                myOrders={myOrders}
                inquiries={inquiries}
                tariff={tariff}
                trust={trust}
                setActiveTab={setActiveTab}
                revenueData={CONFECTIONER_ANALYTICS.revenue}
              />
            )}

            {activeTab === "overview-legacy" && (
              <div className="space-y-4">
                <div>
                  <h1 className="font-display text-2xl font-bold mb-1">
                    Кабинет кондитера
                  </h1>
                  <p className="text-muted-foreground">
                    {confectioner.businessName} • {confectioner.city}
                  </p>
                </div>

                {/* Баннер статуса модерации (если не approved) */}
                <VerificationStatusBanner />

                {/* Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatCard icon={Coins} label="Баланс" value={formatCurrency(confectioner.balance || 0)} color="text-emerald-600 bg-emerald-100" />
                  <StatCard icon={TrendingUp} label="За месяц" value={formatCurrency(confectioner.monthlyEarnings || 0)} color="text-primary bg-primary/10" />
                  <StatCard icon={ShoppingBag} label="Активных заказов" value={String(myOrders.filter((o) => !["COMPLETED", "CANCELLED"].includes(o.status)).length)} color="text-amber-600 bg-amber-100" />
                  <StatCard icon={Star} label="Рейтинг" value={`${confectioner.rating.toFixed(1)} ★`} color="text-purple-600 bg-purple-100" />
                </div>

                {/* Trust & tariff */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <Card className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-muted-foreground">Уровень доверия</span>
                      <Badge className={trust.color}>{trust.label}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">{trust.description}</div>
                    <Progress value={(confectioner.ordersCount / 500) * 100} className="h-2" />
                    <div className="text-xs text-muted-foreground mt-1">
                      {confectioner.ordersCount} / 500 заказов до уровня Master
                    </div>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-muted-foreground">Тариф</span>
                      <Badge className="bg-primary/10 text-primary">{tariff.name}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Комиссия: {Math.round(tariff.commission * 100)}% + {Math.round(tariff.yookassa * 100)}% YooKassa
                    </div>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => setShowTariffDialog(true)}>
                      Сменить тариф
                    </Button>
                  </Card>
                </div>

                {/* Revenue chart */}
                <Card className="p-4">
                  <h3 className="font-semibold mb-3">Доход за 6 месяцев</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={CONFECTIONER_ANALYTICS.revenue}>
                      <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.90 0.015 70)" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="oklch(0.50 0.025 50)" />
                      <YAxis tick={{ fontSize: 12 }} stroke="oklch(0.50 0.025 50)" tickFormatter={(v) => `${v / 1000}k`} />
                      <Tooltip
                        formatter={(v: number) => [formatCurrency(v), "Доход"]}
                        contentStyle={{
                          backgroundColor: "oklch(1 0 0)",
                          border: "1px solid oklch(0.90 0.015 70)",
                          borderRadius: "8px",
                        }}
                      />
                      <Bar dataKey="value" fill="oklch(0.42 0.18 25)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>

                {/* Active orders */}
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">Активные заказы</h3>
                    <Button variant="ghost" size="sm" onClick={() => setActiveTab("orders")}>
                      Все заказы
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {myOrders
                      .filter((o) => !["COMPLETED", "CANCELLED"].includes(o.status))
                      .slice(0, 5)
                      .map((order) => {
                        const status = ORDER_STATUS_LABELS[order.status];
                        return (
                          <div key={order.id} className="flex items-center gap-3 p-3 border border-border rounded-lg">
                            <img src={order.items[0].image} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" decoding="async" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">{order.number}</div>
                              <div className="text-xs text-muted-foreground">
                                {order.customerName} • {formatDate(order.deliveryDate)}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-semibold text-sm">{formatCurrency(order.total)}</div>
                              <Badge variant="outline" className={`text-[10px] ${status.color}`}>
                                {status.label}
                              </Badge>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </Card>

                {/* Inquiries */}
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">Новые заявки из конструктора</h3>
                    <Button variant="ghost" size="sm" onClick={() => setActiveTab("inquiries")}>
                      Все заявки
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {inquiries.slice(0, 3).map((inq) => (
                      <div key={inq.id} className="flex items-center gap-3 p-3 border border-border rounded-lg">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={inq.customerAvatar} alt={inq.customerName} />
                          <AvatarFallback>{inq.customerName[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{inq.customerName}</div>
                          <div className="text-xs text-muted-foreground">
                            {inq.eventType} • {inq.servings} порц. • {inq.city}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">бюджет</div>
                          <div className="font-semibold text-sm">{formatCurrency(inq.budget)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {activeTab === "orders" && (
              <div className="space-y-4">
                <h1 className="font-display text-2xl font-bold">Заказы</h1>
                <div className="space-y-3">
                  {myOrders.map((order) => {
                    const status = ORDER_STATUS_LABELS[order.status];
                    const payment = PAYMENT_STATUS_LABELS[order.paymentStatus];
                    return (
                      <Card key={order.id} className="p-4">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
                          <div>
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-semibold">{order.number}</span>
                              <Badge variant="outline" className={`text-[10px] ${status.color}`}>{status.label}</Badge>
                              <Badge variant="secondary" className={`text-[10px] ${payment.color}`}>{payment.label}</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {order.customerName} • {formatDate(order.deliveryDate)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-display font-bold">{formatCurrency(order.total)}</div>
                            <div className="text-xs text-muted-foreground">комиссия: {formatCurrency(calculateCommission(order.total, confectioner.tariff).totalFee)}</div>
                          </div>
                        </div>
                        <div className="space-y-2 mb-3">
                          {order.items.map((item, i) => (
                            <div key={i} className="flex items-center gap-3 text-sm">
                              <img src={item.image} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" decoding="async" />
                              <div className="flex-1">
                                <div className="truncate">{item.title}</div>
                                {item.customization && (
                                  <div className="text-xs text-muted-foreground">
                                    {[item.customization.filling, item.customization.coating, item.customization.inscription && `«${item.customization.inscription}»`].filter(Boolean).join(" • ")}
                                  </div>
                                )}
                              </div>
                              <div className="text-muted-foreground">{item.quantity} шт</div>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {order.status === "PENDING" && (
                            <Button size="sm" onClick={() => updateOrderStatus(order.id, "CONFIRMED")}>
                              <Check className="h-4 w-4 mr-1" />
                              Подтвердить
                            </Button>
                          )}
                          {order.status === "CONFIRMED" && (
                            <Button size="sm" onClick={() => updateOrderStatus(order.id, "IN_PROGRESS")}>
                              Начать готовку
                            </Button>
                          )}
                          {order.status === "IN_PROGRESS" && (
                            <Button size="sm" onClick={() => updateOrderStatus(order.id, "READY")}>
                              <Check className="h-4 w-4 mr-1" />
                              Готово
                            </Button>
                          )}
                          {order.status === "READY" && (
                            <Button size="sm" onClick={() => updateOrderStatus(order.id, "DELIVERING")}>
                              <Truck className="h-4 w-4 mr-1" />
                              Передать курьеру
                            </Button>
                          )}
                          <Button size="sm" variant="outline">
                            <MessageCircle className="h-4 w-4 mr-1" />
                            Чат
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === "products" && (
              <ConfectionerCatalogManager confectionerId={confectioner.id} />
            )}

            {activeTab === "finance" && (
              <div className="space-y-4">
                <h1 className="font-display text-2xl font-bold">Финансы</h1>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatCard icon={Coins} label="Доступно к выводу" value={formatCurrency(confectioner.balance || 0)} color="text-emerald-600 bg-emerald-100" />
                  <StatCard icon={Clock} label="В эскроу" value={formatCurrency(pendingPayout)} color="text-amber-600 bg-amber-100" />
                  <StatCard icon={TrendingUp} label="За месяц" value={formatCurrency(confectioner.monthlyEarnings || 0)} color="text-primary bg-primary/10" />
                  <StatCard icon={FileText} label="За всё время" value={formatCurrency(confectioner.totalEarnings || 0)} color="text-purple-600 bg-purple-100" />
                </div>

                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">Транзакции</h3>
                    <Button size="sm" variant="outline">Вывести средства</Button>
                  </div>
                  <div className="space-y-2">
                    {myOrders.map((o) => {
                      const payout = calculateConfectionerPayout(o.total, confectioner);
                      return (
                        <div key={o.id} className="flex items-center justify-between p-3 border border-border rounded-lg text-sm">
                          <div>
                            <div className="font-medium">{o.number}</div>
                            <div className="text-xs text-muted-foreground">{formatDate(o.createdAt)} • {o.customerName}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">{payout.taxDetails}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-emerald-600">+{formatCurrency(payout.netPayout)}</div>
                            <div className="text-xs text-muted-foreground">
                              комиссия {formatCurrency(payout.platformCommission + payout.yookassaFee)} • налог {formatCurrency(payout.tax)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            )}

            {activeTab === "tax" && (
              <div className="space-y-4">
                <h1 className="font-display text-2xl font-bold">Налоги и отчётность</h1>

                {/* Юридический статус */}
                <Card className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">Юридический статус</div>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{LEGAL_STATUS_INFO[confectioner.legalInfo.status].icon}</span>
                        <div>
                          <div className="font-display font-bold text-lg">
                            {LEGAL_STATUS_INFO[confectioner.legalInfo.status].label}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {LEGAL_STATUS_INFO[confectioner.legalInfo.status].description}
                          </div>
                        </div>
                      </div>
                    </div>
                    {confectioner.legalInfo.documentsVerified && (
                      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
                        <ShieldCheck className="h-3 w-3 mr-1" />
                        Верифицирован
                      </Badge>
                    )}
                  </div>

                  {/* Реквизиты */}
                  <div className="grid sm:grid-cols-2 gap-3 mt-4 p-3 bg-muted/30 rounded-lg">
                    {confectioner.legalInfo.inn && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">ИНН:</span>{" "}
                        <span className="font-mono font-medium">{confectioner.legalInfo.inn}</span>
                      </div>
                    )}
                    {confectioner.legalInfo.ipOgrnip && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">ОГРНИП:</span>{" "}
                        <span className="font-mono font-medium">{confectioner.legalInfo.ipOgrnip}</span>
                      </div>
                    )}
                    {confectioner.legalInfo.ipUsnRate && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">УСН:</span>{" "}
                        <span className="font-medium">{confectioner.legalInfo.ipUsnRate}</span>
                      </div>
                    )}
                    {confectioner.legalInfo.oooOgrn && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">ОГРН:</span>{" "}
                        <span className="font-mono font-medium">{confectioner.legalInfo.oooOgrn}</span>
                      </div>
                    )}
                    {confectioner.legalInfo.oooInn && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">ИНН ООО:</span>{" "}
                        <span className="font-mono font-medium">{confectioner.legalInfo.oooInn}</span>
                      </div>
                    )}
                    {confectioner.legalInfo.oooKpp && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">КПП:</span>{" "}
                        <span className="font-mono font-medium">{confectioner.legalInfo.oooKpp}</span>
                      </div>
                    )}
                    {confectioner.legalInfo.oooTaxSystem && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">СНО:</span>{" "}
                        <span className="font-medium">
                          {confectioner.legalInfo.oooTaxSystem === "OSNO"
                            ? "ОСНО"
                            : confectioner.legalInfo.oooTaxSystem === "USN_6"
                            ? "УСН 6%"
                            : confectioner.legalInfo.oooTaxSystem === "USN_15"
                            ? "УСН 15%"
                            : "ОСНО + НДС"}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Налоговые ставки */}
                  <div className="grid sm:grid-cols-2 gap-3 mt-4">
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <div className="text-xs text-muted-foreground">Ставка с физлиц</div>
                      <div className="font-display text-xl font-bold">
                        {Math.round(LEGAL_STATUS_INFO[confectioner.legalInfo.status].taxRateIndividual * 100)}%
                      </div>
                      {confectioner.legalInfo.status === "NPD" && (
                        <div className="text-xs text-emerald-600">3% (с вычетом 10 000 ₽)</div>
                      )}
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <div className="text-xs text-muted-foreground">Ставка с юрлиц</div>
                      <div className="font-display text-xl font-bold">
                        {Math.round(LEGAL_STATUS_INFO[confectioner.legalInfo.status].taxRateLegal * 100)}%
                      </div>
                      {confectioner.legalInfo.status === "NPD" && (
                        <div className="text-xs text-emerald-600">4% (с вычетом 10 000 ₽)</div>
                      )}
                    </div>
                  </div>

                  {/* Лимит */}
                  {LEGAL_STATUS_INFO[confectioner.legalInfo.status].maxAnnualIncome && (
                    <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="text-xs text-amber-700 flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-medium">
                            Лимит дохода: {formatCurrency(LEGAL_STATUS_INFO[confectioner.legalInfo.status].maxAnnualIncome!)}/год
                          </div>
                          <div>
                            {confectioner.legalInfo.status === "NPD"
                              ? "При превышении необходимо перейти на ИП или ОСНО"
                              : "При превышении регистрация как самозанятый невозможна"}
                          </div>
                          <div className="mt-2">
                            <div className="flex justify-between text-[10px] mb-1">
                              <span>Заработано в году:</span>
                              <span>{formatCurrency(confectioner.totalEarnings || 0)} / {formatCurrency(LEGAL_STATUS_INFO[confectioner.legalInfo.status].maxAnnualIncome!)}</span>
                            </div>
                            <div className="h-1.5 bg-amber-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-amber-500"
                                style={{
                                  width: `${Math.min(100, ((confectioner.totalEarnings || 0) / LEGAL_STATUS_INFO[confectioner.legalInfo.status].maxAnnualIncome!) * 100)}%`,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Для ИП — страховые взносы */}
                  {confectioner.legalInfo.status === "IP" && (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="text-xs text-blue-800">
                        <div className="font-medium flex items-center gap-1.5">
                          <AlertCircle className="h-4 w-4" />
                          Страховые взносы ИП за себя (2026)
                        </div>
                        <div className="mt-1 space-y-0.5">
                          <div>• Фиксированные взносы: <strong>53 400 ₽/год</strong> (4 450 ₽/мес)</div>
                          <div>• 1% с дохода свыше 300 000 ₽</div>
                          <div>• Взносы уменьшают налог УСН</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Для ООО — НДС */}
                  {(confectioner.legalInfo.status === "OOO" && confectioner.legalInfo.oooTaxSystem === "VAT") && (
                    <div className="mt-3 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                      <div className="text-xs text-purple-800">
                        <div className="font-medium flex items-center gap-1.5">
                          <AlertCircle className="h-4 w-4" />
                          ООО на ОСНО с НДС
                        </div>
                        <div className="mt-1 space-y-0.5">
                          <div>• НДС 20% включается в стоимость</div>
                          <div>• Налог на прибыль 20%</div>
                          <div>• Можно работать с плательщиками НДС</div>
                          <div>• Требуется полная бухгалтерия</div>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>

                {/* Расчёт налогов по типам клиентов */}
                <Card className="p-4">
                  <h3 className="font-semibold mb-3">Калькулятор налогов</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Расчёт для заказа на 5 000 ₽ (после комиссии платформы)
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {[false, true].map((isLegal) => {
                      const amount = 4250; // ~5000 - 15% commission
                      const tax = calculateTaxByLegalStatus(amount, confectioner.legalInfo, isLegal);
                      return (
                        <div key={String(isLegal)} className="p-3 border border-border rounded-lg">
                          <div className="text-xs text-muted-foreground mb-1">
                            {isLegal ? "Заказ от юрлица (B2B)" : "Заказ от физлица"}
                          </div>
                          <div className="font-display text-xl font-bold text-primary">
                            {formatCurrency(tax.tax)}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {tax.details}
                          </div>
                          <div className="mt-2 pt-2 border-t flex justify-between text-xs">
                            <span className="text-muted-foreground">К выплате:</span>
                            <span className="font-semibold text-emerald-600">{formatCurrency(amount - tax.tax)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* Отчёт */}
                <Card className="p-4">
                  <h3 className="font-semibold mb-3">
                    Налоговый отчёт за июнь 2026 — {LEGAL_STATUS_INFO[confectioner.legalInfo.status].shortLabel}
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Доход от физлиц</span>
                      <span className="font-medium">{formatCurrency(145000)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Доход от юрлиц</span>
                      <span className="font-medium">{formatCurrency(39000)}</span>
                    </div>
                    <div className="border-t my-2" />
                    {(() => {
                      const taxInd = calculateTaxByLegalStatus(145000, confectioner.legalInfo, false);
                      const taxLegal = calculateTaxByLegalStatus(39000, confectioner.legalInfo, true);
                      return (
                        <>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              Налог с физлиц ({Math.round(taxInd.rate * 100)}%)
                            </span>
                            <span className="font-medium text-primary">{formatCurrency(taxInd.tax)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              Налог с юрлиц ({Math.round(taxLegal.rate * 100)}%)
                            </span>
                            <span className="font-medium text-primary">{formatCurrency(taxLegal.tax)}</span>
                          </div>
                        </>
                      );
                    })()}
                    <div className="flex justify-between font-semibold text-base pt-2 border-t">
                      <span>Итого к уплате</span>
                      <span className="text-primary">
                        {formatCurrency(
                          calculateTaxByLegalStatus(145000, confectioner.legalInfo, false).tax +
                            calculateTaxByLegalStatus(39000, confectioner.legalInfo, true).tax
                        )}
                      </span>
                    </div>
                  </div>
                  <Button className="w-full mt-4">
                    {confectioner.legalInfo.status === "NPD"
                      ? "Сформировать чеки НПД"
                      : confectioner.legalInfo.status === "IP"
                      ? "Сформировать декларацию УСН"
                      : "Сформировать декларацию"}
                  </Button>
                </Card>
              </div>
            )}

            {activeTab === "promotions" && (
              <ConfectionerPromotionsManager confectionerId={confectioner.id} />
            )}

            {activeTab === "recipes" && (
              <ConfectionerRecipesManager confectionerId={confectioner.id} />
            )}

            {activeTab === "inventory" && (
              <ConfectionerInventoryTab confectionerId={confectioner.id} />
            )}

            {activeTab === "gantt" && <ConfectionerGanttTab />}

            {activeTab === "reminders" && <ConfectionerRemindersTab />}

            {activeTab === "negotiations" && (
              <ConfectionerNegotiationTab confectionerId={confectioner.id} />
            )}

            {activeTab === "inquiries" && (
              <div className="space-y-4">
                <h1 className="font-display text-2xl font-bold">Заявки из конструктора</h1>
                <div className="space-y-3">
                  {inquiries.map((inq) => (
                    <Card key={inq.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={inq.customerAvatar} alt={inq.customerName} />
                          <AvatarFallback>{inq.customerName[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold">{inq.customerName}</span>
                            <Badge variant={inq.status === "new" ? "default" : "secondary"} className="text-[10px]">
                              {inq.status === "new" ? "Новая" : "Отвечена"}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground mb-2">
                            {inq.eventType} • {inq.base} • {inq.filling} • {inq.servings} порц. • {inq.city}
                          </div>
                          {inq.comment && (
                            <div className="text-sm text-muted-foreground mb-2 p-2 bg-muted/50 rounded">
                              {inq.comment}
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Бюджет клиента:</span>
                            <span className="font-semibold">{formatCurrency(inq.budget)}</span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 shrink-0">
                          <Button
                            size="sm"
                            onClick={() => {
                              respondToInquiry(inq.id, inq.budget);
                              toast.success("Предложение отправлено!", {
                                description: `Цена: ${formatCurrency(inq.budget)}`,
                              });
                            }}
                          >
                            Откликнуться
                          </Button>
                          <Button size="sm" variant="outline">Отклонить</Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "channel" && (
              <ConfectionerChannelTab confectionerId={confectioner.id} />
            )}

            {activeTab === "tasting" && (
              <ConfectionerTastingTab confectionerId={confectioner.id} city={confectioner.city || "Москва"} />
            )}

            {activeTab === "reviews-cf" && (
              <ConfectionerReviewsTab confectionerId={confectioner.id} />
            )}

            {activeTab === "clients" && (
              <ConfectionerClientsTab confectionerId={confectioner.id} />
            )}

            {activeTab === "marketing" && (
              <ConfectionerMarketingTab confectionerId={confectioner.id} confectionerName={confectioner.businessName} />
            )}

            {activeTab === "printing-cf" && (
              <ConfectionerPrintingTab confectionerId={confectioner.id} confectionerName={confectioner.businessName} />
            )}

            {activeTab === "delivery" && (
              <ConfectionerDeliveryTab confectionerId={confectioner.id} city={confectioner.city || "Москва"} />
            )}

            {activeTab === "team" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h1 className="font-display text-2xl font-bold">Команда студии</h1>
                  <Button onClick={() => toast.info("Пригласить участника")}>
                    <Plus className="h-4 w-4 mr-1" />
                    Пригласить
                  </Button>
                </div>

                <Card className="p-4">
                  <h3 className="font-semibold mb-3">Канбан-доска задач</h3>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      { status: "todo", label: "К выполнению", color: "bg-slate-100 text-slate-700" },
                      { status: "in_progress", label: "В работе", color: "bg-blue-100 text-blue-700" },
                      { status: "review", label: "На проверке", color: "bg-amber-100 text-amber-700" },
                      { status: "done", label: "Готово", color: "bg-emerald-100 text-emerald-700" },
                    ].map((col) => (
                      <div key={col.status}>
                        <div className={`text-xs font-semibold px-2 py-1 rounded mb-2 ${col.color}`}>
                          {col.label}
                        </div>
                        <div className="space-y-2">
                          {teamTasks
                            .filter((t) => t.status === col.status)
                            .map((task) => (
                              <Card key={task.id} className="p-3">
                                <div className="text-sm font-medium mb-1">{task.title}</div>
                                <div className="text-xs text-muted-foreground">
                                  {task.assignee} • {task.deadline}
                                </div>
                                <div className="flex items-center justify-between mt-2">
                                  <Badge
                                    variant="outline"
                                    className={
                                      task.priority === "high"
                                        ? "text-red-600 border-red-200"
                                        : task.priority === "medium"
                                        ? "text-amber-600 border-amber-200"
                                        : "text-emerald-600 border-emerald-200"
                                    }
                                  >
                                    {task.priority === "high" ? "Высокий" : task.priority === "medium" ? "Средний" : "Низкий"}
                                  </Badge>
                                  <select
                                    className="text-xs border border-border rounded px-1 py-0.5 bg-background"
                                    value={task.status}
                                    onChange={(e) => updateTaskStatus(task.id, e.target.value)}
                                  >
                                    <option value="todo">К выполнению</option>
                                    <option value="in_progress">В работе</option>
                                    <option value="review">На проверке</option>
                                    <option value="done">Готово</option>
                                  </select>
                                </div>
                              </Card>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {activeTab === "analytics" && (
              <div className="space-y-4">
                <h1 className="font-display text-2xl font-bold">Аналитика</h1>
                <div className="grid lg:grid-cols-2 gap-4">
                  <Card className="p-4">
                    <h3 className="font-semibold mb-3">Доход по месяцам</h3>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={CONFECTIONER_ANALYTICS.revenue}>
                        <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.90 0.015 70)" />
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v / 1000}k`} />
                        <Tooltip formatter={(v: number) => [formatCurrency(v), "Доход"]} />
                        <Bar dataKey="value" fill="oklch(0.42 0.18 25)" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                  <Card className="p-4">
                    <h3 className="font-semibold mb-3">Заказы по статусам</h3>
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie
                          data={CONFECTIONER_ANALYTICS.ordersByStatus}
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          dataKey="value"
                          label={(entry) => `${entry.name}: ${entry.value}`}
                        >
                          {CONFECTIONER_ANALYTICS.ordersByStatus.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </Card>
                </div>

                <Card className="p-4">
                  <h3 className="font-semibold mb-3">Топ товаров</h3>
                  <div className="space-y-2">
                    {CONFECTIONER_ANALYTICS.topProducts.map((p, i) => (
                      <div key={i} className="flex items-center gap-3 p-2 border border-border rounded">
                        <div className="font-display font-bold text-lg text-muted-foreground w-6">
                          {i + 1}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-sm">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.sold} продаж</div>
                        </div>
                        <div className="font-semibold text-sm">{formatCurrency(p.revenue)}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {activeTab === "recipe-stats" && (
              <ConfectionerRecipeStatsTab confectionerId={confectioner.id} />
            )}

            {activeTab === "slices" && (
              <ConfectionerSliceEditorTab />
            )}

            {activeTab === "predictions" && (
              <PredictiveAnalyticsWidget />
            )}

            {activeTab === "ai-photo" && (
              <div className="space-y-4">
                <h1 className="font-display text-2xl font-bold">AI-фото тортов</h1>
                <AiPhotoGenerator />
              </div>
            )}

            {activeTab === "gamification" && (
              <div className="space-y-4">
                <h1 className="font-display text-2xl font-bold flex items-center gap-2">
                  <Trophy className="h-6 w-6 text-amber-500" />
                  Бейджи и челленджи
                </h1>
                <GamificationWidget />
              </div>
            )}

            {activeTab === "simplex" && (
              <ConfectionerSimpleXTab />
            )}

            {activeTab === "calendar" && (
              <ConfectionerCalendarManager confectionerId={confectioner.id} />
            )}

            {activeTab === "atelier" && (
              <ConfectionerAtelierTab userId={user?.id || "u2"} />
            )}

            {activeTab === "lessons" && (
              <ConfectionerLessonsTab userId={user?.id || "u2"} />
            )}

            {activeTab === "settings" && (
              <div className="space-y-4">
                <ProfileSettings />
                {/* 2FA — защита выплат */}
                <TfaSettings />
              </div>
            )}

            {activeTab === "payment" && (
              <ConfectionerPaymentTab confectionerId={confectioner.id} />
            )}
          </div>

          {/* Диалог смены тарифа */}
          {showTariffDialog && (
            <Dialog open onOpenChange={setShowTariffDialog}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Смена тарифа</DialogTitle>
                  <DialogDescription>
                    Выберите подходящий тариф. Комиссия включает все услуги платформы.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  {Object.entries(TARIFFS).map(([key, t]) => (
                    <button
                      key={key}
                      onClick={() => {
                        updateConfectionerTariff(confectioner.id, key as any);
                        toast.success(`Тариф изменён на «${t.name}»!`, {
                          description: `Комиссия: ${Math.round(t.commission * 100)}% + ${Math.round(t.yookassa * 100)}% YooKassa`,
                        });
                        setShowTariffDialog(false);
                      }}
                      className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                        confectioner.tariff === key
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="font-display font-bold text-lg">{t.name}</div>
                        {confectioner.tariff === key && (
                          <Badge className="bg-primary text-primary-foreground text-[10px]">
                            Текущий
                          </Badge>
                        )}
                      </div>
                      <div className="text-2xl font-bold text-primary">
                        {Math.round(t.commission * 100)}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        + {Math.round(t.yookassa * 100)}% YooKassa
                        {t.monthly > 0 && ` + ${formatCurrency(t.monthly)}/мес`}
                      </div>
                      <ul className="text-xs text-muted-foreground mt-2 space-y-0.5">
                        {t.benefits.map((b) => (
                          <li key={b}>✓ {b}</li>
                        ))}
                      </ul>
                    </button>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground text-center">
                  Смена тарифа вступает в силу со следующего заказа.
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>
    </div>
  );
}

function SidebarTab({
  icon: Icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: typeof UserIcon;
  label: string;
  active: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
        active ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent text-foreground/80"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {badge && <Badge variant="secondary" className="text-[10px]">{badge}</Badge>}
    </button>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof UserIcon;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <Card className="p-4">
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center mb-2 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="font-display font-bold text-lg">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}
