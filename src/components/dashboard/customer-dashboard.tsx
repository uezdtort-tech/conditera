"use client";

import { useAppStore } from "@/lib/store";
import { useState } from "react";
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
  Users,
  Navigation,
  FileText,
  Bell,
} from "lucide-react";
import { ProductCard } from "@/components/marketplace/product-card";
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
import { ProfileSettings } from "@/components/dashboard/profile-settings";

export function CustomerDashboard() {
  const navigate = useAppStore((s) => s.navigate);
  const nav = useAppStore((s) => s.nav);
  const user = useAppStore((s) => s.user);
  const orders = useAppStore((s) => s.orders);
  const favorites = useAppStore((s) => s.favorites);
  const negotiations = useAppStore((s) => s.negotiations);
  const products = useAppStore((s) => s.products);
  const logout = useAppStore((s) => s.logout);
  const setChatOpen = useAppStore((s) => s.setChatOpen);

  const [activeTab, setActiveTab] = useState(nav.params?.tab || "overview");

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

        <div className="grid lg:grid-cols-[280px_1fr] gap-6">
          {/* Sidebar */}
          <aside>
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
                  badge={String(favorites.length)}
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
                          <img
                            src={order.items[0].image}
                            alt=""
                            className="h-12 w-12 rounded object-cover" loading="lazy" decoding="async" />
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
                <h1 className="font-display text-2xl font-bold">Мои заказы</h1>
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
                        <Card key={order.id} className="p-4">
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
                          <div className="mt-3 flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setChatOpen(true)}
                            >
                              <MessageCircle className="h-4 w-4 mr-1" />
                              Чат с кондитером
                            </Button>
                            {(order.status === "DELIVERING" || order.status === "COMPLETED") && (
                              <Button
                                size="sm"
                                onClick={() => toast.success("Спасибо за отзыв!")}
                              >
                                <Star className="h-4 w-4 mr-1" />
                                Оставить отзыв
                              </Button>
                            )}
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
                {favoriteProducts.length === 0 ? (
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

            {activeTab === "settings" && (
              <ProfileSettings />
            )}
          </div>
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
