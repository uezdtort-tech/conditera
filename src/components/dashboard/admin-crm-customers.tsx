"use client";

/**
 * CRM: Карточка клиента с timeline всех взаимодействий.
 * Показывает: профиль, статистику, заказы, тикеты, чаты, отзывы, лиды.
 */
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Search,
  User,
  ShoppingCart,
  MessageSquare,
  Star,
  TrendingUp,
  Phone,
  Mail,
  MapPin,
  Calendar,
  DollarSign,
  Package,
  AlertCircle,
  Clock,
} from "lucide-react";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/finance";

const INTERACTION_ICONS: Record<string, typeof User> = {
  order: ShoppingCart,
  ticket: MessageSquare,
  chat: MessageSquare,
  call: Phone,
  email: Mail,
  review: Star,
  referral: User,
  payment: DollarSign,
  refund: DollarSign,
  dispute: AlertCircle,
  note: User,
  other: User,
};

const INTERACTION_COLORS: Record<string, string> = {
  order: "bg-emerald-500",
  ticket: "bg-blue-500",
  chat: "bg-purple-500",
  call: "bg-amber-500",
  email: "bg-cyan-500",
  review: "bg-yellow-500",
  referral: "bg-pink-500",
  payment: "bg-green-600",
  refund: "bg-red-500",
  dispute: "bg-red-600",
  note: "bg-slate-500",
  other: "bg-slate-400",
};

export function AdminCustomersTab() {
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      // Используем существующий /api/admin/users если есть, иначе поиск через chat-rooms
      const res = await fetch(`/api/crm/tickets?limit=100`);
      if (res.ok) {
        const data = await res.json();
        // Извлекаем уникальных клиентов из тикетов
        const seen = new Set<string>();
        const list: any[] = [];
        for (const t of data.tickets || []) {
          if (!seen.has(t.customerId)) {
            seen.add(t.customerId);
            list.push({
              id: t.customerId,
              name: t.customerName,
              email: t.customerEmail,
            });
          }
        }
        setCustomers(list);
      }
    } catch (err) {
      console.error("Failed to load customers:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const filtered = customers.filter(
    (c) =>
      !search ||
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <User className="h-5 w-5 text-primary" />
          Клиенты — CRM
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Карточка клиента с timeline: заказы, тикеты, чаты, отзывы
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по имени или email..."
          className="pl-9 max-w-md"
        />
      </div>

      <div className="space-y-2">
        {loading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Загрузка клиентов...
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Клиенты не найдены. Создайте тикет, чтобы клиенты появились в CRM.
          </Card>
        ) : (
          filtered.map((customer) => (
            <Card
              key={customer.id}
              className="p-3 flex items-center gap-3 cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => setSelectedCustomerId(customer.id)}
            >
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarFallback>{customer.name?.slice(0, 2)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{customer.name}</div>
                {customer.email && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Mail className="h-3 w-3" />{customer.email}
                  </div>
                )}
              </div>
              <Button size="sm" variant="outline">
                Открыть карточку
              </Button>
            </Card>
          ))
        )}
      </div>

      {selectedCustomerId && (
        <CustomerCardDialog
          customerId={selectedCustomerId}
          onClose={() => setSelectedCustomerId(null)}
        />
      )}
    </div>
  );
}

// =================== Customer Card Dialog with Timeline ===================
function CustomerCardDialog({
  customerId,
  onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/crm/customers/${customerId}`)
      .then((res) => res.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [customerId]);

  if (loading) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-3xl">
          <div className="text-center py-8 text-sm text-muted-foreground">
            Загрузка карточки клиента...
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!data || !data.customer) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-3xl">
          <div className="text-center py-8 text-sm text-muted-foreground">
            Клиент не найден
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const { customer, stats, timeline } = data;

  // Объединяем все события в один timeline
  const allEvents: any[] = [
    ...(timeline.orders || []).map((o: any) => ({
      ...o,
      type: "order",
      date: o.createdAt,
      title: `Заказ ${o.number}`,
      description: `${formatCurrency(o.total)} • ${o.confectionerName || ""}`,
      icon: "order",
    })),
    ...(timeline.tickets || []).map((t: any) => ({
      ...t,
      type: "ticket",
      date: t.createdAt,
      title: `Тикет ${t.number}`,
      description: t.subject,
      icon: "ticket",
    })),
    ...(timeline.interactions || []).map((i: any) => ({
      ...i,
      type: i.type,
      date: i.createdAt,
      title: i.subject || i.type,
      description: i.description || "",
      icon: i.type,
    })),
    ...(timeline.reviews || []).map((r: any) => ({
      ...r,
      type: "review",
      date: r.createdAt,
      title: `Отзыв ${r.rating}★`,
      description: r.text?.slice(0, 100),
      icon: "review",
    })),
    ...(timeline.leads || []).map((l: any) => ({
      ...l,
      type: "lead",
      date: l.createdAt,
      title: `Лид: ${l.name}`,
      description: l.status,
      icon: "note",
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar className="h-14 w-14">
              <AvatarImage src={customer.avatar} alt={customer.name} />
              <AvatarFallback className="text-lg">{customer.name?.slice(0, 2)}</AvatarFallback>
            </Avatar>
            <div>
              <DialogTitle className="text-lg">{customer.name}</DialogTitle>
              <DialogDescription className="flex items-center gap-3 flex-wrap mt-1">
                {customer.email && (
                  <span className="flex items-center gap-1 text-xs">
                    <Mail className="h-3 w-3" />{customer.email}
                  </span>
                )}
                {customer.phone && (
                  <span className="flex items-center gap-1 text-xs">
                    <Phone className="h-3 w-3" />{customer.phone}
                  </span>
                )}
                {customer.city && (
                  <span className="flex items-center gap-1 text-xs">
                    <MapPin className="h-3 w-3" />{customer.city}
                  </span>
                )}
                <span className="flex items-center gap-1 text-xs">
                  <Calendar className="h-3 w-3" />
                  с {formatDate(customer.createdAt)}
                </span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Статистика */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <ShoppingCart className="h-3 w-3" />Заказов
            </div>
            <div className="text-xl font-bold">{stats.totalOrders}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3 w-3" />Потрачено
            </div>
            <div className="text-xl font-bold text-emerald-700">{formatCurrency(stats.totalSpent)}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />Открытых тикетов
            </div>
            <div className="text-xl font-bold text-amber-600">{stats.openTickets}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Star className="h-3 w-3" />Средний рейтинг
            </div>
            <div className="text-xl font-bold">
              {stats.avgRating > 0 ? `${stats.avgRating.toFixed(1)}★` : "—"}
            </div>
          </Card>
        </div>

        {/* Timeline */}
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" />История взаимодействий
          </h3>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {allEvents.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                Взаимодействий пока нет
              </div>
            ) : (
              allEvents.slice(0, 50).map((event, i) => {
                const Icon = INTERACTION_ICONS[event.icon] || User;
                const color = INTERACTION_COLORS[event.icon] || "bg-slate-400";
                return (
                  <div key={i} className="flex gap-3 p-2 hover:bg-muted/30 rounded-lg">
                    <div className={`w-8 h-8 rounded-full ${color} flex items-center justify-center shrink-0`}>
                      <Icon className="h-4 w-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{event.title}</span>
                        <Badge variant="outline" className="text-[9px]">
                          {event.type}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {formatDateTime(event.date)}
                        </span>
                      </div>
                      {event.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {event.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
