"use client";

import { useState, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShoppingCart, Search, Eye, MessageSquare, Truck, Check, X,
  Clock, AlertCircle, Phone, Mail, User, MapPin, Calendar,
  CreditCard, FileText, Download, Filter, Package,
} from "lucide-react";
import { formatCurrency, formatDate, ORDER_STATUS_LABELS } from "@/lib/finance";
import { toast } from "sonner";
import type { Order, OrderStatus } from "@/lib/types";

const ORDER_STATUSES: OrderStatus[] = [
  "PENDING", "CONFIRMED", "IN_PROGRESS", "READY", "DELIVERING", "COMPLETED", "CANCELLED", "DISPUTE",
];

export function AdminOrdersManager() {
  const orders = useAppStore((s) => s.orders);
  const confectioners = useAppStore((s) => s.confectioners);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterConfectioner, setFilterConfectioner] = useState<string>("all");
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null);

  const updateOrderStatus = (orderId: string, status: OrderStatus) => {
    useAppStore.setState((s) => ({
      orders: s.orders.map((o) => o.id === orderId ? { ...o, status } : o),
    }));
    toast.success("Статус заказа обновлён", { description: `${orderId} → ${ORDER_STATUS_LABELS[status].label}` });
    if (viewingOrder?.id === orderId) {
      setViewingOrder({ ...viewingOrder, status });
    }
  };

  const filtered = useMemo(() => {
    return orders.filter((o: any) => {
      if (search) {
        const q = search.toLowerCase();
        if (!o.number.toLowerCase().includes(q) && !o.customerName?.toLowerCase().includes(q) && !o.confectionerName?.toLowerCase().includes(q)) return false;
      }
      if (filterStatus !== "all" && o.status !== filterStatus) return false;
      if (filterConfectioner !== "all" && o.confectionerId !== filterConfectioner) return false;
      return true;
    });
  }, [orders, search, filterStatus, filterConfectioner]);

  const stats = {
    total: orders.length,
    pending: orders.filter((o) => o.status === "PENDING").length,
    inProgress: orders.filter((o) => ["CONFIRMED", "IN_PROGRESS", "READY", "DELIVERING"].includes(o.status)).length,
    completed: orders.filter((o) => o.status === "COMPLETED").length,
    revenue: orders.filter((o) => o.status === "COMPLETED").reduce((sum, o) => sum + o.total, 0),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            Заказы платформы
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Управление всеми заказами, смена статусов, связь с исполнителями
          </p>
        </div>
        <Button variant="outline" size="sm">
          <Download className="h-3.5 w-3.5 mr-1" />Экспорт
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Всего</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Новые</div>
          <div className="text-2xl font-bold text-amber-600">{stats.pending}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">В работе</div>
          <div className="text-2xl font-bold text-blue-600">{stats.inProgress}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Завершено</div>
          <div className="text-2xl font-bold text-emerald-600">{stats.completed}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Выручка</div>
          <div className="text-2xl font-bold text-emerald-700">{formatCurrency(stats.revenue)}</div>
        </Card>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="relative md:col-span-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по номеру, клиенту, кондитеру..."
            className="pl-9"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger><SelectValue placeholder="Статус" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            {ORDER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{ORDER_STATUS_LABELS[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterConfectioner} onValueChange={setFilterConfectioner}>
          <SelectTrigger><SelectValue placeholder="Кондитер" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все кондитеры</SelectItem>
            {confectioners.map((c: any) => (
              <SelectItem key={c.id} value={c.id}>{c.businessName || c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Заказы не найдены. Измените фильтры.
          </Card>
        ) : filtered.map((o: any) => (
          <Card key={o.id} className="p-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{o.number}</span>
                <Badge variant="outline" className={`text-[10px] ${ORDER_STATUS_LABELS[o.status].color}`}>
                  {ORDER_STATUS_LABELS[o.status].label}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                <User className="h-3 w-3 inline mr-1" />
                {o.customerName}
                {o.confectionerName && (
                  <span> → <Package className="h-3 w-3 inline mx-0.5" />{o.confectionerName}</span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                <Calendar className="h-3 w-3 inline mr-0.5" />
                {formatDate(o.createdAt)}
                {o.deliveryDate && (
                  <span className="ml-2">Доставка: {formatDate(o.deliveryDate)}{o.deliveryTime ? ` ${o.deliveryTime}` : ""}</span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-sm">{formatCurrency(o.total)}</div>
              <div className="text-[10px] text-muted-foreground">
                {o.items?.length || 0} тов. • {o.paymentMethod}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setViewingOrder(o)}>
              <Eye className="h-3.5 w-3.5 mr-1" />Открыть
            </Button>
          </Card>
        ))}
      </div>

      {/* Order Details Dialog */}
      {viewingOrder && (
        <OrderDetailsDialog
          order={viewingOrder}
          onClose={() => setViewingOrder(null)}
          onStatusChange={updateOrderStatus}
          confectioners={confectioners}
        />
      )}
    </div>
  );
}

// =================== Order Details Dialog ===================
function OrderDetailsDialog({
  order,
  onClose,
  onStatusChange,
  confectioners,
}: {
  order: Order;
  onClose: () => void;
  onStatusChange: (id: string, status: OrderStatus) => void;
  confectioners: any[];
}) {
  const setChatOpen = useAppStore((s) => s.setChatOpen);
  const setActiveChatRoom = useAppStore((s) => s.setActiveChatRoom);
  const chatRooms = useAppStore((s) => s.chatRooms);
  const user = useAppStore((s) => s.user);

  // Находим кондитера
  const confectioner = confectioners.find((c) => c.id === order.confectionerId);
  // Находим или создаём чат-комнату с кондитером
  const existingRoom = chatRooms.find(
    (r) => r.type === "direct" && r.participants?.some((p) => p.id === order.confectionerId)
  );

  const handleChatWithConfectioner = () => {
    if (existingRoom) {
      setActiveChatRoom(existingRoom.id);
      setChatOpen(true);
      onClose();
      return;
    }
    // Создаём новую комнату
    const newRoom = {
      id: `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "direct" as const,
      name: confectioner?.businessName || confectioner?.name || "Кондитер",
      avatar: confectioner?.avatar,
      participants: [
        { id: user?.id || "admin", name: user?.name || "Администратор", avatar: user?.avatar },
        { id: order.confectionerId || "conf", name: confectioner?.businessName || confectioner?.name || "Конфитер", avatar: confectioner?.avatar },
      ],
      lastMessage: undefined,
      lastMessageAt: undefined,
      unreadCount: 0,
    };
    useAppStore.setState((s) => ({
      chatRooms: [newRoom, ...s.chatRooms],
      activeChatRoom: newRoom.id,
      chatOpen: true,
    }));
    toast.success("Чат с кондитером открыт", {
      description: confectioner?.businessName || confectioner?.name,
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            Заказ {order.number}
            <Badge variant="outline" className={`text-[10px] ${ORDER_STATUS_LABELS[order.status].color}`}>
              {ORDER_STATUS_LABELS[order.status].label}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Создан {formatDate(order.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status change */}
          <Card className="p-3">
            <Label className="text-xs font-semibold">Управление статусом</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {ORDER_STATUSES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={order.status === s ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => onStatusChange(order.id, s)}
                >
                  {order.status === s && <Check className="h-3 w-3 mr-1" />}
                  {ORDER_STATUS_LABELS[s].label}
                </Button>
              ))}
            </div>
          </Card>

          {/* Customer + Confectioner info */}
          <div className="grid md:grid-cols-2 gap-3">
            <Card className="p-3">
              <div className="text-xs font-semibold mb-2 flex items-center gap-1">
                <User className="h-3.5 w-3.5" />Покупатель
              </div>
              <div className="text-sm font-medium">{order.customerName}</div>
              {order.deliveryAddress && (
                <div className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                  <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                  {order.deliveryAddress}
                </div>
              )}
              {order.comment && (
                <div className="text-xs text-muted-foreground mt-2 p-2 bg-muted rounded">
                  <FileText className="h-3 w-3 inline mr-1" />
                  {order.comment}
                </div>
              )}
            </Card>

            <Card className="p-3">
              <div className="text-xs font-semibold mb-2 flex items-center gap-1">
                <Package className="h-3.5 w-3.5" />Исполнитель (кондитер)
              </div>
              {confectioner ? (
                <>
                  <div className="text-sm font-medium">{confectioner.businessName || confectioner.name}</div>
                  {confectioner.phone && (
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Phone className="h-3 w-3" />{confectioner.phone}
                    </div>
                  )}
                  {confectioner.email && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Mail className="h-3 w-3" />{confectioner.email}
                    </div>
                  )}
                  <Button
                    size="sm"
                    className="w-full mt-2"
                    onClick={handleChatWithConfectioner}
                  >
                    <MessageSquare className="h-3.5 w-3.5 mr-1" />
                    Написать кондитеру
                  </Button>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">Кондитер не назначен</div>
              )}
            </Card>
          </div>

          {/* Items */}
          <Card className="p-3">
            <div className="text-xs font-semibold mb-2">Состав заказа</div>
            <div className="space-y-2">
              {(order.items || []).map((item: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <img src={item.image} alt="" className="w-10 h-10 rounded object-cover" loading="lazy" decoding="async" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium line-clamp-1">{item.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.quantity} шт. × {formatCurrency(item.price)}
                      {item.customization?.filling && ` • ${item.customization.filling}`}
                      {item.customization?.inscription && ` • «${item.customization.inscription}»`}
                    </div>
                  </div>
                  <div className="font-medium">{formatCurrency(item.price * item.quantity)}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Payment */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Card className="p-2">
              <div className="text-muted-foreground">Оплата</div>
              <div className="font-medium flex items-center gap-1">
                <CreditCard className="h-3 w-3" />{order.paymentMethod}
              </div>
            </Card>
            <Card className="p-2">
              <div className="text-muted-foreground">Статус оплаты</div>
              <div className="font-medium">{order.paymentStatus}</div>
            </Card>
            <Card className="p-2">
              <div className="text-muted-foreground">Доставка</div>
              <div className="font-medium flex items-center gap-1">
                <Truck className="h-3 w-3" />{formatCurrency(order.deliveryCost)}
              </div>
            </Card>
            <Card className="p-2">
              <div className="text-muted-foreground">Итого</div>
              <div className="font-bold text-primary">{formatCurrency(order.total)}</div>
            </Card>
          </div>

          {/* Order timeline */}
          <Card className="p-3">
            <div className="text-xs font-semibold mb-2">Хронология</div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span>Заказ создан: {formatDate(order.createdAt)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-3 w-3 text-muted-foreground" />
                <span>Доставка: {formatDate(order.deliveryDate)}{order.deliveryTime ? ` в ${order.deliveryTime}` : ""}</span>
              </div>
              {order.status === "COMPLETED" && (
                <div className="flex items-center gap-2 text-emerald-600">
                  <Check className="h-3 w-3" />
                  <span>Заказ завершён</span>
                </div>
              )}
              {order.status === "CANCELLED" && (
                <div className="flex items-center gap-2 text-red-600">
                  <X className="h-3 w-3" />
                  <span>Заказ отменён</span>
                </div>
              )}
              {order.status === "DISPUTE" && (
                <div className="flex items-center gap-2 text-amber-600">
                  <AlertCircle className="h-3 w-3" />
                  <span>Спор открыт — требуется разбирательство</span>
                </div>
              )}
            </div>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Закрыть</Button>
          {order.status !== "COMPLETED" && order.status !== "CANCELLED" && (
            <>
              {order.status !== "DISPUTE" && (
                <Button
                  variant="outline"
                  className="text-amber-600 border-amber-300 hover:bg-amber-50"
                  onClick={() => onStatusChange(order.id, "DISPUTE")}
                >
                  <AlertCircle className="h-4 w-4 mr-1" />Открыть спор
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={() => {
                  if (confirm("Отменить заказ?")) {
                    onStatusChange(order.id, "CANCELLED");
                  }
                }}
              >
                <X className="h-4 w-4 mr-1" />Отменить
              </Button>
              <Button
                onClick={() => onStatusChange(order.id, "COMPLETED")}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <Check className="h-4 w-4 mr-1" />Завершить
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
