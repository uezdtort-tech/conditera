/**
 * admin-dashboard.tsx — дашборд администратора (v2.0).
 *
 * Рефакторинг из other-dashboards.tsx:
 *   - Убран @ts-nocheck
 *   - Layout использует DashboardSidebarLayout
 *   - Overview использует TanStack Query → /api/admin/dashboard
 *   - Tabs use existing admin-* components (AdminOrdersManager, AdminCmsTabs, etc.)
 *
 * Note: This is a typed re-export of the existing logic.
 * The original (other-dashboards.tsx) is preserved for backward compatibility.
 */

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from "recharts";
import {
  Package, Coins, TrendingUp, Settings, LogOut,
  ShoppingCart, Users, ShieldAlert, ScrollText, Flag,
  LayoutDashboard, MessageSquare, Edit, Image as ImageIcon,
  Mail, ShieldCheck, FileText, CalendarDays, Tags, Globe,
  Zap, Database, Cake, Building2, Navigation,
  Utensils, MapPin, Star, Store, UserCheck, UserX,
  Check, Pencil, Trash2, UserCog,
} from "lucide-react";
import { formatCurrency, ORDER_STATUS_LABELS } from "@/lib/finance";
import { BlacklistTab } from "@/components/dashboard/blacklist-tab";
import {
  AdminCmsHomeTab, AdminBannersTab, AdminCmsPagesTab,
  AdminReviewsModerationTab, AdminSettingsTab, AdminNavMenuTab,
} from "@/components/dashboard/admin-cms-tabs";
import {
  AdminTastingLocationsTab, AdminVenuesTab, AdminPrintingServicesTab,
  AdminSeoTab, AdminTastingReviewsTab, AdminTastingMapTab,
} from "@/components/dashboard/admin-extra-tabs-2";
import { N8nAutomationDashboard } from "@/components/dashboard/n8n-automation-dashboard";
import { AdminOrganizationVerificationTab } from "@/components/dashboard/admin-organization-verification-tab";
import { AdminMaintenanceTab } from "@/components/dashboard/admin-maintenance-tab";
import { AdminFillingsTab } from "@/components/dashboard/admin-fillings-tab";
import { AdminFraudMonitor } from "@/components/dashboard/admin-fraud-monitor";
import { AdminConfectionerVerification } from "@/components/dashboard/admin-confectioner-verification";
import { AdminProductsManager } from "@/components/dashboard/admin-products-manager";
import { AdminOrdersManager } from "@/components/dashboard/admin-orders-manager";
import { AdminEventsManager } from "@/components/dashboard/admin-events-manager";
import { AdminTicketsTab } from "@/components/dashboard/admin-crm-tickets";
import { AdminLeadsTab } from "@/components/dashboard/admin-crm-leads";
import { AdminCustomersTab } from "@/components/dashboard/admin-crm-customers";
import { AdminEmailTab } from "@/components/dashboard/admin-email-tab";
import { AdminSecurityTab } from "@/components/dashboard/admin-security-tab";
// ModerationQueue не существует как отдельный компонент — используем AdminReviewsModerationTab
// (он содержит очередь модерации отзывов)
import { toast } from "sonner";
import {
  DashboardSidebarLayout, SidebarStat, LoadingState, ErrorState,
} from "@/components/dashboard/_shared";
import { ProfileSettings } from "@/components/dashboard/profile-settings";
import { useAdminDashboard } from "@/lib/supabase/use-dashboards";

// Group sections for sidebar
const TAB_GROUPS = [
  {
    title: null,
    tabs: [
      { id: "overview", label: "Обзор", icon: LayoutDashboard },
      { id: "users", label: "Пользователи", icon: Users },
      { id: "orders", label: "Заказы", icon: ShoppingCart },
      { id: "products", label: "Товары", icon: Package },
      { id: "moderation", label: "Модерация", icon: Flag, badge: "2" },
      { id: "blacklist", label: "Чёрный список", icon: ShieldAlert },
      { id: "audit", label: "Аудит", icon: ScrollText },
    ],
  },
  {
    title: "CMS",
    tabs: [
      { id: "cms-home", label: "Главная", icon: LayoutDashboard },
      { id: "cms-banners", label: "Баннеры", icon: ImageIcon },
      { id: "cms-pages", label: "Страницы", icon: Edit },
      { id: "reviews", label: "Отзывы", icon: MessageSquare },
      { id: "nav-menu", label: "Навигация", icon: Navigation },
    ],
  },
  {
    title: "CRM",
    tabs: [
      { id: "crm-tickets", label: "Тикеты", icon: MessageSquare },
      { id: "crm-leads", label: "Лиды (Kanban)", icon: TrendingUp },
      { id: "crm-customers", label: "Клиенты", icon: Users },
      { id: "email", label: "Почта", icon: Mail },
      { id: "security", label: "Безопасность", icon: ShieldAlert },
    ],
  },
  {
    title: "Дополнительно",
    tabs: [
      { id: "tasting-locations", label: "Точки дегустации", icon: Utensils },
      { id: "tasting-map", label: "Карта дегустаций", icon: MapPin },
      { id: "tasting-reviews", label: "Отзывы о точках", icon: Star },
      { id: "venues", label: "Площадки", icon: Building2 },
      { id: "events", label: "События", icon: CalendarDays },
      { id: "printing", label: "Печать на пряниках", icon: Tags },
      { id: "seo", label: "SEO", icon: Globe },
      { id: "automation", label: "Автоматизация (n8n)", icon: Zap },
      { id: "org-verification", label: "Проверка организаций", icon: Building2 },
      { id: "maintenance", label: "Обслуживание БД", icon: Database },
      { id: "fillings", label: "Начинки (модерация)", icon: Cake },
      { id: "profile", label: "Мой профиль", icon: UserCog },
      { id: "settings", label: "Настройки сайта", icon: Settings },
    ],
  },
];

// Flatten tabs for the sidebar (preserving group dividers)
const ALL_TABS = TAB_GROUPS.flatMap(g => g.tabs);

export function AdminDashboard() {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const orders = useAppStore((s) => s.orders);
  const [activeTab, setActiveTab] = useState("overview");

  const { data, isLoading, error, refetch } = useAdminDashboard();

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>Войти</Button>
      </div>
    );
  }

  const stats = data?.stats;
  const recentOrders = data?.recentOrders || [];
  const platformGrowth = data?.platformGrowth || [];

  const userGrowth = platformGrowth.map((g: { month: string; users: number; orders: number }) => ({
    month: g.month,
    users: g.users,
    orders: g.orders,
  }));

  const renderContent = () => {
    if (isLoading && activeTab === "overview") return <LoadingState message="Загружаем статистику..." />;
    if (error && activeTab === "overview") return <ErrorState error={error as Error} onRetry={() => refetch()} />;

    switch (activeTab) {
      case "overview":
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="font-display text-2xl font-bold">Панель администратора</h1>
              <Badge variant="outline" className="bg-primary/10 text-primary">
                <LayoutDashboard className="h-3 w-3 mr-1" />
                LIVE
              </Badge>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SidebarStat icon={Users} label="Пользователей" value={String(stats?.totalUsers || 0)} color="text-primary bg-primary/10" />
              <SidebarStat icon={ShoppingCart} label="Заказов" value={String(stats?.totalOrders || 0)} color="text-amber-600 bg-amber-100" />
              <SidebarStat icon={Coins} label="Доход за месяц" value={formatCurrency(stats?.revenueMonth || 0)} color="text-emerald-600 bg-emerald-100" />
              <SidebarStat icon={ShieldAlert} label="Фрод-алерты" value={String(stats?.fraudAlerts || 0)} color="text-red-600 bg-red-100" />
            </div>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Рост платформы</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={userGrowth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.90 0.015 70)" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="users" name="Пользователи" stroke="oklch(0.55 0.18 25)" strokeWidth={3} />
                  <Line type="monotone" dataKey="orders" name="Заказы" stroke="oklch(0.70 0.14 70)" strokeWidth={3} />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            <div className="grid lg:grid-cols-2 gap-4">
              <Card className="p-4">
                <h3 className="font-semibold mb-3">Последние заказы</h3>
                <div className="space-y-2">
                  {recentOrders.slice(0, 5).map((o) => (
                    <div key={o.id} className="flex items-center justify-between p-2 border border-border rounded text-sm">
                      <div>
                        <div className="font-medium">{o.number}</div>
                        <div className="text-xs text-muted-foreground">{o.customer_email}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold">{formatCurrency(o.total)}</div>
                        <Badge variant="outline" className="text-[10px]">{o.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-4">
                <h3 className="font-semibold mb-3">Активность</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-2">
                    <UserCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <div>Новый кондитер зарегистрирован</div>
                      <div className="text-xs text-muted-foreground">2 минуты назад</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <ShoppingCart className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <div>Новый заказ UK-2025-0234</div>
                      <div className="text-xs text-muted-foreground">5 минут назад</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Flag className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <div>Жалоба на отзыв #4521</div>
                      <div className="text-xs text-muted-foreground">15 минут назад</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <UserX className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <div>Пользователь заблокирован</div>
                      <div className="text-xs text-muted-foreground">1 час назад</div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        );

      case "users":
        return (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">Пользователи</h1>
            <Card className="p-4">
              <div className="space-y-2">
                {[
                  { id: "u1", name: "Анна Соколова", email: "customer@demo.ru", role: "CUSTOMER", city: "Москва", orders: 12, blocked: false },
                  { id: "u2", name: "Мария Уездная", email: "confectioner@demo.ru", role: "CONFECTIONER", city: "Тула", orders: 1248, blocked: false },
                  { id: "u3", name: "Андрей Поляков", email: "supplier@demo.ru", role: "SUPPLIER", city: "Москва", orders: 0, blocked: false },
                  { id: "u4", name: "Иван Курьеров", email: "courier@demo.ru", role: "COURIER", city: "Москва", orders: 156, blocked: false },
                  { id: "u5", name: "Спамер Спамович", email: "spammer@spam.ru", role: "CUSTOMER", city: "—", orders: 0, blocked: true },
                ].map((u) => (
                  <div key={u.id} className={`flex items-center gap-3 p-3 border rounded ${u.blocked ? "border-red-300 bg-red-50/50" : "border-border"}`}>
                    <div className="flex-1">
                      <div className="font-medium text-sm flex items-center gap-2">
                        {u.name}
                        {u.blocked && <Badge className="text-[9px] bg-red-500">Заблокирован</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{u.email} • {u.city}</div>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">{u.role}</Badge>
                    <div className="text-xs text-muted-foreground">{u.orders} зак.</div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => toast.info(`Редактирование ${u.name}`)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-amber-600" onClick={() => toast.success(u.blocked ? "Разблокирован" : "Заблокирован", { description: u.name })}>
                        {u.blocked ? <Check className="h-3.5 w-3.5" /> : <UserX className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => { if (confirm(`Удалить ${u.name}?`)) toast.success("Пользователь удалён"); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        );

      case "orders": return <AdminOrdersManager />;
      case "products": return <AdminProductsManager />;
      case "moderation": return <AdminReviewsModerationTab />;
      case "blacklist": return <BlacklistTab />;
      case "cms-home": return <AdminCmsHomeTab />;
      case "cms-banners": return <AdminBannersTab />;
      case "cms-pages": return <AdminCmsPagesTab />;
      case "reviews": return <AdminReviewsModerationTab />;
      case "nav-menu": return <AdminNavMenuTab />;
      case "settings": return <AdminSettingsTab />;
      case "profile": return <ProfileSettings />;
      case "crm-tickets": return <AdminTicketsTab />;
      case "crm-leads": return <AdminLeadsTab />;
      case "crm-customers": return <AdminCustomersTab />;
      case "email": return <AdminEmailTab />;
      case "security": return <AdminSecurityTab />;
      case "tasting-locations": return <AdminTastingLocationsTab />;
      case "tasting-map": return <AdminTastingMapTab />;
      case "tasting-reviews": return <AdminTastingReviewsTab />;
      case "venues": return <AdminVenuesTab />;
      case "events": return <AdminEventsManager />;
      case "printing": return <AdminPrintingServicesTab />;
      case "seo": return <AdminSeoTab />;
      case "automation": return <N8nAutomationDashboard />;
      case "org-verification": return <AdminOrganizationVerificationTab />;
      case "maintenance": return <AdminMaintenanceTab />;
      case "fillings": return <AdminFillingsTab />;
      case "audit":
        return (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-bold">Аудит действий</h1>
            <Card className="p-4">
              <div className="space-y-2">
                {[
                  { user: "admin@demo.ru", action: "Заблокировал пользователя #4521", time: "1 час назад" },
                  { user: "admin@demo.ru", action: "Изменил комиссию тарифа PROFI с 11% на 10%", time: "3 часа назад" },
                  { user: "moderator@demo.ru", action: "Удалил отзыв #7821", time: "5 часов назад" },
                  { user: "admin@demo.ru", action: "Верифицировал кондитера «Сахарный дом»", time: "1 день назад" },
                  { user: "admin@demo.ru", action: "Создал промокод BIRTHDAY (25%)", time: "2 дня назад" },
                ].map((a, i) => (
                  <div key={i} className="flex items-center justify-between p-2 border border-border rounded text-sm">
                    <div>
                      <div className="font-medium">{a.action}</div>
                      <div className="text-xs text-muted-foreground">{a.user}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">{a.time}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        );
      default:
        return (
          <Card className="p-12 text-center">
            <p className="text-sm text-muted-foreground">
              Вкладка «{activeTab}» — контент будет добавлен в следующей итерации.
            </p>
          </Card>
        );
    }
  };

  return (
    <DashboardSidebarLayout
      user={user}
      logout={logout}
      role="Администратор"
      avatar={user.avatar}
      businessName={user.name}
      navigate={navigate as unknown as (view: string) => void}
      tabs={ALL_TABS}
      activeTab={activeTab}
      onTab={setActiveTab}
    >
      {renderContent()}
    </DashboardSidebarLayout>
  );
}
