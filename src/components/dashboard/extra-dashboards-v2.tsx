"use client";

/**
 * extra-dashboards-v2.tsx — 4 новых дашборда для недостающих ролей.
 *
 * Создано в рамках Task ID: roles-v2-missing-dashboards.
 * Добавляет дашборды для:
 *   - ANIMATOR_AGENCY (агентство аниматоров)
 *   - RECREATION_CENTER (развлекательный центр)
 *   - KIDS_CLUB (детский клуб)
 *   - INSPECTOR (внутренний аудитор)
 *
 * Использует общий DashboardShell из extra-dashboards.tsx.
 */

import React, { useState } from "react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from "recharts";
import {
  LayoutDashboard, Settings, LogOut, Star, TrendingUp, DollarSign,
  Users, Calendar, MapPin, Package, Eye, Edit, Plus, AlertTriangle,
  ShieldCheck, FileText, Building2, Cake, Gift, Award, CheckCircle2,
  Clock, Sparkles, Building, Baby, Users2, Music, Gamepad2,
  Database, Lock, ShieldAlert, FileSearch, AlertCircle,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/finance";
import { DashboardShell, StatCard, EmptyState } from "@/components/dashboard/_shared";
import { ServicesManager } from "@/components/dashboard/services-manager";

// ==================== ANIMATOR_AGENCY ====================
export function AnimatorAgencyDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>Войти</Button>
      </div>
    );
  }

  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "listings", label: "Объявления", icon: Package },
    { id: "animators", label: "Аниматоры", icon: Users, badge: "8" },
    { id: "programs", label: "Программы", icon: Sparkles },
    { id: "bookings", label: "Заказы", icon: Calendar, badge: "5" },
    { id: "schedule", label: "Расписание", icon: Clock },
    { id: "earnings", label: "Финансы", icon: DollarSign },
    { id: "settings", label: "Настройки", icon: Settings },
  ];

  return (
    <DashboardShell
      user={user}
      logout={logout}
      title="Кабинет агентства аниматоров"
      role="ANIMATOR_AGENCY"
      icon={Sparkles}
      gradient="from-purple-500 via-pink-500 to-rose-500"
      tabs={tabs}
      activeTab={tab}
      onTab={setTab}
    >
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Calendar} label="Заказов за месяц" value="12" change="+3" color="text-purple-500" />
            <StatCard icon={DollarSign} label="Доход за месяц" value="186 000 ₽" change="+22%" color="text-emerald-500" />
            <StatCard icon={Users} label="Аниматоров" value="8" color="text-blue-500" />
            <StatCard icon={Star} label="Рейтинг" value="4.8" change="+0.2" color="text-amber-500" />
          </div>

          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Программы мероприятий</h3>
            <div className="space-y-3">
              {[
                { name: "Машина-Временин", type: "kids", price: 12000, duration: "2 часа", bookings: 4 },
                { name: "Pirate Adventure", type: "kids", price: 15000, duration: "2.5 часа", bookings: 3 },
                { name: "Quest for Adults", type: "adults", price: 25000, duration: "3 часа", bookings: 2 },
                { name: "Wedding Animation", type: "wedding", price: 35000, duration: "4 часа", bookings: 1 },
                { name: "Corporate Game", type: "corporate", price: 45000, duration: "3 часа", bookings: 2 },
              ].map((p, i) => (
                <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                  <Sparkles className="w-5 h-5 text-purple-500" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.type} • {p.duration} • {p.bookings} заказов
                    </div>
                  </div>
                  <div className="font-semibold">{formatCurrency(p.price)}</div>
                  <Button size="icon" variant="ghost"><Edit className="w-4 h-4" /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-full">
                <Plus className="w-4 h-4 mr-1" /> Добавить программу
              </Button>
            </div>
          </Card>

          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Ближайшие заказы</h3>
            <div className="space-y-2">
              {[
                { client: "Мария С.", event: "День рождения 7 лет", date: "2026-08-20", program: "Машина-Временин", animator: "Анна", status: "confirmed" },
                { client: "ООО Ромашка", event: "Корпоратив", date: "2026-08-25", program: "Corporate Game", animator: "Сергей", status: "confirmed" },
                { client: "Елена В.", event: "Свадьба", date: "2026-09-05", program: "Wedding Animation", animator: "Анна+Сергей", status: "pending" },
              ].map((b, i) => (
                <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                  <Calendar className="w-5 h-5 text-blue-500" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{b.event}</div>
                    <div className="text-xs text-muted-foreground">
                      {b.client} • {formatDate(b.date)} • {b.program}
                    </div>
                  </div>
                  <Badge variant={b.status === "confirmed" ? "default" : "secondary"}>
                    {b.status === "confirmed" ? "Подтверждён" : "Ожидает"}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "animators" && (
        <Card className="p-5 border-border/60">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Команда аниматоров (8)</h3>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-1" /> Добавить аниматора
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { name: "Анна Иванова", avatar: "https://i.pravatar.cc/100?u=ann", specs: ["kids", "magic"], rating: 4.9, events: 34 },
              { name: "Сергей Петров", avatar: "https://i.pravatar.cc/100?u=serg", specs: ["adults", "corporate"], rating: 4.8, events: 28 },
              { name: "Мария Смирнова", avatar: "https://i.pravatar.cc/100?u=maria", specs: ["kids", "face-paint"], rating: 5.0, events: 45 },
              { name: "Дмитрий Козлов", avatar: "https://i.pravatar.cc/100?u=dmitr", specs: ["wedding", "music"], rating: 4.7, events: 22 },
            ].map((a, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border border-border/60 rounded-lg">
                <Avatar>
                  <AvatarImage src={a.avatar} alt={a.name} />
                  <AvatarFallback>{a.name.slice(0, 2)}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="text-sm font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">{a.specs.join(", ")}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary" className="text-[10px]">
                      <Star className="w-3 h-3 mr-1 fill-amber-400 text-amber-400" />
                      {a.rating}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{a.events} событий</span>
                  </div>
                </div>
                <Button size="icon" variant="ghost"><Edit className="w-4 h-4" /></Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "programs" && (
        <EmptyState
          icon={Sparkles}
          title="Управление программами"
          text="Создавайте шаблоны мероприятий, указывайте цену, длительность, состав аниматоров"
          action="Создать программу"
        />
      )}

      {tab === "bookings" && (
        <EmptyState
          icon={Calendar}
          title="Заказы"
          text="Список всех бронирований с фильтрами по статусу и дате"
        />
      )}

      {tab === "schedule" && (
        <EmptyState
          icon={Clock}
          title="Расписание"
          text="Календарь занятости аниматоров — кто свободен в выбранный день"
        />
      )}

      {tab === "earnings" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Доход за 6 месяцев</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={[
              { month: "Мар", value: 124000 },
              { month: "Апр", value: 158000 },
              { month: "Май", value: 192000 },
              { month: "Июн", value: 215000 },
              { month: "Июл", value: 178000 },
              { month: "Авг", value: 186000 },
            ]}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.90 0.015 70)" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v / 1000}k`} />
              <Tooltip formatter={(v: number) => [formatCurrency(v), "Доход"]} />
              <Bar dataKey="value" fill="#a855f7" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {tab === "listings" && <ServicesManager />}

      {tab === "settings" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Профиль агентства</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Название</div>
              <div className="font-medium">Сказка Event</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Город</div>
              <div className="font-medium">Москва</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">ИНН</div>
              <div className="font-medium">7701234567</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Цена от</div>
              <div className="font-medium">3 000 ₽/час</div>
            </div>
          </div>
        </Card>
      )}
    </DashboardShell>
  );
}

// ==================== RECREATION_CENTER ====================
export function RecreationCenterDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>Войти</Button>
      </div>
    );
  }

  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "listings", label: "Объявления", icon: Package },
    { id: "venue", label: "Площадка", icon: Building },
    { id: "bookings", label: "Бронирования", icon: Calendar, badge: "6" },
    { id: "cakes", label: "Пронос тортов", icon: Cake },
    { id: "packages", label: "Пакеты услуг", icon: Package },
    { id: "earnings", label: "Финансы", icon: DollarSign },
    { id: "settings", label: "Настройки", icon: Settings },
  ];

  return (
    <DashboardShell
      user={user}
      logout={logout}
      title="Кабинет развлекательного центра"
      role="RECREATION_CENTER"
      icon={Gamepad2}
      gradient="from-cyan-500 via-blue-500 to-indigo-600"
      tabs={tabs}
      activeTab={tab}
      onTab={setTab}
    >
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Calendar} label="Бронирований" value="6" color="text-blue-500" />
            <StatCard icon={DollarSign} label="Доход" value="312 000 ₽" change="+12%" color="text-emerald-500" />
            <StatCard icon={Cake} label="Пронос тортов" value="14" color="text-amber-500" />
            <StatCard icon={Users} label="Вместимость" value="120 чел" color="text-purple-500" />
          </div>

          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Типы зон центра</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { name: "Боулинг", icon: "🎳", count: 8, busy: 3 },
                { name: "Бильярд", icon: "🎱", count: 12, busy: 5 },
                { name: "Детская зона", icon: "🧸", count: 1, busy: 1 },
                { name: "Аркады", icon: "🎮", count: 24, busy: 12 },
              ].map((z, i) => (
                <div key={i} className="p-3 border border-border/60 rounded-lg text-center">
                  <div className="text-3xl mb-1">{z.icon}</div>
                  <div className="text-sm font-medium">{z.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {z.busy}/{z.count} занято
                  </div>
                  <Progress value={(z.busy / z.count) * 100} className="mt-2 h-1.5" />
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Ближайшие мероприятия</h3>
            <div className="space-y-2">
              {[
                { name: "День рождения Саши", type: "kids", date: "2026-08-19", guests: 12, cake: true, fee: 500 },
                { name: "Корпоратив IT-Team", type: "corporate", date: "2026-08-22", guests: 35, cake: false, fee: 0 },
                { name: "Свидание Анны и Петра", type: "private", date: "2026-08-23", guests: 2, cake: true, fee: 500 },
                { name: "Турнир по бильярду", type: "tournament", date: "2026-08-25", guests: 32, cake: false, fee: 0 },
              ].map((e, i) => (
                <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                  <Calendar className="w-5 h-5 text-blue-500" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{e.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(e.date)} • {e.guests} гостей • {e.type}
                    </div>
                  </div>
                  {e.cake ? (
                    <Badge variant="outline" className="text-amber-700 border-amber-300">
                      <Cake className="w-3 h-3 mr-1" /> +{e.fee} ₽
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Без торта</Badge>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "venue" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Площадка</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Название</div>
              <div className="font-medium">FunZone Москва</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Тип</div>
              <div className="font-medium">Комплекс (боулинг + бильярд + arcade)</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Адрес</div>
              <div className="font-medium">г. Москва, ул. Игровая, 15</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Вместимость</div>
              <div className="font-medium">120 человек одновременно</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Пронос еды</div>
              <div className="font-medium">Разрешён (плата 500₽)</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Своя кухня</div>
              <div className="font-medium">Есть (бар + закуски)</div>
            </div>
          </div>
        </Card>
      )}

      {tab === "bookings" && (
        <EmptyState
          icon={Calendar}
          title="Бронирования"
          text="Календарь мероприятий с фильтрами по типу и зоне"
          action="Добавить бронь"
        />
      )}

      {tab === "cakes" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Пронос тортов (за месяц)</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Card className="p-4">
              <Cake className="w-6 h-6 mx-auto text-amber-500 mb-2" />
              <div className="text-2xl font-bold">14</div>
              <div className="text-xs text-muted-foreground">Проносов</div>
            </Card>
            <Card className="p-4">
              <DollarSign className="w-6 h-6 mx-auto text-emerald-500 mb-2" />
              <div className="text-2xl font-bold">7 000 ₽</div>
              <div className="text-xs text-muted-foreground">Сборы</div>
            </Card>
            <Card className="p-4">
              <Users className="w-6 h-6 mx-auto text-blue-500 mb-2" />
              <div className="text-2xl font-bold">3</div>
              <div className="text-xs text-muted-foreground">Постоянных кондитеров</div>
            </Card>
          </div>
        </Card>
      )}

      {tab === "packages" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Пакеты услуг</h3>
          <div className="space-y-3">
            {[
              { name: "Детский Deluxe", items: "Бильярд + Детская зона + Торт (3кг) + Аниматор", price: 25000 },
              { name: "Корпоративный", items: "Боулинг + Бильярд + Аркады + Кейтеринг", price: 85000 },
              { name: "Турнирный", items: "Бильярд (зал) + Арбитр + Призы", price: 45000 },
            ].map((p, i) => (
              <div key={i} className="p-3 border border-border/60 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium">{p.name}</div>
                  <div className="font-semibold">{formatCurrency(p.price)}</div>
                </div>
                <div className="text-xs text-muted-foreground">{p.items}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "earnings" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Доход по зонам (за месяц)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={[
              { zone: "Боулинг", value: 124000 },
              { zone: "Бильярд", value: 78000 },
              { zone: "Детская", value: 45000 },
              { zone: "Arcade", value: 65000 },
            ]}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.90 0.015 70)" />
              <XAxis dataKey="zone" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v / 1000}k`} />
              <Tooltip formatter={(v: number) => [formatCurrency(v), "Доход"]} />
              <Bar dataKey="value" fill="#06b6d4" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {tab === "listings" && <ServicesManager />}

      {tab === "settings" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Настройки центра</h3>
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Плата за пронос торта</div>
              <div className="font-medium">500 ₽ (можно редактировать)</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Часы работы</div>
              <div className="font-medium">Пн-Чт 12:00-00:00, Пт-Сб 12:00-04:00, Вс 12:00-22:00</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Партнёры-кондитеры</div>
              <div className="font-medium">3 активных (скидка 10% для клиентов)</div>
            </div>
          </div>
        </Card>
      )}
    </DashboardShell>
  );
}

// ==================== KIDS_CLUB ====================
export function KidsClubDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>Войти</Button>
      </div>
    );
  }

  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "listings", label: "Объявления", icon: Package },
    { id: "birthdays", label: "Дни рождения", icon: Cake, badge: "8" },
    { id: "kids", label: "Дети", icon: Baby, badge: "45" },
    { id: "partners", label: "Кондитеры", icon: Users2, badge: "3" },
    { id: "orders", label: "Заказы тортов", icon: Gift },
    { id: "earnings", label: "Финансы", icon: DollarSign },
    { id: "settings", label: "Настройки", icon: Settings },
  ];

  return (
    <DashboardShell
      user={user}
      logout={logout}
      title="Кабинет детского клуба"
      role="KIDS_CLUB"
      icon={Baby}
      gradient="from-pink-400 via-rose-400 to-orange-400"
      tabs={tabs}
      activeTab={tab}
      onTab={setTab}
    >
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Baby} label="Дети в клубе" value="45" change="+5" color="text-pink-500" />
            <StatCard icon={Cake} label="Дней рожд. в мес" value="8" color="text-amber-500" />
            <StatCard icon={Gift} label="Заказано тортов" value="14" change="+3" color="text-purple-500" />
            <StatCard icon={DollarSign} label="Расходы на торты" value="48 000 ₽" color="text-emerald-500" />
          </div>

          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Возрастные группы</h3>
            <div className="grid grid-cols-3 gap-3">
              {[
                { group: "3-6 лет", count: 18, color: "bg-pink-100 text-pink-700" },
                { group: "7-10 лет", count: 17, color: "bg-amber-100 text-amber-700" },
                { group: "11-14 лет", count: 10, color: "bg-purple-100 text-purple-700" },
              ].map((g, i) => (
                <div key={i} className={`p-4 rounded-lg ${g.color}`}>
                  <div className="text-2xl font-bold">{g.count}</div>
                  <div className="text-sm">{g.group}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Ближайшие дни рождения</h3>
            <div className="space-y-2">
              {[
                { child: "Саша Иванов", age: 7, date: "2026-08-19", cake: "Шоколадный с машинкой", confectioner: "Сладкая уездная", price: 3500 },
                { child: "Маша Петрова", age: 5, date: "2026-08-23", cake: "Розовый единорог", confectioner: "Татьяна-Кондитер", price: 4200 },
                { child: "Петя Сидоров", age: 10, date: "2026-08-25", cake: "Minecraft торт", confectioner: "Сахарный Лебедь", price: 5800 },
                { child: "Оля Кузнецова", age: 6, date: "2026-09-02", cake: "Принцесса", confectioner: "Сладкая уездная", price: 3900 },
              ].map((b, i) => (
                <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                  <Cake className="w-5 h-5 text-amber-500" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{b.child} ({b.age} лет)</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(b.date)} • {b.cake}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Конф.: {b.confectioner}</div>
                  </div>
                  <div className="font-semibold">{formatCurrency(b.price)}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "birthdays" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Календарь дней рождения</h3>
          <div className="text-sm text-muted-foreground mb-4">
            Сортировка по дате, фильтр по возрастной группе
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
              <div key={d} className="font-semibold text-muted-foreground py-2">{d}</div>
            ))}
            {Array.from({ length: 35 }).map((_, i) => {
              const day = i - 3; // начать с 29 июля
              const hasEvent = day >= 19 && day <= 25 && [19, 23, 25].includes(day);
              return (
                <div
                  key={i}
                  className={`aspect-square p-1 rounded ${hasEvent ? "bg-amber-100 border-amber-300" : "border"} ${day < 1 || day > 31 ? "opacity-30" : ""}`}
                >
                  {day >= 1 && day <= 31 && (
                    <>
                      <div className="font-medium">{day}</div>
                      {hasEvent && <Cake className="w-3 h-3 mx-auto text-amber-500" />}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {tab === "kids" && (
        <Card className="p-5 border-border/60">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Дети клуба (45)</h3>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-1" /> Добавить ребёнка
            </Button>
          </div>
          <div className="space-y-2">
            {[
              { name: "Саша Иванов", age: 7, parent: "Мария И.", allergies: "орехи", nextBirthday: "2026-08-19" },
              { name: "Маша Петрова", age: 5, parent: "Елена П.", allergies: "—", nextBirthday: "2026-08-23" },
              { name: "Петя Сидоров", age: 10, parent: "Анна С.", allergies: "глютен", nextBirthday: "2026-08-25" },
            ].map((k, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={`https://i.pravatar.cc/80?u=${i}`} alt={k.name} />
                  <AvatarFallback>{k.name.slice(0, 2)}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="text-sm font-medium">{k.name} ({k.age} лет)</div>
                  <div className="text-xs text-muted-foreground">Родитель: {k.parent}</div>
                </div>
                {k.allergies !== "—" && (
                  <Badge variant="outline" className="text-red-700 border-red-300">
                    <AlertTriangle className="w-3 h-3 mr-1" /> {k.allergies}
                  </Badge>
                )}
                <Badge variant="secondary" className="text-[10px]">
                  {formatDate(k.nextBirthday)}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "partners" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Партнёры-кондитеры</h3>
          <div className="space-y-2">
            {[
              { name: "Сладкая уездная", rating: 4.9, orders: 8, discount: 10, specialties: ["детские торты", "мультгерои"] },
              { name: "Татьяна-Кондитер", rating: 4.8, orders: 4, discount: 10, specialties: ["ПП торты", "без глютена"] },
              { name: "Сахарный Лебедь", rating: 5.0, orders: 2, discount: 5, specialties: ["авторские", "реалистичные"] },
            ].map((p, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border border-border/60 rounded-lg">
                <Avatar>
                  <AvatarImage src={`https://i.pravatar.cc/80?u=${p.name}`} alt={p.name} />
                  <AvatarFallback>{p.name.slice(0, 2)}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.specialties.join(", ")}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary" className="text-[10px]">
                      <Star className="w-3 h-3 mr-1 fill-amber-400 text-amber-400" />
                      {p.rating}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{p.orders} заказов</span>
                  </div>
                </div>
                <Badge variant="outline" className="text-emerald-700 border-emerald-300">
                  -{p.discount}%
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "orders" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">История заказов тортов</h3>
          <div className="space-y-2">
            {[
              { date: "2026-08-12", child: "Лена В.", cake: "Шоколадный", price: 3500, confectioner: "Сладкая уездная" },
              { date: "2026-08-05", child: "Ваня П.", cake: "Minecraft", price: 5200, confectioner: "Сахарный Лебедь" },
              { date: "2026-07-29", child: "Катя С.", cake: "PP без сахара", price: 4200, confectioner: "Татьяна-Кондитер" },
            ].map((o, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                <Gift className="w-5 h-5 text-purple-500" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{o.cake} для {o.child}</div>
                  <div className="text-xs text-muted-foreground">{formatDate(o.date)} • {o.confectioner}</div>
                </div>
                <div className="font-semibold">{formatCurrency(o.price)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "earnings" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Расходы на торты (по месяцам)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={[
              { month: "Мар", value: 32000 },
              { month: "Апр", value: 38000 },
              { month: "Май", value: 42000 },
              { month: "Июн", value: 39000 },
              { month: "Июл", value: 45000 },
              { month: "Авг", value: 48000 },
            ]}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.90 0.015 70)" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v / 1000}k`} />
              <Tooltip formatter={(v: number) => [formatCurrency(v), "Расход"]} />
              <Line dataKey="value" stroke="#ec4899" strokeWidth={3} dot={{ fill: "#ec4899", r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {tab === "listings" && <ServicesManager />}

      {tab === "settings" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Настройки клуба</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Название клуба</div>
              <div className="font-medium">Солнышко Kids Club</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Адрес</div>
              <div className="font-medium">г. Москва, ул. Радужная, 7</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Возрастные группы</div>
              <div className="font-medium">3-6, 7-10, 11-14</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Скидка от кондитеров</div>
              <div className="font-medium">10% (согласованная)</div>
            </div>
          </div>
        </Card>
      )}
    </DashboardShell>
  );
}

// ==================== INSPECTOR (Внутренний аудитор) ====================
export function InspectorDashboard() {
  const { user, logout } = useAppStore();
  const [tab, setTab] = useState("overview");

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>Войти</Button>
      </div>
    );
  }

  const tabs = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "auditLog", label: "Аудит-лог", icon: Database, badge: "1.2K" },
    { id: "fraud", label: "Антифрод", icon: ShieldAlert, badge: "5" },
    { id: "payouts", label: "Выплаты", icon: DollarSign, badge: "12" },
    { id: "taxReports", label: "Налоги", icon: FileText },
    { id: "violations", label: "Нарушения", icon: AlertTriangle },
    { id: "settings", label: "Настройки", icon: Settings },
  ];

  return (
    <DashboardShell
      user={user}
      logout={logout}
      title="Кабинет внутреннего инспектора"
      role="INSPECTOR"
      icon={ShieldCheck}
      gradient="from-slate-700 via-red-700 to-rose-900"
      tabs={tabs}
      activeTab={tab}
      onTab={setTab}
    >
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Database} label="Аудит-записей" value="1 247" change="+89" color="text-slate-600" />
            <StatCard icon={ShieldAlert} label="Подозрительных" value="5" change="+2" color="text-red-500" />
            <StatCard icon={DollarSign} label="Сумма выплат" value="2.4M ₽" color="text-emerald-600" />
            <StatCard icon={AlertTriangle} label="Нарушений" value="3" color="text-amber-500" />
          </div>

          <Card className="p-5 border-border/60 bg-red-50/50 border-red-200">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-8 h-8 text-red-600 mt-1" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-900">Требует внимания</h3>
                <ul className="text-sm text-red-800 mt-2 space-y-1">
                  <li>• 2 выплаты превышают средний чек кондитера в 5 раз — проверить</li>
                  <li>• 3 заказа с одного IP за 24ч — возможный мультиаккаунтинг</li>
                  <li>• Кондитер «Сладкая уездная» — рост заказов +400% (анализировать маркетинг или накрутку)</li>
                  <li>• Возврат 18 000₽ без указания причины — ручная проверка</li>
                </ul>
              </div>
            </div>
          </Card>

          <Card className="p-5 border-border/60">
            <h3 className="font-semibold mb-3">Последние аудит-события</h3>
            <div className="space-y-2">
              {[
                { type: "payout_request", user: "Сладкая уездная", amount: 45000, time: "5 мин назад", severity: "info" },
                { type: "refund_processed", user: "Мария С.", amount: 3500, time: "12 мин назад", severity: "warning" },
                { type: "fraud_block", user: "suspicious_user_42", amount: 0, time: "1 час назад", severity: "critical" },
                { type: "tax_report_generated", user: "Сахарный Лебедь", amount: 0, time: "2 часа назад", severity: "info" },
                { type: "large_order", user: "ООО Ромашка", amount: 87000, time: "3 часа назад", severity: "warning" },
              ].map((e, i) => (
                <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                  <FileSearch className={`w-5 h-5 ${
                    e.severity === "critical" ? "text-red-500" :
                    e.severity === "warning" ? "text-amber-500" :
                    "text-blue-500"
                  }`} />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{e.type}</div>
                    <div className="text-xs text-muted-foreground">
                      {e.user} • {e.time}
                    </div>
                  </div>
                  {e.amount > 0 && (
                    <div className="font-semibold">{formatCurrency(e.amount)}</div>
                  )}
                  <Badge variant={
                    e.severity === "critical" ? "destructive" :
                    e.severity === "warning" ? "secondary" :
                    "outline"
                  }>
                    {e.severity}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "auditLog" && (
        <Card className="p-5 border-border/60">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Полный аудит-лог</h3>
            <Button variant="outline" size="sm">
              <Database className="w-4 h-4 mr-1" /> Экспорт CSV
            </Button>
          </div>
          <div className="text-sm text-muted-foreground mb-4">
            Фильтры: по дате, типу события, пользователю, сумме
          </div>
          <EmptyState
            icon={Database}
            title="1 247 записей"
            text="Отображаются последние 100 записей. Используйте фильтры для поиска конкретных событий."
          />
        </Card>
      )}

      {tab === "fraud" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Подозрительные операции (5)</h3>
          <div className="space-y-2">
            {[
              { user: "guest_8472", reason: "3 заказа с одного IP за 24ч", risk: 78, action: "block" },
              { user: "Сладкая уездная", reason: "Рост заказов +400% за неделю", risk: 65, action: "review" },
              { user: "user_3921", reason: "Возврат без причины 18 000₽", risk: 55, action: "review" },
              { user: "unknown_42", reason: "Карта в чёрном списке Yookassa", risk: 95, action: "block" },
              { user: "Татьяна-К.", reason: " payout > 5× средний чек", risk: 45, action: "review" },
            ].map((f, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border border-border/60 rounded-lg">
                <ShieldAlert className={`w-5 h-5 ${
                  f.risk > 80 ? "text-red-500" : f.risk > 60 ? "text-amber-500" : "text-blue-500"
                }`} />
                <div className="flex-1">
                  <div className="text-sm font-medium">{f.user}</div>
                  <div className="text-xs text-muted-foreground">{f.reason}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold">Risk: {f.risk}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {f.action === "block" ? "Рекомендация: блокировка" : "Рекомендация: ревью"}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={f.action === "block" ? "destructive" : "outline"}
                >
                  {f.action === "block" ? "Заблокировать" : "Проверить"}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "payouts" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Запросы на выплату (на проверке: 12)</h3>
          <div className="space-y-2">
            {[
              { confectioner: "Сладкая уездная", amount: 45000, average: 8000, multiplier: "5.6×", status: "review" },
              { confectioner: "Татьяна-Кондитер", amount: 28000, average: 5000, multiplier: "5.6×", status: "review" },
              { confectioner: "Сахарный Лебедь", amount: 67000, average: 15000, multiplier: "4.5×", status: "review" },
              { confectioner: "Кондитерская Купец", amount: 120000, average: 30000, multiplier: "4×", status: "approved" },
            ].map((p, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                <DollarSign className="w-5 h-5 text-emerald-500" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{p.confectioner}</div>
                  <div className="text-xs text-muted-foreground">
                    Средний чек: {formatCurrency(p.average)} • Запрос: {p.multiplier} от среднего
                  </div>
                </div>
                <div className="font-semibold">{formatCurrency(p.amount)}</div>
                <Badge variant={p.status === "approved" ? "default" : "secondary"}>
                  {p.status === "approved" ? "✓ Одобрено" : "На ревью"}
                </Badge>
                {p.status !== "approved" && (
                  <>
                    <Button size="sm" variant="outline">Одобрить</Button>
                    <Button size="sm" variant="destructive">Отклонить</Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "taxReports" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Налоговые отчёты за период</h3>
          <div className="space-y-2">
            {[
              { period: "Q2 2026", confectioners: 47, grossIncome: 2840000, tax: 284000, status: "verified" },
              { period: "Q1 2026", confectioners: 38, grossIncome: 1920000, tax: 192000, status: "verified" },
              { period: "Q4 2025", confectioners: 32, grossIncome: 2150000, tax: 215000, status: "verified" },
              { period: "Q3 2025", confectioners: 28, grossIncome: 1680000, tax: 168000, status: "anomaly" },
            ].map((t, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                <FileText className="w-5 h-5 text-blue-500" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{t.period}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.confectioners} кондитеров • Валовый доход: {formatCurrency(t.grossIncome)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">Налог: {formatCurrency(t.tax)}</div>
                  {t.status === "anomaly" && (
                    <div className="text-[10px] text-amber-600">⚠ Аномалия: рост +45%</div>
                  )}
                </div>
                <Button size="sm" variant="outline">
                  <FileSearch className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "violations" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Журнал нарушений</h3>
          <div className="space-y-2">
            {[
              { user: "Сладкая уездная", type: "Цена ниже рынка", severity: "medium", date: "2026-08-12" },
              { user: "guest_8472", type: "Мультиаккаунтинг", severity: "high", date: "2026-08-10" },
              { user: "Конф. Без названия", type: "Отсутствуют документы", severity: "low", date: "2026-08-08" },
            ].map((v, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border-b last:border-0">
                <AlertTriangle className={`w-5 h-5 ${
                  v.severity === "high" ? "text-red-500" :
                  v.severity === "medium" ? "text-amber-500" :
                  "text-blue-500"
                }`} />
                <div className="flex-1">
                  <div className="text-sm font-medium">{v.user}</div>
                  <div className="text-xs text-muted-foreground">{v.type} • {formatDate(v.date)}</div>
                </div>
                <Badge variant={v.severity === "high" ? "destructive" : "secondary"}>
                  {v.severity}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "settings" && (
        <Card className="p-5 border-border/60">
          <h3 className="font-semibold mb-3">Профиль инспектора</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">ФИО</div>
              <div className="font-medium">Аудитор А.И.</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Должность</div>
              <div className="font-medium">Внутренний аудитор</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Уровень доступа</div>
              <div className="font-medium">3 (полный)</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Сертификации</div>
              <div className="font-medium">ACCA, CIA</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Заморозка счетов</div>
              <div className="font-medium text-emerald-600">✓ Разрешено</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Подпись налоговых отчётов</div>
              <div className="font-medium text-emerald-600">✓ Разрешено</div>
            </div>
          </div>
        </Card>
      )}
    </DashboardShell>
  );
}
