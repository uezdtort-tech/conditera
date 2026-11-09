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

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Zap, Database, Cake, Building2, Navigation, AlertTriangle,
  Utensils, MapPin, Star, Store, UserX,
  Check, Pencil, Trash2, UserCog, Images, Gauge, BellRing,
} from "lucide-react";
import { formatCurrency, ORDER_STATUS_LABELS } from "@/lib/finance";
import { csrfFetch } from "@/lib/api-client";
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
import { AdminIncidentsTab } from "@/components/dashboard/admin-incidents-tab";
import { AdminFillingsTab } from "@/components/dashboard/admin-fillings-tab";
import { AdminFraudMonitor } from "@/components/dashboard/admin-fraud-monitor";
import { AdminConfectionerVerification } from "@/components/dashboard/admin-confectioner-verification";
import { AdminSupplierVerification } from "@/components/dashboard/admin-supplier-verification";
import { AdminProductsManager } from "@/components/dashboard/admin-products-manager";
import { AdminMediaModerationTab } from "@/components/dashboard/admin-media-moderation-tab";
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
import {
  AdminOpsCenter, fetchOpsSummary, fetchOpsTasks,
} from "@/components/dashboard/admin-ops-center";
import { SEVERITY_UI, type OpsSeverity } from "@/lib/ops-client-types";

// Group sections for sidebar
const TAB_GROUPS = [
  {
    title: null,
    tabs: [
      { id: "overview", label: "Обзор", icon: LayoutDashboard },
      { id: "ops-center", label: "Операционный центр", icon: Gauge },
      { id: "users", label: "Пользователи", icon: Users },
      { id: "orders", label: "Заказы", icon: ShoppingCart },
      { id: "products", label: "Товары", icon: Package },
      { id: "moderation", label: "Модерация", icon: Flag, badge: "2" },
      { id: "supplier-verification", label: "Поставщики", icon: Building2 },
      { id: "media-moderation", label: "Медиа-модерация", icon: Images },
      { id: "blacklist", label: "Чёрный список", icon: ShieldAlert },
      { id: "incidents", label: "Инциденты", icon: AlertTriangle },
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

// Бейдж «Операционного центра» динамический (критические задачи) —
// подставляется в компоненте, поэтому ALL_TABS собирается в рендере.

interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  city: string | null;
  phone: string | null;
  is_blocked: boolean;
  blocked_reason: string | null;
  is_verified: boolean;
  deleted_at: string | null;
  roles: string[];
  orders_count: number;
}

/**
 * Реальный раздел «Пользователи»: данные из /api/admin/users (profiles + user_roles),
 * блокировка/удаление — серверные PATCH/DELETE с проверкой прав (ранее был мок-список).
 */
function AdminUsersSection() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const usersQuery = useQuery({
    queryKey: ["admin-users", search],
    queryFn: async (): Promise<{ users: AdminUserRow[]; total: number }> => {
      const qs = search ? `?search=${encodeURIComponent(search)}` : "";
      const res = await csrfFetch(`/api/admin/users${qs}`);
      if (!res.ok) throw new Error(`Не удалось загрузить пользователей (HTTP ${res.status})`);
      return res.json();
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    queryClient.invalidateQueries({ queryKey: ["admin-dashboard-v2"] });
  };

  const blockMutation = useMutation({
    mutationFn: async ({ userId, action }: { userId: string; action: "block" | "unblock" }) => {
      const res = await csrfFetch("/api/admin/users", {
        method: "PATCH",
        body: JSON.stringify({ userId, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.action === "block" ? "Пользователь заблокирован" : "Пользователь разблокирован");
      invalidate();
    },
    onError: (e: Error) => toast.error("Не удалось изменить статус", { description: e.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await csrfFetch(`/api/admin/users?userId=${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    },
    onSuccess: () => {
      toast.success("Пользователь удалён (мягкое удаление, заказы сохранены)");
      invalidate();
    },
    onError: (e: Error) => toast.error("Не удалось удалить", { description: e.message }),
  });

  const users = usersQuery.data?.users || [];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Пользователи</h1>
      <Card className="p-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по имени, email или телефону…"
          aria-label="Поиск пользователей"
          className="w-full mb-3 px-3 py-2 text-sm border border-border rounded-md bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {usersQuery.isLoading && (
          <p className="text-sm text-muted-foreground py-6 text-center">Загружаем пользователей…</p>
        )}
        {usersQuery.error && (
          <div className="text-sm text-destructive py-4">
            Ошибка загрузки: {(usersQuery.error as Error).message}
            <Button size="sm" variant="outline" className="ml-3" onClick={() => usersQuery.refetch()}>
              Повторить
            </Button>
          </div>
        )}
        {!usersQuery.isLoading && !usersQuery.error && users.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {search ? "Ничего не найдено по запросу" : "Пользователей пока нет"}
          </p>
        )}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {users.map((u) => {
            const blocked = u.is_blocked || Boolean(u.deleted_at);
            return (
              <div
                key={u.id}
                className={`flex items-center gap-3 p-3 border rounded ${blocked ? "border-red-300 bg-red-50/50" : "border-border"}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm flex items-center gap-2">
                    <span className="truncate">{u.name || "(без имени)"}</span>
                    {u.deleted_at && <Badge className="text-[9px] bg-red-500">Удалён</Badge>}
                    {!u.deleted_at && u.is_blocked && <Badge className="text-[9px] bg-red-500">Заблокирован</Badge>}
                    {u.is_verified && <Badge variant="outline" className="text-[9px]">Проверен</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {u.email} • {u.city || "—"}{u.blocked_reason ? ` • ${u.blocked_reason}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 justify-end">
                  {(u.roles.length ? u.roles : ["CUSTOMER"]).slice(0, 2).map((r) => (
                    <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">{u.orders_count} зак.</div>
                <div className="flex gap-1">
                  {u.deleted_at ? (
                    <span className="text-[10px] text-muted-foreground px-1">только чтение</span>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-amber-600"
                        disabled={blockMutation.isPending}
                        title={u.is_blocked ? "Разблокировать" : "Заблокировать"}
                        aria-label={u.is_blocked ? `Разблокировать ${u.email}` : `Заблокировать ${u.email}`}
                        onClick={() => blockMutation.mutate({ userId: u.id, action: u.is_blocked ? "unblock" : "block" })}
                      >
                        {u.is_blocked ? <Check className="h-3.5 w-3.5" /> : <UserX className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive"
                        disabled={deleteMutation.isPending}
                        title="Удалить (мягко)"
                        aria-label={`Удалить ${u.email}`}
                        onClick={() => { if (confirm(`Удалить ${u.name || u.email}? Заказы будут сохранены.`)) deleteMutation.mutate(u.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

export function AdminDashboard() {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const orders = useAppStore((s) => s.orders);
  const [activeTab, setActiveTab] = useState("overview");
  const { data, isLoading, error, refetch } = useAdminDashboard();

  // Операционный центр: те же query-ключи, что и внутри AdminOpsCenter —
  // кэш общий (бейдж обновляется вместе с очередью, refetch 60с).
  const opsTasksQuery = useQuery({
    queryKey: ["ops-tasks"],
    queryFn: fetchOpsTasks,
    refetchInterval: 60_000,
  });
  const opsSummaryQuery = useQuery({
    queryKey: ["ops-summary"],
    queryFn: fetchOpsSummary,
    refetchInterval: 60_000,
  });
  const opsCritical = opsSummaryQuery.data?.attention?.critical ?? 0;
  const opsBadge = opsCritical > 0 ? String(opsCritical) : undefined;

  const allTabs = useMemo(
    () =>
      TAB_GROUPS.flatMap((g) =>
        g.tabs.map((t) => (t.id === "ops-center" ? { ...t, badge: opsBadge } : t))
      ),
    [opsBadge]
  );

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
                <h3 className="font-semibold mb-3 flex items-center gap-1.5">
                  <BellRing className="h-4 w-4 text-primary" />
                  Требуют внимания
                </h3>
                {opsTasksQuery.data?.tasks?.length ? (
                  <div className="space-y-2 text-sm">
                    {opsTasksQuery.data.tasks.slice(0, 3).map((t) => {
                      const sev = SEVERITY_UI[(t.severity as OpsSeverity) ?? "info"] ?? SEVERITY_UI.info;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setActiveTab("ops-center")}
                          className="w-full flex items-start gap-2 text-left p-2 border border-border rounded hover:bg-accent transition min-h-[44px]"
                        >
                          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sev.dot}`} aria-hidden />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{t.title}</div>
                            <div className="text-xs text-muted-foreground truncate">{t.description || t.type}</div>
                          </div>
                        </button>
                      );
                    })}
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => setActiveTab("ops-center")}>
                      Все задачи ({opsTasksQuery.data.tasks.length})
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Все задачи обработаны — операционная очередь пуста.
                  </p>
                )}
              </Card>
            </div>
          </div>
        );

      case "ops-center":
        return <AdminOpsCenter onNavigateTab={setActiveTab} />;

      case "users":
        return <AdminUsersSection />;

      case "orders": return <AdminOrdersManager />;
      case "products": return <AdminProductsManager />;
      case "moderation": return <AdminReviewsModerationTab />;
      case "supplier-verification": return <AdminSupplierVerification />;
      case "media-moderation": return <AdminMediaModerationTab />;
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
      case "incidents": return <AdminIncidentsTab />;
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
      tabs={allTabs}
      activeTab={activeTab}
      onTab={setActiveTab}
    >
      {renderContent()}
    </DashboardSidebarLayout>
  );
}
