"use client";

import React, { useState } from "react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OperatorDashboard } from "@/components/dashboard/operator-dashboard";
import { ModeratorDashboardFull } from "@/components/dashboard/moderator-dashboard";
import { ProfileSettings } from "@/components/dashboard/profile-settings";
import { VenueOwnerDashboard } from "@/components/dashboard/venue-owner-dashboard";
import {
  AnimatorAgencyDashboard,
  RecreationCenterDashboard,
  KidsClubDashboard,
  InspectorDashboard,
} from "@/components/dashboard/extra-dashboards-v2";
import {
  LayoutDashboard, Settings, LogOut, Star, TrendingUp, DollarSign,
  ShoppingBag, FileText, Check, Clock, AlertCircle, MessageSquare,
  Shield, ShieldCheck, Megaphone, Store, Users, Truck, Package, Eye, Edit, Plus,
  Award, Heart, Calendar, MapPin, Bell, ClipboardList, BookOpen, CheckSquare,
  PenLine, Image as ImageIcon, Flag, ThumbsUp, Gift, Leaf, Building2,
  Microscope, Stethoscope, Briefcase, CheckCircle2, X, ChevronRight,
} from "lucide-react";

// ==================== Базовая обёртка ====================
function DashboardShell({
  user, logout, title, role, icon: Icon, gradient, tabs, activeTab, onTab,
  children,
}: {
  user: { name: string; email: string };
  logout: () => void;
  title: string;
  role: string;
  icon: typeof LayoutDashboard;
  gradient: string;
  tabs: { id: string; label: string; icon: typeof LayoutDashboard }[];
  activeTab: string;
  onTab: (t: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Шапка */}
      <Card className="p-5 mb-6 flex flex-col md:flex-row gap-4 items-start md:items-center border-border/60">
        <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white shadow-lg`}>
          <Icon className="w-8 h-8" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{title}</h1>
          <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-3">
            <span>{user.name}</span>
            <span>•</span>
            <span>{user.email}</span>
            <Badge variant="outline">{role}</Badge>
          </div>
        </div>
        <Button variant="outline" onClick={logout}>
          <LogOut className="w-4 h-4 mr-2" />Выйти
        </Button>
      </Card>

      {/* Табы */}
      <div className="flex flex-wrap gap-1 mb-6 p-1 bg-card rounded-xl border border-border/60">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === t.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"
            }`}
          >
            <t.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {children}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, change, color }: {
  icon: typeof LayoutDashboard; label: string; value: string | number;
  change?: string; color: string;
}) {
  return (
    <Card className="p-4 border-border/60">
      <div className="flex items-center justify-between mb-2">
        <Icon className={`w-6 h-6 ${color}`} />
        {change && <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700">{change}</Badge>}
      </div>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}

function EmptyState({ icon: Icon, title, text, action }: {
  icon: typeof LayoutDashboard; title: string; text: string; action?: string;
}) {
  return (
    <Card className="p-12 text-center border-border/60">
      <Icon className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4">{text}</p>
      {action && <Button size="sm">{action}</Button>}
    </Card>
  );
}

// ==================== MODERATOR ====================
export function ModeratorDashboard() {
  return <ModeratorDashboardFull />;
}

// ==================== SUPPORT ====================
export function SupportDashboard() {
  // Реальный операторский дашборд: эскалации от авточата
  return (
    <div className="space-y-4">
      <OperatorDashboard />
    </div>
  );
}

// ==================== COPYWRITER ====================
export function CopywriterDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");
  if (!user) return null;
  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "blog", label: "Блог", icon: PenLine },
    { id: "promo", label: "Промо", icon: Megaphone },
    { id: "seo", label: "SEO", icon: TrendingUp },
    { id: "settings", label: "Настройки", icon: Settings },
  ];
  return (
    <DashboardShell user={user} logout={logout} title="Кабинет копирайтера" role="COPYWRITER" icon={PenLine} gradient="from-purple-500 to-pink-600" tabs={tabs} activeTab={tab} onTab={setTab}>
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={PenLine} label="Статей опубликовано" value="34" change="+3" color="text-purple-500" />
            <StatCard icon={Eye} label="Просмотров за месяц" value="45.2K" change="+18%" color="text-blue-500" />
            <StatCard icon={TrendingUp} label="SEO-позиции" value="ТОП-10" change="+5" color="text-emerald-500" />
            <StatCard icon={Clock} label="Черновиков" value="6" color="text-amber-500" />
          </div>
          <Card className="p-5 border-border/60">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Последние статьи</h3>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" />Новая статья</Button>
            </div>
            {[
              { title: "Топ-10 тортов на свадьбу 2026", status: "published", views: "4.2K", date: "2 дня назад" },
              { title: "Как выбрать кондитера: чек-лист", status: "draft", views: "—", date: "черновик" },
              { title: "Постные десерты: полный гид", status: "published", views: "8.7K", date: "1 неделя" },
            ].map((a, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                <FileText className="w-5 h-5 text-muted-foreground" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.date} • {a.views} просмотров</div>
                </div>
                <Badge variant={a.status === "published" ? "default" : "secondary"}>
                  {a.status === "published" ? "Опубл." : "Черновик"}
                </Badge>
                <Button size="icon" variant="ghost"><Edit className="w-4 h-4" /></Button>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === "blog" && <EmptyState icon={PenLine} title="Управление блогом" text="Все статьи блога" action="Открыть" />}
      {tab === "promo" && <EmptyState icon={Megaphone} title="Промо-материалы" text="Баннеры, лендинги, рассылки" />}
      {tab === "seo" && <EmptyState icon={TrendingUp} title="SEO-аналитика" text="Позиции, ключевые слова, аудит" />}
      {tab === "settings" && <ProfileSettings />}
    </DashboardShell>
  );
}

// ==================== FOOD_SERVICE (B2B) ====================
export function FoodServiceDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");
  if (!user) return null;
  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "catalog", label: "Каталог", icon: Package },
    { id: "consign", label: "На реализацию", icon: Store },
    { id: "orders", label: "B2B-заказы", icon: ShoppingBag },
    { id: "tastings", label: "Дегустации", icon: Calendar },
    { id: "finance", label: "Финансы", icon: DollarSign },
    { id: "settings", label: "Настройки", icon: Settings },
  ];
  return (
    <DashboardShell user={user} logout={logout} title="B2B-кабинет (общепит)" role="FOOD_SERVICE" icon={Store} gradient="from-emerald-500 to-teal-600" tabs={tabs} activeTab={tab} onTab={setTab}>
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={DollarSign} label="Продажи за месяц" value="428K ₽" change="+22%" color="text-emerald-500" />
            <StatCard icon={ShoppingBag} label="B2B-заказов" value="38" change="+8" color="text-blue-500" />
            <StatCard icon={Store} label="На реализации" value="14 поз." color="text-purple-500" />
            <StatCard icon={Calendar} label="Дегустаций" value="6" color="text-amber-500" />
          </div>
          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Активные B2B-заказы</h3>
            {[
              { client: "Кафе «Уют», Москва", items: 5, total: "12 400 ₽", date: "17 марта", status: "Готовится" },
              { client: "Ресторан «Восток», СПб", items: 12, total: "38 200 ₽", date: "18 марта", status: "Подтверждён" },
              { client: "Сеть «Кофейня», Казань", items: 8, total: "24 800 ₽", date: "19 марта", status: "Доставка" },
            ].map((o, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                <Store className="w-5 h-5 text-emerald-500" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{o.client}</div>
                  <div className="text-xs text-muted-foreground">{o.items} позиций • доставка {o.date}</div>
                </div>
                <Badge variant="outline" className="text-xs">{o.status}</Badge>
                <div className="font-bold">{o.total}</div>
                <Button size="sm" variant="outline">Открыть</Button>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === "catalog" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Каталог B2B (оптовые цены)</h3>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />Добавить товар</Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { name: "Торты на реализацию", count: 8, price: "от 800₽/кг" },
              { name: "Десерты порционные", count: 15, price: "от 80₽/шт" },
              { name: "Капкейки опт", count: 6, price: "от 60₽/шт (от 50шт)" },
              { name: "Макаронс опт", count: 4, price: "от 35₽/шт (от 100шт)" },
            ].map((c, i) => (
              <Card key={i} className="p-4 text-center">
                <Package className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <div className="font-medium text-sm">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.count} товаров</div>
                <div className="text-xs font-semibold text-primary mt-1">{c.price}</div>
              </Card>
            ))}
          </div>
        </div>
      )}
      {tab === "consign" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Товары на реализацию (консигнация)</h3>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />Добавить на реализацию</Button>
          </div>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground mb-3">
              Размещайте товары кондитеров у себя на реализацию. Комиссия: 70% кондитеру / 30% кафе.
              Отчёт по продажам — ежедневно.
            </div>
            <div className="space-y-2">
              {[
                { name: "Торт «Медовик» от Марии Уездной", sold: 3, remaining: 2, revenue: "4 500 ₽", conf: "70% → 3 150 ₽" },
                { name: "Капкейки (12 шт) от «Сахарного Лебедя»", sold: 5, remaining: 7, revenue: "3 000 ₽", conf: "70% → 2 100 ₽" },
              ].map((c, i) => (
                <div key={i} className="flex items-center gap-3 p-3 border rounded-lg">
                  <Package className="w-5 h-5 text-emerald-500" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">Продано: {c.sold} • Остаток: {c.remaining}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-sm">{c.revenue}</div>
                    <div className="text-xs text-emerald-600">{c.conf}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
      {tab === "orders" && <EmptyState icon={ShoppingBag} title="Все B2B-заказы" text="История и текущие заказы от корпоративных клиентов" />}
      {tab === "tastings" && (
        <div className="space-y-4">
          <h3 className="font-semibold">Дегустации для клиентов</h3>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground mb-3">
              Предлагайте дегустации кондитерских изделий клиентам. Бронирование столов для дегустации.
            </div>
            <div className="space-y-2">
              {[
                { client: "Иванова А.", date: "17 июля 15:00", table: "№3", status: "Подтверждено" },
                { client: "Петров С.", date: "18 июля 12:00", table: "№1", status: "Ожидает" },
              ].map((t, i) => (
                <div key={i} className="flex items-center gap-3 p-3 border rounded-lg">
                  <Calendar className="w-5 h-5 text-amber-500" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{t.client}</div>
                    <div className="text-xs text-muted-foreground">{t.date} • Стол {t.table}</div>
                  </div>
                  <Badge variant="outline" className="text-xs">{t.status}</Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
      {tab === "finance" && (
        <div className="space-y-4">
          <h3 className="font-semibold">Финансы</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={DollarSign} label="Доход за месяц" value="428K ₽" color="text-emerald-500" />
            <StatCard icon={TrendingUp} label="Комиссия платформы" value="51K ₽" color="text-red-500" />
            <StatCard icon={ShoppingBag} label="Консигнация" value="42K ₽" color="text-blue-500" />
            <StatCard icon={Award} label="К выплате" value="335K ₽" color="text-purple-500" />
          </div>
          <Card className="p-4">
            <div className="text-sm space-y-2">
              <div className="flex justify-between"><span className="text-muted-foreground">Тариф:</span><span className="font-medium">Кафе (12%)</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Абонентская плата:</span><span className="font-medium">1 490 ₽/мес</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Консигнация:</span><span className="font-medium">70/30 (кондитер/кафе)</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Выплаты:</span><span className="font-medium">Раз в неделю (пятница)</span></div>
            </div>
          </Card>
        </div>
      )}
      {tab === "settings" && <ProfileSettings />}
    </DashboardShell>
  );
}

// ==================== EVENT_ORGANIZER ====================
export function EventOrganizerDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");
  if (!user) return null;
  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "events", label: "Мероприятия", icon: Calendar },
    { id: "orders", label: "Заказы", icon: ShoppingBag },
    { id: "settings", label: "Настройки", icon: Settings },
  ];
  return (
    <DashboardShell user={user} logout={logout} title="Кабинет организатора" role="EVENT_ORGANIZER" icon={Calendar} gradient="from-rose-500 to-pink-600" tabs={tabs} activeTab={tab} onTab={setTab}>
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Calendar} label="Активных событий" value="7" color="text-rose-500" />
            <StatCard icon={ShoppingBag} label="Заказов в работе" value="12" color="text-blue-500" />
            <StatCard icon={DollarSign} label="Бюджет событий" value="845K ₽" change="+15%" color="text-emerald-500" />
            <StatCard icon={Users} label="Участников" value="1 240" color="text-purple-500" />
          </div>
          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Ближайшие мероприятия</h3>
            {[
              { name: "Свадьба Ивановых", date: "15 марта", guests: 80, status: "ready" },
              { name: "Корпоратив IT-Company", date: "20 марта", guests: 150, status: "in_progress" },
              { name: "День рождения Анны", date: "25 марта", guests: 30, status: "planning" },
            ].map((e, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                <Calendar className="w-5 h-5 text-rose-500" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{e.name}</div>
                  <div className="text-xs text-muted-foreground">{e.date} • {e.guests} гостей</div>
                </div>
                <Badge variant={e.status === "ready" ? "default" : "secondary"}>
                  {e.status === "ready" ? "Готово" : e.status === "in_progress" ? "В работе" : "Планируется"}
                </Badge>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === "events" && <EmptyState icon={Calendar} title="Все мероприятия" text="Календарь и список событий" action="Создать" />}
      {tab === "orders" && <EmptyState icon={ShoppingBag} title="Заказы на мероприятия" text="Торты, декор, услуги" />}
      {tab === "settings" && <ProfileSettings />}
    </DashboardShell>
  );
}

// ==================== BLOGGER ====================
export function BloggerDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");
  if (!user) return null;
  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "content", label: "Контент", icon: ImageIcon },
    { id: "referrals", label: "Рефералы", icon: Gift },
    { id: "earnings", label: "Заработок", icon: DollarSign },
    { id: "settings", label: "Настройки", icon: Settings },
  ];
  return (
    <DashboardShell user={user} logout={logout} title="Кабинет блогера" role="BLOGGER" icon={ImageIcon} gradient="from-pink-500 to-fuchsia-600" tabs={tabs} activeTab={tab} onTab={setTab}>
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Users} label="Подписчиков" value="12.4K" change="+340" color="text-pink-500" />
            <StatCard icon={Eye} label="Просмотров" value="284K" change="+18%" color="text-blue-500" />
            <StatCard icon={Gift} label="Рефералов" value="89" change="+12" color="text-purple-500" />
            <StatCard icon={DollarSign} label="Заработано" value="42K ₽" change="+8K" color="text-emerald-500" />
          </div>
          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Партнёрская программа</h3>
            <div className="p-4 rounded-lg bg-gradient-to-br from-pink-50 to-fuchsia-50 dark:from-pink-900/20 dark:to-fuchsia-900/20">
              <div className="text-sm font-medium mb-2">Ваша реферальная ссылка:</div>
              <div className="flex gap-2">
                <input readOnly value="https://conditera.ru/r/blogger42" className="flex-1 h-10 rounded-lg border border-border bg-card px-3 text-sm font-mono" />
                <Button>Копировать</Button>
              </div>
              <div className="text-xs text-muted-foreground mt-2">Заработок: 5% с каждой покупки реферала</div>
            </div>
          </Card>
        </div>
      )}
      {tab === "content" && <EmptyState icon={ImageIcon} title="Контент блогера" text="Посты, сторис, обзоры" action="Создать пост" />}
      {tab === "referrals" && <EmptyState icon={Gift} title="Реферальная сеть" text="Приглашённые пользователи" />}
      {tab === "earnings" && <EmptyState icon={DollarSign} title="Финансы" text="Выплаты и аналитика заработка" />}
      {tab === "settings" && <ProfileSettings />}
    </DashboardShell>
  );
}

// ==================== PICKUP_POINT ====================
export function PickupPointDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");
  if (!user) return null;
  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "incoming", label: "Приём", icon: Package },
    { id: "outgoing", label: "Выдача", icon: CheckCircle2 },
    { id: "inventory", label: "Инвентарь", icon: ClipboardList },
    { id: "settings", label: "Настройки", icon: Settings },
  ];
  return (
    <DashboardShell user={user} logout={logout} title="Кабинет ПВЗ" role="PICKUP_POINT" icon={Package} gradient="from-cyan-500 to-blue-600" tabs={tabs} activeTab={tab} onTab={setTab}>
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Package} label="К получению" value="14" color="text-amber-500" />
            <StatCard icon={CheckCircle2} label="Выдано сегодня" value="23" change="+5" color="text-emerald-500" />
            <StatCard icon={Clock} label="Хранится > 3 дней" value="2" color="text-rose-500" />
            <StatCard icon={MapPin} label="Точка" value="Москва" color="text-blue-500" />
          </div>
          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Заказы к выдаче</h3>
            {[
              { code: "UK-1024", customer: "Анна К.", phone: "+7 900 ***-22-33", days: 1 },
              { code: "UK-1023", customer: "Игорь П.", phone: "+7 900 ***-44-55", days: 2 },
              { code: "UK-1019", customer: "Ольга М.", phone: "+7 900 ***-11-22", days: 4 },
            ].map((o, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                <Package className="w-5 h-5 text-cyan-500" />
                <div className="flex-1">
                  <div className="text-sm font-medium">#{o.code} — {o.customer}</div>
                  <div className="text-xs text-muted-foreground">{o.phone} • хранится {o.days} дн.</div>
                </div>
                {o.days > 3 && <Badge variant="destructive">Срочно!</Badge>}
                <Button size="sm">Выдать</Button>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === "incoming" && <EmptyState icon={Package} title="Приём заказов" text="Входящие посылки" />}
      {tab === "outgoing" && <EmptyState icon={CheckCircle2} title="Выдача" text="История выдач" />}
      {tab === "inventory" && <EmptyState icon={ClipboardList} title="Инвентарь" text="Текущие остатки" />}
      {tab === "settings" && <ProfileSettings />}
    </DashboardShell>
  );
}

// ==================== WHOLESALER ====================
export function WholesalerDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");
  if (!user) return null;
  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "orders", label: "Опт. заказы", icon: ShoppingBag },
    { id: "recurring", label: "Регулярные", icon: Calendar },
    { id: "priceLists", label: "Прайс-листы", icon: FileText },
    { id: "settings", label: "Настройки", icon: Settings },
  ];
  return (
    <DashboardShell user={user} logout={logout} title="Кабинет оптовика" role="WHOLESALER" icon={Briefcase} gradient="from-slate-600 to-slate-800" tabs={tabs} activeTab={tab} onTab={setTab}>
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={DollarSign} label="Оборот за месяц" value="1.24M ₽" change="+18%" color="text-emerald-500" />
            <StatCard icon={ShoppingBag} label="Заказов" value="48" color="text-blue-500" />
            <StatCard icon={Calendar} label="Регулярных" value="12" color="text-purple-500" />
            <StatCard icon={TrendingUp} label="Скидка" value="25%" color="text-amber-500" />
          </div>
          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Оптовые заказы</h3>
            {[
              { supplier: "ООО «СладкийОпт»", items: 24, total: "84 200 ₽", status: "shipping" },
              { supplier: "Мукомольная база", items: 8, total: "32 400 ₽", status: "delivered" },
              { supplier: "Шоколад-Опт", items: 15, total: "67 800 ₽", status: "new" },
            ].map((o, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                <Briefcase className="w-5 h-5 text-slate-600" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{o.supplier}</div>
                  <div className="text-xs text-muted-foreground">{o.items} позиций</div>
                </div>
                <div className="font-bold">{o.total}</div>
                <Badge variant={o.status === "delivered" ? "default" : o.status === "shipping" ? "secondary" : "outline"}>
                  {o.status === "delivered" ? "Доставлен" : o.status === "shipping" ? "В пути" : "Новый"}
                </Badge>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === "orders" && <EmptyState icon={ShoppingBag} title="Оптовые заказы" text="Полный список" />}
      {tab === "recurring" && <EmptyState icon={Calendar} title="Регулярные поставки" text="Подписки и графики" />}
      {tab === "priceLists" && <EmptyState icon={FileText} title="Прайс-листы" text="Оптовые цены" action="Загрузить" />}
      {tab === "settings" && <ProfileSettings />}
    </DashboardShell>
  );
}

// ==================== TASTER ====================
export function TasterDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");
  if (!user) return null;
  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "ratings", label: "Оценки", icon: Star },
    { id: "queue", label: "На дегустацию", icon: ClipboardList },
    { id: "settings", label: "Профиль", icon: Settings },
  ];
  return (
    <DashboardShell user={user} logout={logout} title="Кабинет дегустатора" role="TASTER" icon={Microscope} gradient="from-violet-500 to-purple-600" tabs={tabs} activeTab={tab} onTab={setTab}>
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Star} label="Средняя оценка" value="4.6" color="text-amber-500" />
            <StatCard icon={ClipboardList} label="Оценено товаров" value="248" change="+12" color="text-blue-500" />
            <StatCard icon={Clock} label="В очереди" value="8" color="text-purple-500" />
            <StatCard icon={Award} label="Топ-дегустатор" value="ТОП-10" color="text-emerald-500" />
          </div>
          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Последние оценки</h3>
            {[
              { product: "Торт «Красный бархат»", confectioner: "Анна С.", rating: 5, taste: 5, look: 5 },
              { product: "Чизкейк «Нью-Йорк»", confectioner: "Ваниль", rating: 4, taste: 5, look: 4 },
              { product: "Макаруны ассорти", confectioner: "Люси", rating: 5, taste: 5, look: 5 },
            ].map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                <div className="flex gap-0.5">
                  {[1,2,3,4,5].map((s) => (
                    <Star key={s} className={`w-3 h-3 ${s <= r.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                  ))}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{r.product}</div>
                  <div className="text-xs text-muted-foreground">{r.confectioner}</div>
                </div>
                <div className="text-xs text-muted-foreground">Вкус: {r.taste} • Внешний вид: {r.look}</div>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === "ratings" && <EmptyState icon={Star} title="Все оценки" text="История дегустаций" />}
      {tab === "queue" && <EmptyState icon={ClipboardList} title="Очередь дегустации" text="Образцы на оценку" />}
      {tab === "settings" && <ProfileSettings />}
    </DashboardShell>
  );
}

// ==================== FRANCHISEE ====================
export function FranchiseeDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");
  if (!user) return null;
  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "standards", label: "Стандарты", icon: ClipboardList },
    { id: "branches", label: "Филиалы", icon: Building2 },
    { id: "royalty", label: "Роялти", icon: DollarSign },
    { id: "settings", label: "Настройки", icon: Settings },
  ];
  return (
    <DashboardShell user={user} logout={logout} title="Кабинет франчайзи" role="FRANCHISEE" icon={Building2} gradient="from-indigo-500 to-blue-700" tabs={tabs} activeTab={tab} onTab={setTab}>
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Building2} label="Филиалов" value="3" color="text-indigo-500" />
            <StatCard icon={DollarSign} label="Выручка сети" value="2.8M ₽" change="+22%" color="text-emerald-500" />
            <StatCard icon={Users} label="Сотрудников" value="42" color="text-purple-500" />
            <StatCard icon={Award} label="Стандарты" value="100%" change="+5%" color="text-amber-500" />
          </div>
          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Филиалы сети</h3>
            {[
              { name: "Уездный кондитер — Москва", revenue: "1.2M ₽", staff: 18, standard: 98 },
              { name: "Уездный кондитер — СПб", revenue: "880K ₽", staff: 12, standard: 95 },
              { name: "Уездный кондитер — Казань", revenue: "720K ₽", staff: 12, standard: 100 },
            ].map((b, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                <Building2 className="w-5 h-5 text-indigo-500" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{b.name}</div>
                  <div className="text-xs text-muted-foreground">{b.staff} сотрудников • выручка {b.revenue}</div>
                </div>
                <Badge variant={b.standard === 100 ? "default" : "secondary"}>Стандарты: {b.standard}%</Badge>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === "standards" && <EmptyState icon={ClipboardList} title="Стандарты франшизы" text="Чек-листы соответствия" />}
      {tab === "branches" && <EmptyState icon={Building2} title="Филиалы" text="Управление точками" action="Добавить" />}
      {tab === "royalty" && <EmptyState icon={DollarSign} title="Роялти" text="Отчисления и финансовая отчётность" />}
      {tab === "settings" && <ProfileSettings />}
    </DashboardShell>
  );
}

// ==================== NUTRITIONIST ====================
export function NutritionistDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");
  if (!user) return null;
  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "clients", label: "Клиенты", icon: Users },
    { id: "recommendations", label: "Рекомендации", icon: Leaf },
    { id: "articles", label: "Статьи", icon: BookOpen },
    { id: "settings", label: "Профиль", icon: Settings },
  ];
  return (
    <DashboardShell user={user} logout={logout} title="Кабинет нутрициолога" role="NUTRITIONIST" icon={Stethoscope} gradient="from-green-500 to-emerald-600" tabs={tabs} activeTab={tab} onTab={setTab}>
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Users} label="Активных клиентов" value="28" color="text-green-500" />
            <StatCard icon={Leaf} label="Рекомендаций" value="142" change="+8" color="text-emerald-500" />
            <StatCard icon={BookOpen} label="Статей" value="34" color="text-blue-500" />
            <StatCard icon={Star} label="Рейтинг" value="4.95" color="text-amber-500" />
          </div>
          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Последние рекомендации</h3>
            {[
              { client: "Анна К.", need: "Безглютеновое меню", items: 8 },
              { client: "Михаил В.", need: "Диабетические десерты", items: 5 },
              { client: "Ольга М.", need: "Кето-десерты", items: 6 },
            ].map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                <Leaf className="w-5 h-5 text-green-500" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{r.client}</div>
                  <div className="text-xs text-muted-foreground">{r.need} • {r.items} позиций</div>
                </div>
                <Button size="sm" variant="outline">Открыть</Button>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === "clients" && <EmptyState icon={Users} title="Клиенты" text="Подопечные нутрициолога" />}
      {tab === "recommendations" && <EmptyState icon={Leaf} title="Рекомендации" text="Подборки диетических десертов" />}
      {tab === "articles" && <EmptyState icon={BookOpen} title="Статьи" text="Полезные материалы" action="Создать" />}
      {tab === "settings" && <ProfileSettings />}
    </DashboardShell>
  );
}

// ==================== CORPORATE_CLIENT ====================
export function CorporateClientDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");
  if (!user) return null;
  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "orders", label: "Заказы", icon: ShoppingBag },
    { id: "budgets", label: "Бюджеты", icon: DollarSign },
    { id: "approvals", label: "Согласования", icon: CheckCircle2 },
    { id: "settings", label: "Настройки", icon: Settings },
  ];
  return (
    <DashboardShell user={user} logout={logout} title="Корпоративный кабинет" role="CORPORATE_CLIENT" icon={Building2} gradient="from-blue-600 to-indigo-700" tabs={tabs} activeTab={tab} onTab={setTab}>
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={ShoppingBag} label="Заказов за год" value="142" color="text-blue-500" />
            <StatCard icon={DollarSign} label="Бюджет использован" value="2.4M ₽" change="68%" color="text-amber-500" />
            <StatCard icon={Clock} label="На согласовании" value="3" color="text-purple-500" />
            <StatCard icon={Users} label="Сотрудников" value="240" color="text-emerald-500" />
          </div>
          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Бюджеты на 2026</h3>
            {[
              { dept: "HR-отдел", budget: "500K ₽", used: "320K ₽", percent: 64 },
              { dept: "Маркетинг", budget: "1.2M ₽", used: "890K ₽", percent: 74 },
              { dept: "IT-отдел", budget: "800K ₽", used: "420K ₽", percent: 52 },
            ].map((b, i) => (
              <div key={i} className="p-3 border-b last:border-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{b.dept}</span>
                  <span className="text-xs text-muted-foreground">{b.used} / {b.budget}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full ${b.percent > 80 ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${b.percent}%` }} />
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === "orders" && <EmptyState icon={ShoppingBag} title="Корпоративные заказы" text="Торты на мероприятия" />}
      {tab === "budgets" && <EmptyState icon={DollarSign} title="Бюджеты" text="Квартальные лимиты" />}
      {tab === "approvals" && <EmptyState icon={CheckCircle2} title="Согласования" text="Заказы на утверждении" />}
      {tab === "settings" && <ProfileSettings />}
    </DashboardShell>
  );
}

// ==================== QUALITY_INSPECTOR ====================
export function QualityInspectorDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");
  if (!user) return null;
  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "inspections", label: "Инспекции", icon: ClipboardList },
    { id: "checklists", label: "Чек-листы", icon: CheckSquare },
    { id: "confectioners", label: "Кондитеры", icon: Users },
    { id: "settings", label: "Настройки", icon: Settings },
  ];
  return (
    <DashboardShell user={user} logout={logout} title="Инспекция качества" role="QUALITY_INSPECTOR" icon={ShieldCheck} gradient="from-red-500 to-rose-600" tabs={tabs} activeTab={tab} onTab={setTab}>
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={ClipboardList} label="Проведено инспекций" value="124" change="+8" color="text-blue-500" />
            <StatCard icon={CheckCircle2} label="Соответствуют" value="118" color="text-emerald-500" />
            <StatCard icon={AlertCircle} label="Нарушений" value="6" color="text-rose-500" />
            <StatCard icon={Clock} label="Запланировано" value="14" color="text-amber-500" />
          </div>
          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Запланированные инспекции</h3>
            {[
              { confectioner: "Сладкая мастерская Анны", date: "15 марта", type: "Плановая", status: "scheduled" },
              { confectioner: "Кондитерский дом «Ваниль»", date: "16 марта", type: "Внеплановая", status: "scheduled" },
              { confectioner: "Шоколатье Дмитрий", date: "18 марта", type: "Повторная", status: "scheduled" },
            ].map((c, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                <ShieldCheck className="w-5 h-5 text-red-500" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{c.confectioner}</div>
                  <div className="text-xs text-muted-foreground">{c.date} • {c.type}</div>
                </div>
                <Button size="sm" variant="outline">Начать</Button>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === "inspections" && <EmptyState icon={ClipboardList} title="Все инспекции" text="История проверок" />}
      {tab === "checklists" && <EmptyState icon={CheckSquare} title="Чек-листы" text="Шаблоны проверок" action="Создать" />}
      {tab === "confectioners" && <EmptyState icon={Users} title="Реестр кондитеров" text="Список проверяемых" />}
      {tab === "settings" && <ProfileSettings />}
    </DashboardShell>
  );
}

// ==================== CERTIFICATION_AGENT ====================
export function CertificationAgentDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");
  if (!user) return null;
  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "applications", label: "Заявки", icon: FileText },
    { id: "verification", label: "Верификация", icon: ShieldCheck },
    { id: "certificates", label: "Сертификаты", icon: Award },
    { id: "settings", label: "Настройки", icon: Settings },
  ];
  return (
    <DashboardShell user={user} logout={logout} title="Агент сертификации" role="CERTIFICATION_AGENT" icon={Award} gradient="from-amber-500 to-yellow-600" tabs={tabs} activeTab={tab} onTab={setTab}>
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={FileText} label="Заявок на рассмотрении" value="8" color="text-amber-500" />
            <StatCard icon={CheckCircle2} label="Сертифицировано" value="124" change="+5" color="text-emerald-500" />
            <StatCard icon={Clock} label="Средний срок" value="3 дня" color="text-blue-500" />
            <StatCard icon={Award} label="Активных сертификатов" value="98" color="text-purple-500" />
          </div>
          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Заявки на сертификацию</h3>
            {[
              { confectioner: "Мария Десерт", type: "ХАССП", date: "14 марта", docs: 4, status: "review" },
              { confectioner: "Сладкая уездная", type: "ГОСТ Р", date: "15 марта", docs: 6, status: "review" },
              { confectioner: "Кондитерская Купец", type: "ISO 22000", date: "16 марта", docs: 8, status: "docs_needed" },
            ].map((c, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                <Award className="w-5 h-5 text-amber-500" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{c.confectioner}</div>
                  <div className="text-xs text-muted-foreground">{c.type} • подано {c.date} • {c.docs} докум.</div>
                </div>
                <Badge variant={c.status === "review" ? "default" : "secondary"}>
                  {c.status === "review" ? "На рассмотрении" : "Нужны документы"}
                </Badge>
                <Button size="sm">Открыть</Button>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === "applications" && <EmptyState icon={FileText} title="Все заявки" text="Полный реестр" />}
      {tab === "verification" && <EmptyState icon={ShieldCheck} title="Верификация" text="Проверка документов и предприятий" />}
      {tab === "certificates" && <EmptyState icon={Award} title="Выданные сертификаты" text="Реестр активных сертификатов" />}
      {tab === "settings" && <ProfileSettings />}
    </DashboardShell>
  );
}

// ===== Маршрутизатор по ролям =====
export function ExtraDashboards() {
  const user = useAppStore((s) => s.user);
  const activeRole = useAppStore((s) => s.activeRole);

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>
          Войти
        </Button>
      </div>
    );
  }

  const role = (activeRole || user?.roles?.[0] || "FOOD_SERVICE") as string;

  const roleMap: Record<string, () => React.JSX.Element> = {
    FOOD_SERVICE: () => <FoodServiceDashboard />,
    EVENT_ORGANIZER: () => <EventOrganizerDashboard />,
    BLOGGER: () => <BloggerDashboard />,
    PICKUP_POINT: () => <PickupPointDashboard />,
    WHOLESALER: () => <WholesalerDashboard />,
    TASTER: () => <TasterDashboard />,
    FRANCHISEE: () => <FranchiseeDashboard />,
    NUTRITIONIST: () => <NutritionistDashboard />,
    CORPORATE_CLIENT: () => <CorporateClientDashboard />,
    QUALITY_INSPECTOR: () => <QualityInspectorDashboard />,
    CERTIFICATION_AGENT: () => <CertificationAgentDashboard />,
    COPYWRITER: () => <CopywriterDashboard />,
    MODERATOR: () => <ModeratorDashboard />,
    SUPPORT: () => <SupportDashboard />,
    // v2.0 — 4 новые роли
    ANIMATOR_AGENCY: () => <AnimatorAgencyDashboard />,
    RECREATION_CENTER: () => <RecreationCenterDashboard />,
    KIDS_CLUB: () => <KidsClubDashboard />,
    INSPECTOR: () => <InspectorDashboard />,
    // ВЛАДЕЛЕЦ ПЛОЩАДКИ — полноценный дашборд с CRUD услуг/прайсов (был осиротевшим)
    VENUE_OWNER: () => <VenueOwnerDashboard />,
  };

  const DashboardComponent = roleMap[role];

  // Роль не поддерживается — показываем сообщение
  if (!DashboardComponent) {
    return (
      <div className="min-h-screen bg-muted/30">
        <div className="container mx-auto px-4 py-6">
          <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>
            Назначьте роль пользователю для доступа к кабинету
          </Button>
          <div className="mt-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              Текущая роль: <span className="font-mono">{role}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              Доступные роли: {Object.keys(roleMap).join(", ")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {DashboardComponent()}
    </div>
  );
}
