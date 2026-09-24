"use client";

/**
 * CRM: Тикеты поддержки — реальная работа с БД через /api/crm/tickets.
 * Заменяет mock-данные в AdminTicketsTab.
 */
import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  Search,
  Clock,
  User,
  ChevronRight,
  Send,
  Paperclip,
  AlertCircle,
  CheckCircle2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate, formatDateTime } from "@/lib/finance";

const PRIORITY_INFO: Record<string, { label: string; color: string }> = {
  low: { label: "Низкий", color: "bg-blue-500 text-white" },
  medium: { label: "Средне", color: "bg-amber-500 text-white" },
  high: { label: "Срочно", color: "bg-rose-500 text-white" },
  urgent: { label: "Критично", color: "bg-red-700 text-white" },
};

const STATUS_INFO: Record<string, { label: string; color: string }> = {
  open: { label: "Открыт", color: "bg-blue-100 text-blue-700" },
  in_progress: { label: "В работе", color: "bg-amber-100 text-amber-700" },
  waiting: { label: "Ждёт ответа", color: "bg-purple-100 text-purple-700" },
  resolved: { label: "Решён", color: "bg-emerald-100 text-emerald-700" },
  closed: { label: "Закрыт", color: "bg-slate-100 text-slate-700" },
  escalated: { label: "Эскалирован", color: "bg-red-100 text-red-700" },
};

const CATEGORY_LABELS: Record<string, string> = {
  order_issue: "Проблема с заказом",
  payment: "Оплата",
  delivery: "Доставка",
  refund: "Возврат",
  product_quality: "Качество товара",
  confectioner: "Кондитер",
  account: "Аккаунт",
  technical: "Тех. проблема",
  other: "Другое",
};

interface Ticket {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  customerEmail?: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  category?: string;
  assignedTo?: string;
  assignedName?: string;
  orderNumber?: string;
  rating?: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  firstResponseAt?: string;
  resolvedAt?: string;
  messages?: TicketMessage[];
}

interface TicketMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  message: string;
  isInternal: boolean;
  createdAt: string;
}

export function AdminTicketsTab() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      if (search) params.set("search", search);
      const res = await fetch(`/api/crm/tickets?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
      }
    } catch (err) {
      console.error("Failed to load tickets:", err);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const handleStatusChange = async (ticketId: string, status: string) => {
    try {
      const res = await fetch(`/api/crm/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast.success("Статус обновлён");
        loadTickets();
        if (selectedTicket?.id === ticketId) {
          setSelectedTicket({ ...selectedTicket, status });
        }
      }
    } catch {
      toast.error("Ошибка обновления");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Тикеты поддержки
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Обращения пользователей — реальная работа с БД
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" /> Создать тикет
        </Button>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Всего</div>
          <div className="text-2xl font-bold">{tickets.length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Открытых</div>
          <div className="text-2xl font-bold text-blue-600">
            {tickets.filter((t) => t.status === "open").length}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">В работе</div>
          <div className="text-2xl font-bold text-amber-600">
            {tickets.filter((t) => t.status === "in_progress").length}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Решено</div>
          <div className="text-2xl font-bold text-emerald-600">
            {tickets.filter((t) => t.status === "resolved").length}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Срочных</div>
          <div className="text-2xl font-bold text-red-600">
            {tickets.filter((t) => t.priority === "urgent" || t.priority === "high").length}
          </div>
        </Card>
      </div>

      {/* Фильтры */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по номеру, теме, клиенту..."
            className="pl-9"
          />
        </div>
        {[
          { id: "all", l: "Все" },
          { id: "open", l: "Открытые" },
          { id: "in_progress", l: "В работе" },
          { id: "waiting", l: "Ждут ответа" },
          { id: "resolved", l: "Решённые" },
          { id: "escalated", l: "Эскалированные" },
        ].map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "default" : "outline"}
            onClick={() => setFilter(f.id)}
          >
            {f.l}
          </Button>
        ))}
      </div>

      {/* Список тикетов */}
      <div className="space-y-2">
        {loading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Загрузка тикетов...
          </Card>
        ) : tickets.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Тикетов не найдено
          </Card>
        ) : (
          tickets.map((ticket) => (
            <Card
              key={ticket.id}
              className="p-3 flex flex-wrap items-center gap-3 cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => setSelectedTicket(ticket)}
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <MessageSquare className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground">{ticket.number}</span>
                  <span className="font-medium text-sm">{ticket.subject}</span>
                  {ticket.category && (
                    <Badge variant="outline" className="text-[10px]">
                      {CATEGORY_LABELS[ticket.category] || ticket.category}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                  <User className="h-3 w-3" />
                  {ticket.customerName}
                  {ticket.orderNumber && (
                    <span className="ml-2">• Заказ {ticket.orderNumber}</span>
                  )}
                  <span className="ml-2">
                    <Clock className="h-3 w-3 inline mr-0.5" />
                    {formatDate(ticket.createdAt)}
                  </span>
                </div>
              </div>
              <Badge className={`text-[10px] ${PRIORITY_INFO[ticket.priority]?.color}`}>
                {PRIORITY_INFO[ticket.priority]?.label || ticket.priority}
              </Badge>
              <Badge className={`text-[10px] ${STATUS_INFO[ticket.status]?.color}`}>
                {STATUS_INFO[ticket.status]?.label || ticket.status}
              </Badge>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Card>
          ))
        )}
      </div>

      {/* Диалог просмотра тикета */}
      {selectedTicket && (
        <TicketDetailsDialog
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onStatusChange={handleStatusChange}
          onUpdate={loadTickets}
        />
      )}

      {/* Создание тикета */}
      {showCreate && (
        <CreateTicketDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            loadTickets();
          }}
        />
      )}
    </div>
  );
}

// =================== Ticket Details Dialog ===================
function TicketDetailsDialog({
  ticket,
  onClose,
  onStatusChange,
  onUpdate,
}: {
  ticket: Ticket;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
  onUpdate: () => void;
}) {
  const [messages, setMessages] = useState<TicketMessage[]>(ticket.messages || []);
  const [newMessage, setNewMessage] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [loading, setLoading] = useState(false);

  // Загружаем полные сообщения
  useEffect(() => {
    fetch(`/api/crm/tickets/${ticket.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ticket?.messages) {
          setMessages(data.ticket.messages);
        }
      })
      .catch(console.error);
  }, [ticket.id]);

  const handleSend = async () => {
    if (!newMessage.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/crm/tickets/${ticket.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: newMessage,
          isInternal,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages([...messages, data.message]);
        setNewMessage("");
        toast.success("Сообщение отправлено");
        onUpdate();
      }
    } catch {
      toast.error("Ошибка отправки");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-muted-foreground">{ticket.number}</span>
            {ticket.subject}
            <Badge className={`text-[10px] ${PRIORITY_INFO[ticket.priority]?.color}`}>
              {PRIORITY_INFO[ticket.priority]?.label}
            </Badge>
            <Badge className={`text-[10px] ${STATUS_INFO[ticket.status]?.color}`}>
              {STATUS_INFO[ticket.status]?.label}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            от {ticket.customerName} • {formatDateTime(ticket.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Управление статусом */}
          <Card className="p-3">
            <Label className="text-xs font-semibold">Управление</Label>
            <div className="flex gap-2 mt-2 flex-wrap">
              <Select value={ticket.status} onValueChange={(v) => onStatusChange(ticket.id, v)}>
                <SelectTrigger className="w-[180px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_INFO).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>

          {/* Сообщения */}
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {messages.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                Сообщений пока нет
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2 ${msg.authorRole === "customer" ? "" : "flex-row-reverse"} ${msg.isInternal ? "opacity-60" : ""}`}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-xs">
                      {msg.authorName.slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className={`flex-1 max-w-[75%] ${msg.isInternal ? "bg-amber-50 border-amber-200" : msg.authorRole === "customer" ? "bg-card border-border" : "bg-primary/5 border-primary/20"} border rounded-lg p-3`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium">{msg.authorName}</span>
                      <Badge variant="outline" className="text-[9px]">
                        {msg.authorRole === "customer" ? "Клиент" : msg.authorRole === "admin" ? "Оператор" : "Система"}
                      </Badge>
                      {msg.isInternal && (
                        <Badge className="bg-amber-500 text-white text-[9px]">Внутренний</Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {formatDateTime(msg.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Новое сообщение */}
          <div className="space-y-2">
            <Textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Введите ответ..."
              rows={3}
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={isInternal}
                  onChange={(e) => setIsInternal(e.target.checked)}
                  className="w-3.5 h-3.5 accent-primary"
                />
                Внутренний комментарий (не виден клиенту)
              </label>
              <Button size="sm" onClick={handleSend} disabled={loading || !newMessage.trim()}>
                <Send className="h-3.5 w-3.5 mr-1" />
                {loading ? "Отправка..." : "Отправить"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =================== Create Ticket Dialog ===================
function CreateTicketDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    subject: "",
    description: "",
    priority: "medium",
    category: "other",
    orderNumber: "",
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!form.subject.trim() || !form.description.trim()) {
      toast.error("Заполните тему и описание");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/crm/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          orderNumber: form.orderNumber || undefined,
        }),
      });
      if (res.ok) {
        toast.success("Тикет создан");
        onCreated();
      } else {
        const data = await res.json();
        toast.error(data.error || "Ошибка создания");
      }
    } catch {
      toast.error("Ошибка создания");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новый тикет</DialogTitle>
          <DialogDescription>Создание обращения в поддержку</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Тема</Label>
            <Input
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="Краткое описание проблемы"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Приоритет</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_INFO).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Категория</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Описание</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={5}
              placeholder="Подробное описание проблемы..."
            />
          </div>
          <div>
            <Label>Номер заказа (опционально)</Label>
            <Input
              value={form.orderNumber}
              onChange={(e) => setForm({ ...form, orderNumber: e.target.value })}
              placeholder="UK-2025-0001"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Создание..." : "Создать тикет"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
