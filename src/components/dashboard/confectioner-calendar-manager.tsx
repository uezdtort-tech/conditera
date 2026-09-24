"use client";

/**
 * Confectioner calendar — full order schedule with:
 *   - Customer name per order
 *   - Delivery time
 *   - Order count per day (badge)
 *   - Order status (confirmed/pending/negotiating)
 *   - Request time/place change from customer (negotiation)
 *   - Day detail view with all orders
 */
import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Calendar as CalendarIcon, Clock, MapPin, User, MessageCircle, ChevronLeft, ChevronRight,
  CheckCircle2, AlertCircle, Package,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { formatCurrency, formatDate, ORDER_STATUS_LABELS } from "@/lib/finance";
import { toast } from "sonner";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700 border-amber-200",
  NEGOTIATING: "bg-blue-100 text-blue-700 border-blue-200",
  CONFIRMED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  PREPARING: "bg-purple-100 text-purple-700 border-purple-200",
  READY: "bg-cyan-100 text-cyan-700 border-cyan-200",
  IN_DELIVERY: "bg-indigo-100 text-indigo-700 border-indigo-200",
  DELIVERED: "bg-green-100 text-green-700 border-green-200",
  COMPLETED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-100 text-red-700 border-red-200",
};

export function ConfectionerCalendarManager({ confectionerId }: { confectionerId: string }) {
  const orders = useAppStore((s) => s.orders);
  const setChatOpen = useAppStore((s) => s.setChatOpen);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [negotiateOrder, setNegotiateOrder] = useState<string | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const myOrders = orders.filter((o) => o.confectionerId === confectionerId);

  // Group orders by day
  const ordersByDay = useMemo(() => {
    const map = new Map<number, typeof myOrders>();
    for (const order of myOrders) {
      const d = new Date(order.deliveryDate);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        if (!map.has(day)) map.set(day, []);
        map.get(day)!.push(order);
      }
    }
    return map;
  }, [myOrders, year, month]);

  // Calendar grid
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = (firstDay.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = lastDay.getDate();
  const today = new Date();
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const selectedDayOrders = selectedDay ? ordersByDay.get(selectedDay) || [] : [];

  // Stats
  const totalThisMonth = myOrders.filter((o) => {
    const d = new Date(o.deliveryDate);
    return d.getFullYear() === year && d.getMonth() === month;
  }).length;

  const pendingCount = myOrders.filter((o) => o.status === "PENDING" || o.status === "NEGOTIATING").length;
  const confirmedCount = myOrders.filter((o) => o.status === "CONFIRMED" || o.status === "PREPARING").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <CalendarIcon className="h-6 w-6 text-primary" />
            Календарь заказов
          </h1>
          <div className="flex gap-3 mt-1 text-sm text-muted-foreground">
            <span>{totalThisMonth} заказов в {MONTHS[month].toLowerCase()}</span>
            <span className="text-amber-600">⏳ {pendingCount} ожидают</span>
            <span className="text-emerald-600">✓ {confirmedCount} подтверждены</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="font-medium min-w-[140px] text-center">{MONTHS[month]} {year}</span>
          <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Calendar grid */}
      <Card className="p-4">
        <div className="grid grid-cols-7 gap-1 text-center mb-2">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-xs font-semibold text-muted-foreground py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {/* Empty cells before first day */}
          {Array.from({ length: startWeekday }).map((_, i) => (
            <div key={`empty-${i}`} className="aspect-square" />
          ))}
          {/* Day cells */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dayOrders = ordersByDay.get(day) || [];
            const hasOrders = dayOrders.length > 0;
            const isCurrentDay = isToday(day);
            const isSelected = selectedDay === day;

            return (
              <button
                key={day}
                onClick={() => hasOrders && setSelectedDay(day)}
                className={`aspect-square p-1 rounded-lg border text-sm transition-all relative ${
                  isSelected
                    ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                    : isCurrentDay
                    ? "border-primary/40 bg-primary/5"
                    : hasOrders
                    ? "border-primary/30 bg-primary/5 hover:bg-primary/10"
                    : "border-border hover:border-primary/20"
                }`}
              >
                <div className={`text-xs ${isCurrentDay ? "font-bold text-primary" : ""}`}>{day}</div>
                {hasOrders && (
                  <div className="absolute bottom-1 left-1 right-1 flex flex-col items-center gap-0.5">
                    {/* Order count badge */}
                    <span className="text-[9px] bg-primary text-white px-1 rounded-full leading-tight">
                      {dayOrders.length}
                    </span>
                    {/* Status indicators */}
                    <div className="flex gap-0.5">
                      {dayOrders.slice(0, 3).map((o, idx) => (
                        <div
                          key={idx}
                          className={`w-1.5 h-1.5 rounded-full ${
                            o.status === "CONFIRMED" || o.status === "COMPLETED" ? "bg-emerald-500"
                            : o.status === "PENDING" || o.status === "NEGOTIATING" ? "bg-amber-500"
                            : o.status === "CANCELLED" ? "bg-red-500"
                            : "bg-blue-500"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500" /> Подтверждён</span>
        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-amber-500" /> Ожидает согласования</span>
        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500" /> В работе</span>
        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500" /> Отменён</span>
      </div>

      {/* Selected day orders */}
      {selectedDay && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">
              {selectedDay} {MONTHS[month].toLowerCase()} — {selectedDayOrders.length} заказ(ов)
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setSelectedDay(null)}>✕</Button>
          </div>
          <div className="space-y-2">
            {selectedDayOrders.map((order) => {
              const statusLabel = ORDER_STATUS_LABELS[order.status] || { label: order.status, color: "" };
              return (
                <div key={order.id} className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/30">
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarFallback>{order.customerName?.[0] || "?"}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{order.customerName}</span>
                      <Badge className={`text-[10px] ${STATUS_COLORS[order.status] || ""}`}>{statusLabel.label}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <div className="flex items-center gap-1"><Clock className="h-3 w-3" />{order.deliveryTime || "время не указано"}</div>
                      {order.deliveryAddress && <div className="flex items-center gap-1"><MapPin className="h-3 w-3" />{order.deliveryAddress}</div>}
                      <div className="flex items-center gap-1"><Package className="h-3 w-3" />{order.items.length} тов. · {formatCurrency(order.total)}</div>
                    </div>
                    {/* Items preview */}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {order.items.slice(0, 3).map((item, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">{item.title} ×{item.quantity}</Badge>
                      ))}
                      {order.items.length > 3 && <Badge variant="secondary" className="text-[10px]">+{order.items.length - 3}</Badge>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button size="sm" variant="outline" onClick={() => { setChatOpen(true); toast.info(`Чат с ${order.customerName}`); }}>
                      <MessageCircle className="h-3 w-3 mr-1" /> Чат
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setNegotiateOrder(order.id)}>
                      <Clock className="h-3 w-3 mr-1" /> Изменить
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Negotiation dialog */}
      {negotiateOrder && (
        <NegotiationDialog
          order={myOrders.find((o) => o.id === negotiateOrder)!}
          onClose={() => setNegotiateOrder(null)}
        />
      )}
    </div>
  );
}

function NegotiationDialog({ order, onClose }: { order: any; onClose: () => void }) {
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [message, setMessage] = useState("");

  const handleSend = () => {
    toast.success("Запрос отправлен заказчику", {
      description: "Заказчик получит уведомление для согласования изменений",
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Запрос изменения условий доставки</DialogTitle>
          <DialogDescription>
            Заказчик получит уведомление и сможет принять или отклонить изменения.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">Текущие условия:</div>
            <div className="text-sm">
              📅 {order.deliveryDate ? formatDate(order.deliveryDate) : "—"}
              {order.deliveryTime && ` · ⏰ ${order.deliveryTime}`}
            </div>
            {order.deliveryAddress && <div className="text-sm">📍 {order.deliveryAddress}</div>}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium">Новая дата</label>
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="mt-1 w-full px-2 py-1.5 border rounded text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium">Новое время</label>
              <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="mt-1 w-full px-2 py-1.5 border rounded text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">Новый адрес (если меняется)</label>
            <input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder={order.deliveryAddress || "Адрес доставки"} className="mt-1 w-full px-2 py-1.5 border rounded text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium">Комментарий заказчику</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder="Уважаемый заказчик, прошу согласовать изменение времени доставки..." className="mt-1 w-full px-2 py-1.5 border rounded text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSend}>Отправить запрос</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
