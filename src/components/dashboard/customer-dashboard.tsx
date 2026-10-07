"use client";

import { useAppStore } from "@/lib/store";
import { useState, useEffect, useRef } from "react";
import type { Order } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  ShoppingBag,
  Heart,
  Award,
  User,
  Settings,
  LogOut,
  ChevronLeft,
  Star,
  Package,
  Coins,
  TrendingUp,
  MessageCircle,
  MapPin,
  Gift,
  Building2,
  Calendar,
  CalendarDays,
  Users,
  Navigation,
  FileText,
  Bell,
} from "lucide-react";
import { ProductCard } from "@/components/marketplace/product-card";
import { VenueBookingsManager } from "@/components/dashboard/venue-bookings-manager";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  LOYALTY,
  formatCurrency,
  formatDate,
} from "@/lib/finance";
import { MOCK_PRODUCTS } from "@/lib/mock-data";
import {
  CustomerHolidaysTab,
  CustomerReferralTab,
  CustomerTrackingTab,
} from "@/components/dashboard/customer-features-tabs";
import {
  CustomerLoyaltyTab,
  CustomerNotificationsTab,
} from "@/components/dashboard/customer-loyalty-notifications-tabs";
import { CustomerNegotiationTab } from "@/components/dashboard/negotiation-tabs";
import { OrderTimeline } from "@/components/dashboard/order-timeline";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ProfileSettings } from "@/components/dashboard/profile-settings";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  useRealOrders,
  useCreateRefundRequest,
  useRefunds,
  type RefundRow,
  type OrderPaymentInfo,
} from "@/lib/use-real-orders";
import { getSessionAuthHeaders, getCsrfToken } from "@/lib/api-client";
import { ensureChatRoom } from "@/components/chat/chat-api";
import { openChatForOrder } from "@/components/chat/chat-order-bridge";
import { RotateCcw, AlertTriangle, ShoppingCart, X, Loader2, ImagePlus, Clock } from "lucide-react";
import type { Product } from "@/lib/types";

export function CustomerDashboard() {
  const navigate = useAppStore((s) => s.navigate);
  const nav = useAppStore((s) => s.nav);
  const user = useAppStore((s) => s.user);
  const storeOrders = useAppStore((s) => s.orders);
  const favorites = useAppStore((s) => s.favorites);
  const negotiations = useAppStore((s) => s.negotiations);
  const products = useAppStore((s) => s.products);
  const logout = useAppStore((s) => s.logout);
  const setChatOpen = useAppStore((s) => s.setChatOpen);

  // Реальные заказы (GET /api/orders). Fallback на store-заказы только если API недоступен.
  const { orders: realOrders, isStale: ordersStale } = useRealOrders();
  const orders = ordersStale ? storeOrders : realOrders || storeOrders;

  // Вкладка: nav.params (SPA-навигация) → URL (?tab= из колокола уведомлений) → overview
  const [activeTab, setActiveTab] = useState(
    nav.params?.tab ||
      (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("tab")
        : null) ||
      "overview"
  );
  // Переход из колокола (?tab=orders&orderId=X): подсветка/скролл к заказу (ТЗ §10)
  const [highlightOrderId] = useState(
    () =>
      nav.params?.orderId ||
      (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("orderId")
        : null) ||
      null
  );
  // Диалог возврата (реальная заявка через POST /api/payment/refund)
  const [refundOrder, setRefundOrder] = useState<(typeof orders)[number] | null>(null);
  // Реальные заявки на возврат по заказам (для бейджей статуса)
  const { data: refundsData } = useRefunds();

  // ===== P1: отзыв / проблема / повтор / отмена / чат / избранное =====
  const queryClient = useQueryClient();
  const [reviewOrder, setReviewOrder] = useState<Order | null>(null);
  const [problemOrder, setProblemOrder] = useState<Order | null>(null);
  const [repeatData, setRepeatData] = useState<RepeatResponse | null>(null);
  const [openingChatOrderId, setOpeningChatOrderId] = useState<string | null>(null);

  // Мои отзывы — состояние «Отзыв отправлен» (переживает перезагрузку)
  const { data: myReviews } = useQuery({
    queryKey: ["reviews-mine", user?.id ?? null],
    queryFn: async () => {
      const headers = await getSessionAuthHeaders();
      const res = await fetch("/api/reviews?mine=1", { headers, credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { reviews: { id: string; orderId: string | null; productId?: string | null }[] };
    },
    enabled: !!user,
    staleTime: 60_000,
    retry: 1,
  });

  // Скролл к заказу, открытому из колокола уведомлений (когда заказы загрузятся)
  useEffect(() => {
    if (!highlightOrderId || activeTab !== "orders") return;
    const el = document.getElementById(`order-card-${highlightOrderId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightOrderId, activeTab, orders.length]);

  // Мои обращения в поддержку (бейдж «Есть проблема» по order_id)
  const { data: myTickets } = useQuery({
    queryKey: ["tickets-own", user?.id ?? null],
    queryFn: async () => {
      const headers = await getSessionAuthHeaders();
      const res = await fetch("/api/crm/tickets?filter=own", { headers, credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as {
        tickets: { id: string; number?: string | null; order_id: string | null; status: string }[];
      };
    },
    enabled: !!user,
    staleTime: 30_000,
    retry: 1,
  });

  // Избранное с сервера (product_favorites); localStorage — фолбэк для анонима
  const { data: wishlistData, isError: wishlistError } = useQuery({
    queryKey: ["wishlist", user?.id ?? null],
    queryFn: async () => {
      const headers = await getSessionAuthHeaders();
      const res = await fetch("/api/wishlist", { headers, credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { items: WishlistItem[]; total: number };
    },
    enabled: !!user,
    staleTime: 30_000,
    retry: 1,
  });

  // Отмена заказа (POST /api/orders/[id]/cancel — с возвратом денег, если оплачен)
  const cancelOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch(`/api/orders/${orderId}/cancel`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders-real"] });
      toast.success("Заказ отменён", {
        description: "Если заказ был оплачен — деньги вернутся автоматически",
      });
    },
    onError: (error: Error) => {
      toast.error("Не удалось отменить заказ", { description: error.message });
    },
  });

  // Повтор заказа: сервер возвращает позиции с АКТУАЛЬНЫМИ ценами и
  // доступностью — заказ НЕ создаётся молча (ТЗ §13)
  const repeatOrderMutation = useMutation({
    mutationFn: async (orderId: string): Promise<RepeatResponse> => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch(`/api/orders/${orderId}/repeat`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => null)) as
        | (RepeatResponse & { error?: string; message?: string })
        | null;
      if (!res.ok) {
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      }
      return body as RepeatResponse;
    },
    onSuccess: (data) => {
      const items = data.items || [];
      if (items.length === 0) {
        toast.error("В заказе нет позиций, которые можно повторить");
        return;
      }
      const available = items.filter((i) => i.available);
      const hasPriceChange = items.some((i) => i.available && i.unitPrice !== i.oldPrice);
      const hasUnavailable = available.length < items.length;
      if (available.length > 0 && !hasUnavailable && !hasPriceChange) {
        // Всё доступно и цены не изменились — сразу в корзину
        addRepeatItemsToCart(data.orderNumber, available);
        toast.success("Товары добавлены в корзину");
      } else {
        // Есть изменения цен или недоступные позиции — показываем диалог
        setRepeatData(data);
      }
    },
    onError: (error: Error) => {
      toast.error("Не удалось повторить заказ", { description: error.message });
    },
  });

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h2 className="font-display text-2xl font-bold mb-2">Войдите в аккаунт</h2>
        <Button
          onClick={() => useAppStore.getState().setAuthModalOpen(true)}
        >
          Войти
        </Button>
      </div>
    );
  }

  const myOrders = orders.filter((o) => o.customerId === user.id);
  const refundsByOrder = new Map<string, RefundRow[]>();
  for (const r of refundsData?.refunds || []) {
    const arr = refundsByOrder.get(r.order_id) || [];
    arr.push(r);
    refundsByOrder.set(r.order_id, arr);
  }

  // Отзывы по заказам (order_id → отправлен?) и открытые обращения (order_id → тикет)
  const reviewedOrderIds = new Set(
    (myReviews?.reviews || []).map((r) => r.orderId).filter(Boolean) as string[]
  );
  // Товары, на которые отзыв уже есть: повторная покупка не запрашивает отзыв
  // повторно (ТЗ §15 «Повторно отправлять запрос не нужно» + UNIQUE product+user)
  const reviewedProductIds = new Set(
    (myReviews?.reviews || []).map((r) => r.productId).filter(Boolean) as string[]
  );
  const TICKET_BADGES: Record<string, string> = {
    open: "Обращение открыто",
    in_progress: "Обращение в работе",
    waiting: "Ожидает ответа поддержки",
  };
  const openTicketsByOrder = new Map<string, string>();
  for (const t of myTickets?.tickets || []) {
    if (t.order_id && TICKET_BADGES[t.status] && !openTicketsByOrder.has(t.order_id)) {
      openTicketsByOrder.set(t.order_id, TICKET_BADGES[t.status]);
    }
  }

  // Избранное: серверные карточки, при ошибке/анониме — localStorage-фолбэк
  const serverWishlist = !wishlistError ? wishlistData?.items || null : null;
  const favoritesCount = serverWishlist ? serverWishlist.length : favorites.length;

  /** Чат по заказу: find-or-create order-комната → ChatWidget (initialOrderId) */
  async function openOrderChat(orderId: string) {
    setOpeningChatOrderId(orderId);
    try {
      const room = await ensureChatRoom({ type: "order", orderId });
      if (!room) {
        toast.error("Чат временно недоступен");
        return;
      }
      openChatForOrder(orderId);
      useAppStore.getState().setChatOpen(true);
    } finally {
      setOpeningChatOrderId(null);
    }
  }

  /** Добавить доступные позиции повтора в корзину (с кастомизацией из заказа) */
  function addRepeatItemsToCart(orderNumber: string, items: RepeatItem[]) {
    const addToCart = useAppStore.getState().addToCart;
    const original = orders.find((o) => o.number === orderNumber);
    for (const it of items) {
      const origItem = original?.items.find((o) => o.productId === it.productId);
      const customization = origItem?.customization
        ? {
            filling: origItem.customization.filling || undefined,
            coating: origItem.customization.coating || undefined,
            decoration: origItem.customization.decoration || undefined,
            inscription: origItem.customization.inscription || undefined,
          }
        : undefined;
      const product = {
        id: it.productId,
        title: it.title,
        slug: it.productId,
        description: "",
        price: it.unitPrice,
        category: "cakes",
        images: it.image ? [it.image] : [],
        confectionerId: original?.confectionerId || "",
        rating: 0,
        reviewsCount: 0,
      } as Product;
      addToCart(product, customization, it.quantity);
    }
    setRepeatData(null);
  }
  const favoriteProducts = products.filter((p) => favorites.includes(p.id));
  const negotiationsPendingCount = negotiations.filter((n) => n.status === "pending_customer").length;

  const totalSpent = myOrders
    .filter((o) => o.paymentStatus === "released" || o.paymentStatus === "escrow")
    .reduce((sum, o) => sum + o.total, 0);
  const loyaltyLevel = user.loyaltyLevel || "BRONZE";
  const nextLevel = loyaltyLevel === "BRONZE" ? "SILVER" : loyaltyLevel === "SILVER" ? "GOLD" : loyaltyLevel === "GOLD" ? "PLATINUM" : null;
  const nextLevelThreshold = nextLevel ? LOYALTY[nextLevel as keyof typeof LOYALTY].minSpent : 0;
  const progressToNext = nextLevel ? Math.min(100, (totalSpent / nextLevelThreshold) * 100) : 100;

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

        <div className="grid grid-cols-1 min-w-0 lg:grid-cols-[280px_1fr] gap-6">
          {/* Sidebar */}
          <aside className="min-w-0">
            <Card className="p-4 sticky top-20">
              <div className="flex items-center gap-3 mb-4">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback>{user.name.slice(0, 2)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{user.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {user.email}
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <SidebarTab
                  icon={User}
                  label="Обзор"
                  active={activeTab === "overview"}
                  onClick={() => setActiveTab("overview")}
                />
                <SidebarTab
                  icon={Package}
                  label="Мои заказы"
                  badge={String(myOrders.length)}
                  active={activeTab === "orders"}
                  onClick={() => setActiveTab("orders")}
                />
                <SidebarTab
                  icon={Heart}
                  label="Избранное"
                  badge={String(favoritesCount)}
                  active={activeTab === "favorites"}
                  onClick={() => setActiveTab("favorites")}
                />
                <SidebarTab
                  icon={Award}
                  label="Лояльность"
                  active={activeTab === "loyalty"}
                  onClick={() => setActiveTab("loyalty")}
                />
                <SidebarTab
                  icon={MessageCircle}
                  label="Сообщения"
                  active={activeTab === "messages"}
                  onClick={() => {
                    setActiveTab("messages");
                    setChatOpen(true);
                  }}
                />
                <SidebarTab
                  icon={Building2}
                  label="Организация"
                  active={activeTab === "organization"}
                  onClick={() => setActiveTab("organization")}
                />
                <SidebarTab
                  icon={Calendar}
                  label="Праздники"
                  active={activeTab === "holidays"}
                  onClick={() => setActiveTab("holidays")}
                />
                <SidebarTab
                  icon={FileText}
                  label="Согласование"
                  badge={String(negotiationsPendingCount)}
                  active={activeTab === "negotiations"}
                  onClick={() => setActiveTab("negotiations")}
                />
                <SidebarTab
                  icon={Users}
                  label="Рефералка"
                  active={activeTab === "referral"}
                  onClick={() => setActiveTab("referral")}
                />
                <SidebarTab
                  icon={Navigation}
                  label="Трекинг"
                  active={activeTab === "tracking"}
                  onClick={() => setActiveTab("tracking")}
                />
                <SidebarTab
                  icon={MapPin}
                  label="Адреса"
                  active={activeTab === "addresses"}
                  onClick={() => setActiveTab("addresses")}
                />
                <SidebarTab
                  icon={Bell}
                  label="Уведомления"
                  active={activeTab === "notifications"}
                  onClick={() => setActiveTab("notifications")}
                />
                <SidebarTab
                  icon={CalendarDays}
                  label="Брони площадок"
                  active={activeTab === "venueBookings"}
                  onClick={() => setActiveTab("venueBookings")}
                />
                <SidebarTab
                  icon={FileText}
                  label="Согласование"
                  badge={String(negotiationsPendingCount)}
                  active={activeTab === "negotiations"}
                  onClick={() => setActiveTab("negotiations")}
                />
                <SidebarTab
                  icon={Settings}
                  label="Настройки"
                  active={activeTab === "settings"}
                  onClick={() => setActiveTab("settings")}
                />
              </div>

              <div className="pt-4 mt-4 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  className="w-full justify-start text-destructive"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Выйти
                </Button>
              </div>
            </Card>
          </aside>

          {/* Main */}
          <div>
            {activeTab === "overview" && (
              <div className="space-y-4">
                <div>
                  <h1 className="font-display text-2xl font-bold mb-1">
                    Здравствуйте, {user.name.split(" ")[0]}! 👋
                  </h1>
                  <p className="text-muted-foreground">
                    Добро пожаловать в личный кабинет покупателя
                  </p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatCard
                    icon={ShoppingBag}
                    label="Заказов"
                    value={String(myOrders.length)}
                    color="text-primary bg-primary/10"
                  />
                  <StatCard
                    icon={Coins}
                    label="Бонусов"
                    value={String(user.bonusBalance || 0)}
                    color="text-amber-600 bg-amber-100"
                  />
                  <StatCard
                    icon={TrendingUp}
                    label="Потрачено"
                    value={formatCurrency(totalSpent)}
                    color="text-emerald-600 bg-emerald-100"
                  />
                  <StatCard
                    icon={Award}
                    label="Уровень"
                    value={LOYALTY[loyaltyLevel].name}
                    color="text-purple-600 bg-purple-100"
                  />
                </div>

                {/* Loyalty progress */}
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Award className="h-5 w-5 text-primary" />
                      <span className="font-semibold">Программа лояльности</span>
                    </div>
                    <Badge className="bg-primary/10 text-primary">
                      {LOYALTY[loyaltyLevel].name}
                    </Badge>
                  </div>
                  {nextLevel ? (
                    <>
                      <div className="text-sm text-muted-foreground mb-2">
                        До уровня «{LOYALTY[nextLevel as keyof typeof LOYALTY].name}»:{" "}
                        {formatCurrency(Math.max(0, nextLevelThreshold - totalSpent))}
                      </div>
                      <Progress value={progressToNext} className="h-2" />
                    </>
                  ) : (
                    <div className="text-sm text-emerald-600 font-medium">
                      Достигнут максимальный уровень! 🎉
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                    {Object.entries(LOYALTY).map(([key, l]) => (
                      <div
                        key={key}
                        className={`p-2 rounded-lg border text-center ${
                          loyaltyLevel === key
                            ? "border-primary bg-primary/5"
                            : "border-border"
                        }`}
                      >
                        <div className="font-medium text-xs">{l.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          от {formatCurrency(l.minSpent)}
                        </div>
                        {l.discount > 0 && (
                          <div className="text-[10px] text-emerald-600">
                            -{Math.round(l.discount * 100)}%
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Recent orders */}
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">Последние заказы</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setActiveTab("orders")}
                    >
                      Все заказы
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {myOrders.slice(0, 3).map((order) => {
                      const status = ORDER_STATUS_LABELS[order.status];
                      return (
                        <div
                          key={order.id}
                          className="flex items-center gap-3 p-3 border border-border rounded-lg"
                        >
                          {order.items[0]?.image ? (
                            <img
                              src={order.items[0].image}
                              alt=""
                              className="h-12 w-12 rounded object-cover" loading="lazy" decoding="async" />
                          ) : (
                            <div className="h-12 w-12 rounded bg-muted flex items-center justify-center text-muted-foreground" aria-hidden>
                              <Package className="h-5 w-5" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              {order.number}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {order.items.length} тов. • {formatDate(order.deliveryDate)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-sm">
                              {formatCurrency(order.total)}
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${status.color}`}
                            >
                              {status.label}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* Recommended */}
                <Card className="p-4">
                  <h3 className="font-semibold mb-3">Рекомендуем вам</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {MOCK_PRODUCTS.slice(0, 4).map((p) => (
                      <ProductCard key={p.id} product={p} variant="compact" />
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {activeTab === "orders" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h1 className="font-display text-2xl font-bold">Мои заказы</h1>
                  {ordersStale && (
                    <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                      Офлайн-данные (сервер недоступен)
                    </Badge>
                  )}
                </div>
                {myOrders.length === 0 ? (
                  <Card className="p-12 text-center">
                    <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                    <h3 className="font-semibold mb-1">Заказов пока нет</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Сделайте первый заказ в каталоге
                    </p>
                    <Button onClick={() => navigate("catalog")}>В каталог</Button>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {myOrders.map((order) => {
                      const status = ORDER_STATUS_LABELS[order.status];
                      const payment = PAYMENT_STATUS_LABELS[order.paymentStatus];
                      return (
                        <Card
                          key={order.id}
                          id={`order-card-${order.id}`}
                          className={`p-4 ${highlightOrderId === order.id ? "ring-2 ring-primary" : ""}`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold">{order.number}</span>
                                <Badge variant="outline" className={`text-[10px] ${status.color}`}>
                                  {status.label}
                                </Badge>
                                <Badge variant="secondary" className={`text-[10px] ${payment.color}`}>
                                  {payment.label}
                                </Badge>
                                {refundsByOrder.get(order.id)?.length ? (
                                  <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">
                                    Возврат: {REFUND_STATUS_LABELS[refundsByOrder.get(order.id)![0].status] || refundsByOrder.get(order.id)![0].status}
                                  </Badge>
                                ) : null}
                                {openTicketsByOrder.has(order.id) && (
                                  <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800 border-amber-200">
                                    <AlertTriangle className="h-3 w-3 mr-0.5" aria-hidden />
                                    {openTicketsByOrder.get(order.id)}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Создан {formatDate(order.createdAt)} • Доставка {formatDate(order.deliveryDate)}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-display font-bold">
                                {formatCurrency(order.total)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {order.paymentMethod === "card"
                                  ? "Картой"
                                  : order.paymentMethod === "cash"
                                  ? "Наличными"
                                  : "СБП"}
                              </div>
                            </div>
                          </div>
                          <div className="space-y-2">
                            {order.items.map((item, i) => (
                              <div key={i} className="flex items-center gap-3 text-sm">
                                <img
                                  src={item.image}
                                  alt=""
                                  className="h-10 w-10 rounded object-cover" loading="lazy" decoding="async" />
                                <div className="flex-1 min-w-0">
                                  <div className="truncate">{item.title}</div>
                                  {item.customization && (
                                    <div className="text-xs text-muted-foreground">
                                      {[
                                        item.customization.filling,
                                        item.customization.coating,
                                        item.customization.inscription &&
                                          `«${item.customization.inscription}»`,
                                      ]
                                        .filter(Boolean)
                                        .join(" • ")}
                                    </div>
                                  )}
                                </div>
                                <div className="text-muted-foreground">
                                  {item.quantity} × {formatCurrency(item.price)}
                                </div>
                              </div>
                            ))}
                          </div>
                          {order.deliveryAddress && (
                            <div className="mt-3 pt-3 border-t text-xs text-muted-foreground flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {order.deliveryAddress}
                            </div>
                          )}
                          {/* Timeline статусов заказа */}
                          <div className="mt-3">
                            <OrderTimeline
                              status={order.status}
                              createdAt={order.createdAt}
                              small
                            />
                          </div>
                          <div className="mt-3 flex gap-2 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openOrderChat(order.id)}
                              disabled={openingChatOrderId === order.id}
                            >
                              {openingChatOrderId === order.id ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />
                              ) : (
                                <MessageCircle className="h-4 w-4 mr-1" aria-hidden />
                              )}
                              Сообщение кондитеру
                            </Button>
                            {(order.status === "PENDING" || order.status === "CONFIRMED") && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                    disabled={
                                      cancelOrderMutation.isPending &&
                                      cancelOrderMutation.variables === order.id
                                    }
                                  >
                                    {cancelOrderMutation.isPending &&
                                    cancelOrderMutation.variables === order.id ? (
                                      <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />
                                    ) : (
                                      <X className="h-4 w-4 mr-1" aria-hidden />
                                    )}
                                    Отменить заказ
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Отменить заказ {order.number}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Заказ будет отменён, кондитер получит уведомление. Если заказ уже оплачен — деньги вернутся автоматически (срок зачисления зависит от банка).
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Вернуться</AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-red-600 text-white hover:bg-red-700"
                                      onClick={() => cancelOrderMutation.mutate(order.id)}
                                    >
                                      Да, отменить
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                            {(order.paymentStatus === "escrow" ||
                              order.paymentStatus === "released" ||
                              order.status === "DELIVERED" ||
                              order.status === "COMPLETED") &&
                              !refundsByOrder.get(order.id)?.length && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setRefundOrder(order)}
                                >
                                  <RotateCcw className="h-4 w-4 mr-1" aria-hidden />
                                  Возврат
                                </Button>
                              )}
                            {order.status !== "CANCELLED" && order.status !== "REFUNDED" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setProblemOrder(order)}
                              >
                                <AlertTriangle className="h-4 w-4 mr-1 text-amber-600" aria-hidden />
                                Есть проблема
                              </Button>
                            )}
                            {(order.status === "DELIVERED" || order.status === "COMPLETED") && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => repeatOrderMutation.mutate(order.id)}
                                disabled={
                                  repeatOrderMutation.isPending &&
                                  repeatOrderMutation.variables === order.id
                                }
                              >
                                {repeatOrderMutation.isPending &&
                                repeatOrderMutation.variables === order.id ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />
                                ) : (
                                  <ShoppingCart className="h-4 w-4 mr-1" aria-hidden />
                                )}
                                Повторить заказ
                              </Button>
                            )}
                            {(order.status === "DELIVERED" || order.status === "COMPLETED") &&
                              (reviewedOrderIds.has(order.id) ||
                                (order.items?.length &&
                                  order.items[0]?.productId &&
                                  reviewedProductIds.has(order.items[0].productId)) ? (
                                <Button size="sm" variant="outline" disabled>
                                  <Star className="h-4 w-4 mr-1 fill-amber-400 text-amber-400" aria-hidden />
                                  Отзыв отправлен
                                </Button>
                              ) : (
                                <Button size="sm" onClick={() => setReviewOrder(order)}>
                                  <Star className="h-4 w-4 mr-1" aria-hidden />
                                  Оставить отзыв
                                </Button>
                              ))}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === "favorites" && (
              <div className="space-y-4">
                <h1 className="font-display text-2xl font-bold">Избранное</h1>
                {serverWishlist && serverWishlist.length > 0 ? (
                  <WishlistGrid
                    items={serverWishlist}
                    onChanged={() =>
                      queryClient.invalidateQueries({ queryKey: ["wishlist", user.id] })
                    }
                  />
                ) : favoriteProducts.length === 0 ? (
                  <Card className="p-12 text-center">
                    <Heart className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                    <h3 className="font-semibold mb-1">Список пуст</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Добавляйте товары в избранное, чтобы вернуться к ним позже
                    </p>
                    <Button onClick={() => navigate("catalog")}>В каталог</Button>
                  </Card>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {favoriteProducts.map((p) => (
                      <ProductCard key={p.id} product={p} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "loyalty" && (
              <div className="space-y-4">
                <h1 className="font-display text-2xl font-bold">Программа лояльности</h1>
                <CustomerLoyaltyTab />
              </div>
            )}

            {activeTab === "notifications" && (
              <div className="space-y-4">
                <h1 className="font-display text-2xl font-bold">Уведомления</h1>
                <CustomerNotificationsTab />
              </div>
            )}

            {activeTab === "organization" && user.accountType === "legal" && user.legalInfo && (
              <div className="space-y-4">
                <h1 className="font-display text-2xl font-bold flex items-center gap-2">
                  <Building2 className="h-6 w-6 text-primary" />
                  Реквизиты организации
                </h1>
                <Card className="p-6">
                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    <Requisite label="Тип" value={user.legalInfo.type === "OOO" ? "ООО" : user.legalInfo.type === "IP" ? "ИП" : user.legalInfo.type} />
                    <Requisite label="Название" value={user.legalInfo.companyName} />
                    {user.legalInfo.fullName && (
                      <Requisite label="Полное наименование" value={user.legalInfo.fullName} />
                    )}
                    <Requisite label="ИНН" value={user.legalInfo.inn} />
                    {user.legalInfo.kpp && <Requisite label="КПП" value={user.legalInfo.kpp} />}
                    {user.legalInfo.ogrn && <Requisite label="ОГРН/ОГРНИП" value={user.legalInfo.ogrn} />}
                    <Requisite label="Юр. адрес" value={user.legalInfo.legalAddress} />
                    {user.legalInfo.bankAccount && (
                      <Requisite label="Расч. счёт" value={`••••${user.legalInfo.bankAccount.slice(-4)}`} />
                    )}
                    {user.legalInfo.bankName && (
                      <Requisite label="Банк" value={user.legalInfo.bankName} />
                    )}
                    {user.legalInfo.ceoName && (
                      <Requisite label="Руководитель" value={user.legalInfo.ceoName} />
                    )}
                    {user.legalInfo.taxSystem && (
                      <Requisite
                        label="Система налогообложения"
                        value={
                          user.legalInfo.taxSystem === "OSNO"
                            ? "ОСНО"
                            : user.legalInfo.taxSystem === "USN_6"
                            ? "УСН 6%"
                            : user.legalInfo.taxSystem === "USN_15"
                            ? "УСН 15%"
                            : "ОСНО с НДС"
                        }
                      />
                    )}
                    <Requisite
                      label="Работа с НДС"
                      value={user.legalInfo.hasVat ? "Да (20%)" : "Нет"}
                    />
                    <Requisite
                      label="Документы проверены"
                      value={user.legalInfo.documentsVerified ? `✓ ${user.legalInfo.verifiedAt || ""}` : "На проверке"}
                    />
                  </div>
                  <Button className="mt-4" onClick={() => toast.info("Форма редактирования реквизитов")}>
                    Редактировать реквизиты
                  </Button>
                </Card>

                <Card className="p-4">
                  <h3 className="font-semibold mb-2">Преимущества юрлица</h3>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Счета на оплату для бухгалтерии</li>
                    <li>• Счёт-фактура с НДС (если работаете с НДС)</li>
                    <li>• Акты выполненных работ</li>
                    <li>• Договоры</li>
                    <li>• Отсрочка платежа до 30 дней</li>
                    <li>• Доступ к корпоративным тендерам</li>
                  </ul>
                  <Button
                    variant="outline"
                    className="mt-3"
                    onClick={() => navigate("corporate-events")}
                  >
                    Корпоративные тендеры
                  </Button>
                </Card>
              </div>
            )}

            {activeTab === "organization" && (!user.accountType || user.accountType === "individual") && (
              <div className="space-y-4">
                <h1 className="font-display text-2xl font-bold">Организация</h1>
                <Card className="p-8 text-center">
                  <Building2 className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                  <h3 className="font-semibold mb-1">У вас физлицо</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Перейдите на аккаунт юридического лица, чтобы получать счета на оплату,
                    работать с НДС и участвовать в корпоративных тендерах.
                  </p>
                  <Button
                    onClick={() => {
                      useAppStore.getState().updateUserAccountType(user.id, "legal");
                      toast.success("Тип аккаунта изменён на «Юрлицо»");
                    }}
                  >
                    Стать юрлицом
                  </Button>
                </Card>
              </div>
            )}

            {activeTab === "addresses" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h1 className="font-display text-2xl font-bold">Мои адреса</h1>
                  <Button onClick={() => toast.info("Форма добавления адреса")}>
                    Добавить
                  </Button>
                </div>
                <Card className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold mb-1">Домашний</div>
                      <div className="text-sm text-muted-foreground">
                        {user.city}, ул. Тверская, д. 12, кв. 45
                      </div>
                    </div>
                    <Badge>По умолчанию</Badge>
                  </div>
                </Card>
              </div>
            )}

            {activeTab === "holidays" && <CustomerHolidaysTab />}
            {activeTab === "negotiations" && <CustomerNegotiationTab />}
            {activeTab === "referral" && <CustomerReferralTab />}
            {activeTab === "tracking" && <CustomerTrackingTab />}

            {activeTab === "venueBookings" && <VenueBookingsManager mode="customer" />}

            {activeTab === "settings" && (
              <ProfileSettings />
            )}
          </div>
        </div>
      </div>

      {/* Диалог заявки на возврат (реальный POST /api/payment/refund) */}
      <RefundRequestDialog order={refundOrder} onClose={() => setRefundOrder(null)} />
      {/* Отзыв по заказу (POST /api/reviews, ТЗ §15) */}
      <ReviewOrderDialog order={reviewOrder} onClose={() => setReviewOrder(null)} />
      {/* «Есть проблема» (POST /api/crm/tickets, ТЗ §16) */}
      <ProblemOrderDialog order={problemOrder} onClose={() => setProblemOrder(null)} />
      {/* Повтор заказа: цены/доступность изменились → подтверждение (ТЗ §13) */}
      <RepeatOrderDialog
        data={repeatData}
        onAdd={(items) => {
          addRepeatItemsToCart(repeatData?.orderNumber || "", items);
          toast.success("Товары добавлены в корзину");
        }}
        onClose={() => setRepeatData(null)}
      />
    </div>
  );
}

const REFUND_STATUS_LABELS: Record<string, string> = {
  requested: "На рассмотрении",
  approved: "Одобрен",
  processing: "В обработке у провайдера",
  processed: "Выполнен",
  rejected: "Отклонён",
};

/** Диалог заявки на возврат: причина + сумма (частичный возврат разрешён) */
function RefundRequestDialog({
  order,
  onClose,
}: {
  order: Order | null;
  onClose: () => void;
}) {
  const orderId = order?.id ?? null;
  const { data, isLoading } = useRefunds(orderId);
  const refundMutation = useCreateRefundRequest();
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState<string>("");

  const payment: OrderPaymentInfo | null = data?.payment ?? null;
  const refunds: RefundRow[] = data?.refunds ?? [];
  const alreadyRefunded =
    Number(payment?.refund_amount) ||
    refunds
      .filter((r) => r.status !== "rejected")
      .reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const maxRefund = payment
    ? Math.max(0, Number(payment.amount) - alreadyRefunded)
    : 0;
  const refundable = !!payment && payment.status === "succeeded" && maxRefund > 0;

  // Предзаполнение суммы при загрузке платежа (можно уменьшить для частичного возврата)
  useEffect(() => {
    if (payment && maxRefund > 0) {
      setAmount(String(maxRefund));
    }
  }, [payment?.id, maxRefund, payment]);

  function submit() {
    if (!order || !payment) return;
    const numAmount = Number(amount);
    if (!reason.trim()) {
      toast.error("Укажите причину возврата");
      return;
    }
    if (!Number.isFinite(numAmount) || numAmount <= 0 || numAmount > maxRefund) {
      toast.error(`Сумма возврата должна быть от 1 до ${maxRefund} ₽`);
      return;
    }
    refundMutation.mutate(
      { paymentId: payment.id, amount: numAmount, reason: reason.trim() },
      {
        onSuccess: (res) => {
          toast.success(res.message || "Заявка на возврат принята", {
            description: "Решение примет администратор",
          });
          setReason("");
          onClose();
        },
        onError: (e: Error) => {
          toast.error("Не удалось создать заявку на возврат", { description: e.message });
        },
      }
    );
  }

  return (
    <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Возврат по заказу {order?.number}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Загружаем данные платежа…</p>
        ) : !payment ? (
          <p className="text-sm text-muted-foreground py-4">
            Платёж для этого заказа не найден — возврат недоступен.
          </p>
        ) : payment.status !== "succeeded" ? (
          <p className="text-sm text-muted-foreground py-4">
            Возврат возможен только по оплаченному заказу. Текущий статус платежа: «{payment.status}».
          </p>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Оплачено: <span className="font-semibold text-foreground tnum">{formatCurrency(Number(payment.amount))}</span>
              {alreadyRefunded > 0 && (
                <> · Уже возвращено: <span className="tnum">{formatCurrency(alreadyRefunded)}</span></>
              )}
              <> · Доступно к возврату: <span className="font-semibold text-foreground tnum">{formatCurrency(maxRefund)}</span></>
            </div>

            <div>
              <Label className="mb-1.5 block">Причина возврата</Label>
              <Textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Опишите причину возврата"
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Сумма возврата, ₽</Label>
              <Input
                type="number"
                min={1}
                max={maxRefund}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Можно запросить частичный возврат (не больше доступной суммы).
              </p>
            </div>

            {refunds.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-1.5">
                {refunds.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-xs p-2 border border-border rounded">
                    <span className="tnum">{formatCurrency(Number(r.amount))}</span>
                    <span className="text-muted-foreground">
                      {REFUND_STATUS_LABELS[r.status] || r.status} · {formatDate(r.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={onClose} disabled={refundMutation.isPending}>
                Отмена
              </Button>
              <Button onClick={submit} disabled={refundMutation.isPending || !refundable}>
                {refundMutation.isPending ? "Отправляем…" : "Отправить заявку"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SidebarTab({
  icon: Icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: typeof User;
  label: string;
  active: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
        active
          ? "bg-primary/10 text-primary font-medium"
          : "hover:bg-accent text-foreground/80"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {badge && (
        <Badge variant="secondary" className="text-[10px]">
          {badge}
        </Badge>
      )}
    </button>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof User;
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

function Requisite({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center gap-2 py-1.5 border-b border-border last:border-0">
      <span className="text-muted-foreground text-xs">{label}:</span>
      <span className="font-mono text-xs font-medium text-right">{value}</span>
    </div>
  );
}

// ===== P1: типы контрактов клиентских API =====

/** Позиция повторного заказа (POST /api/orders/[id]/repeat) */
interface RepeatItem {
  productId: string;
  title: string;
  image: string;
  quantity: number;
  /** Актуальная серверная цена */
  unitPrice: number;
  /** Цена из старого заказа (snapshot) */
  oldPrice: number;
  available: boolean;
  unavailableReason?: string;
}

/** Ответ POST /api/orders/[id]/repeat — заказ НЕ создаётся (ТЗ §13) */
interface RepeatResponse {
  orderNumber: string;
  currency: string;
  items: RepeatItem[];
  message?: string;
}

/** Карточка избранного (GET /api/wishlist) */
interface WishlistItem {
  productId: string;
  id: string;
  title: string;
  price: number;
  images: string[];
  slug: string;
  available: boolean;
  addedAt: string;
}

const PROBLEM_REASONS: { value: string; label: string }[] = [
  { value: "product_quality", label: "Товар повреждён" },
  { value: "order_issue", label: "Заказ не соответствует" },
  { value: "delivery", label: "Проблема с доставкой" },
  { value: "other", label: "Другой вопрос" },
];

/** Загрузка ≤3 фото через существующий POST /api/upload (≤5 МБ на файл) */
function PhotoUploader({
  photos,
  onAdd,
  onRemove,
  category,
}: {
  photos: string[];
  onAdd: (url: string) => void;
  onRemove: (url: string) => void;
  category: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const max = 3;

  async function handleFiles(files: FileList | null) {
    if (!files?.length || photos.length >= max) return;
    const slots = max - photos.length;
    const chosen = Array.from(files).slice(0, slots);
    setUploading(true);
    try {
      for (const file of chosen) {
        if (file.size > 5 * 1024 * 1024) {
          toast.error(`${file.name}: файл больше 5 МБ`);
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        fd.append("category", category);
        fd.append("ownerType", "customer");
        const headers = await getSessionAuthHeaders(await getCsrfToken(), { json: false });
        const res = await fetch("/api/upload", {
          method: "POST",
          headers,
          credentials: "include",
          body: fd,
        });
        const data = (await res.json().catch(() => null)) as { url?: string; message?: string } | null;
        if (!res.ok || !data?.url) {
          throw new Error(data?.message || `HTTP ${res.status}`);
        }
        onAdd(data.url);
      }
    } catch (error) {
      toast.error("Не удалось загрузить фото", { description: (error as Error).message });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        {photos.map((url) => (
          <div key={url} className="relative h-16 w-16 rounded border border-border overflow-hidden">
            { }
            <img src={url} alt="Приложенное фото" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onRemove(url)}
              className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-background/90 flex items-center justify-center hover:bg-background"
              aria-label="Удалить фото"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
        ))}
        {photos.length < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="h-16 w-16 rounded border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50"
            aria-label="Добавить фото"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <>
                <ImagePlus className="h-4 w-4" aria-hidden />
                <span className="text-[10px] mt-0.5">Фото</span>
              </>
            )}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <p className="text-[11px] text-muted-foreground mt-1">
        До {max} фото, JPEG/PNG/WebP, по 5 МБ (необязательно)
      </p>
    </div>
  );
}

/** Отзыв по завершённому заказу (ТЗ §15): звёзды, текст, ≤3 фото */
function ReviewOrderDialog({
  order,
  onClose,
}: {
  order: Order | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);

  // Сброс формы при открытии диалога с новым заказом
  useEffect(() => {
    if (order) {
      setRating(0);
      setHoverRating(0);
      setText("");
      setPhotos([]);
    }
  }, [order]);

  const mutation = useMutation({
    mutationFn: async () => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          orderId: order!.id,
          rating,
          text: text.trim(),
          photos,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { message?: string; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      }
      return body as { message?: string };
    },
    onSuccess: (data) => {
      toast.success(data.message || "Спасибо за отзыв!", {
        description: "Он появится в карточке товара",
      });
      queryClient.invalidateQueries({ queryKey: ["reviews-mine"] });
      onClose();
    },
    onError: (error: Error) => {
      // 409 «уже оставляли» — синхронизируем состояние кнопки
      queryClient.invalidateQueries({ queryKey: ["reviews-mine"] });
      toast.error("Не удалось отправить отзыв", { description: error.message });
    },
  });

  return (
    <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Как вам заказ {order?.number}?</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className="flex items-center gap-1"
            role="radiogroup"
            aria-label="Оценка от 1 до 5 звёзд"
          >
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={`${value} ${value === 1 ? "звезда" : "звёзд"}`}
                onClick={() => setRating(value)}
                onMouseEnter={() => setHoverRating(value)}
                onMouseLeave={() => setHoverRating(0)}
                className="p-1 rounded hover:bg-accent transition-colors"
              >
                <Star
                  className={`h-7 w-7 transition-colors ${
                    value <= (hoverRating || rating)
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground/40"
                  }`}
                  aria-hidden
                />
              </button>
            ))}
          </div>

          <div>
            <Label htmlFor="review-text" className="mb-1.5 block">
              Комментарий (необязательно)
            </Label>
            <Textarea
              id="review-text"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
              placeholder="Расскажите, что понравилось или что можно улучшить"
            />
          </div>

          <div>
            <Label className="mb-1.5 block">Фото</Label>
            <PhotoUploader
              photos={photos}
              onAdd={(url) => setPhotos((prev) => [...prev, url])}
              onRemove={(url) => setPhotos((prev) => prev.filter((p) => p !== url))}
              category="reviews"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
              Позже
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={rating === 0 || mutation.isPending}
            >
              {mutation.isPending ? "Отправляем…" : "Отправить отзыв"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** «Есть проблема» (ТЗ §16): причина → тикет поддержки по заказу */
function ProblemOrderDialog({
  order,
  onClose,
}: {
  order: Order | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("product_quality");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);

  useEffect(() => {
    if (order) {
      setReason("product_quality");
      setDescription("");
      setPhotos([]);
    }
  }, [order]);

  const mutation = useMutation({
    mutationFn: async () => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch("/api/crm/tickets", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          subject: `Проблема по заказу №${order!.number}`,
          category: reason,
          orderId: order!.id,
          message: description.trim(),
          metadata: { description: description.trim(), photos },
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ticket?: { number?: string | null }; error?: string }
        | null;
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      return body!;
    },
    onSuccess: (data) => {
      toast.success("Обращение создано", {
        description: data.ticket?.number
          ? `Номер обращения: ${data.ticket.number}. Поддержка ответит в чате.`
          : "Поддержка свяжется с вами в чате",
      });
      queryClient.invalidateQueries({ queryKey: ["tickets-own"] });
      onClose();
    },
    onError: (error: Error) => {
      toast.error("Не удалось создать обращение", { description: error.message });
    },
  });

  return (
    <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Есть проблема по заказу {order?.number}?</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <RadioGroup value={reason} onValueChange={setReason} className="gap-2">
            {PROBLEM_REASONS.map((r) => (
              <Label
                key={r.value}
                htmlFor={`problem-${r.value}`}
                className="flex items-center gap-2 p-2.5 rounded-md border border-border cursor-pointer hover:bg-accent has-[[data-state=checked]]:border-primary"
              >
                <RadioGroupItem id={`problem-${r.value}`} value={r.value} />
                <span className="text-sm font-normal">{r.label}</span>
              </Label>
            ))}
          </RadioGroup>

          <div>
            <Label htmlFor="problem-description" className="mb-1.5 block">
              Опишите проблему
            </Label>
            <Textarea
              id="problem-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Что случилось? Минимум 10 символов"
            />
            {description.trim().length > 0 && description.trim().length < 10 && (
              <p className="text-xs text-amber-700 mt-1">
                Ещё {10 - description.trim().length} симв.
              </p>
            )}
          </div>

          <div>
            <Label className="mb-1.5 block">Фото</Label>
            <PhotoUploader
              photos={photos}
              onAdd={(url) => setPhotos((prev) => [...prev, url])}
              onRemove={(url) => setPhotos((prev) => prev.filter((p) => p !== url))}
              category="tickets"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
              Отмена
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={description.trim().length < 10 || mutation.isPending}
            >
              {mutation.isPending ? "Отправляем…" : "Отправить обращение"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Повтор заказа: подтверждение при изменившихся ценах / недоступных позициях */
function RepeatOrderDialog({
  data,
  onAdd,
  onClose,
}: {
  data: RepeatResponse | null;
  onAdd: (items: RepeatItem[]) => void;
  onClose: () => void;
}) {
  const items = data?.items || [];
  const available = items.filter((i) => i.available);
  const unavailable = items.filter((i) => !i.available);
  const hasPriceChange = items.some((i) => i.available && i.unitPrice !== i.oldPrice);

  return (
    <Dialog open={!!data} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Повтор заказа №{data?.orderNumber}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {items.map((it) => (
            <div
              key={it.productId}
              className={`flex items-center gap-3 p-2 rounded-lg border ${
                it.available ? "border-border" : "border-amber-200 bg-amber-50/60"
              }`}
            >
              {it.image ? (
                 
                <img
                  src={it.image}
                  alt=""
                  className="h-12 w-12 rounded object-cover shrink-0" loading="lazy" decoding="async" />
              ) : (
                <div className="h-12 w-12 rounded bg-muted shrink-0" aria-hidden />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{it.title}</div>
                <div className="text-xs text-muted-foreground">
                  {it.quantity} шт.
                  {it.available ? (
                    it.unitPrice !== it.oldPrice ? (
                      <span className="text-amber-700">
                        {" "}
                        · цена изменилась: <s>{formatCurrency(it.oldPrice)}</s>{" "}
                        <span className="font-medium">{formatCurrency(it.unitPrice)}</span>
                      </span>
                    ) : (
                      <> · {formatCurrency(it.unitPrice)}</>
                    )
                  ) : (
                    <span className="text-amber-700"> · {it.unavailableReason}</span>
                  )}
                </div>
              </div>
              {!it.available && (
                <Badge variant="outline" className="text-[10px] bg-amber-100 text-amber-800 border-amber-200 shrink-0">
                  <Clock className="h-3 w-3 mr-0.5" aria-hidden />
                  Недоступно
                </Badge>
              )}
            </div>
          ))}
        </div>

        {hasPriceChange && (
          <p className="text-xs text-amber-700">
            Цены обновлены по актуальному каталогу кондитера.
          </p>
        )}
        {unavailable.length > 0 && (
          <p className="text-xs text-amber-700">
            Недоступные позиции не будут добавлены в корзину
            {available.length === 0 ? " — в заказе нет доступных позиций" : ""}.
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>
            Закрыть
          </Button>
          <Button
            disabled={available.length === 0}
            onClick={() => onAdd(available)}
          >
            <ShoppingCart className="h-4 w-4 mr-1" aria-hidden />
            Добавить в корзину ({available.length})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Сетка избранного из /api/wishlist (готовые карточки с сервера) */
function WishlistGrid({
  items,
  onChanged,
}: {
  items: WishlistItem[];
  onChanged: () => void;
}) {
  const addToCart = useAppStore((s) => s.addToCart);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function removeFromWishlist(productId: string) {
    setPendingId(productId);
    try {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch("/api/wishlist", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ productId }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      onChanged();
      toast.success("Удалено из избранного");
    } catch (error) {
      toast.error("Не удалось обновить избранное", { description: (error as Error).message });
    } finally {
      setPendingId(null);
    }
  }

  function addAllToCart(item: WishlistItem) {
    const product = {
      id: item.id,
      title: item.title,
      slug: item.slug,
      description: "",
      price: item.price,
      category: "cakes",
      images: item.images,
      confectionerId: "",
      rating: 0,
      reviewsCount: 0,
    } as Product;
    addToCart(product, undefined, 1);
    toast.success("Добавлено в корзину");
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => (
        <Card key={item.productId} className="p-3 flex gap-3">
          <div className="h-20 w-20 rounded-lg bg-muted overflow-hidden shrink-0">
            {item.images[0] ? (
               
              <img
                src={item.images[0]}
                alt={item.title}
                className="h-full w-full object-cover" loading="lazy" decoding="async" />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-muted-foreground" aria-hidden>
                <Heart className="h-6 w-6" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="font-medium text-sm line-clamp-2">{item.title}</div>
            <div className="font-display font-bold text-base mt-0.5">
              {formatCurrency(item.price)}
            </div>
            {!item.available && (
              <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800 border-amber-200 w-fit mt-1">
                Недоступен
              </Badge>
            )}
            <div className="flex gap-2 mt-auto pt-2">
              <Button
                size="sm"
                className="h-8 flex-1"
                disabled={!item.available}
                onClick={() => addAllToCart(item)}
              >
                <ShoppingCart className="h-3.5 w-3.5 mr-1" aria-hidden />
                В корзину
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0"
                disabled={pendingId === item.productId}
                onClick={() => removeFromWishlist(item.productId)}
                aria-label={`Убрать «${item.title}» из избранного`}
              >
                {pendingId === item.productId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Heart className="h-3.5 w-3.5 fill-primary text-primary" aria-hidden />
                )}
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
