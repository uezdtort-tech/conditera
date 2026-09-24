"use client";

import { useState, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  CalendarDays, Search, Eye, Building2, Users, Clock, MapPin,
  Phone, Mail, Check, X, AlertCircle, FileText, Wallet,
  MessageSquare, TrendingUp, Award,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/finance";
import { toast } from "sonner";
import type { CorporateEvent } from "@/lib/types";

const EVENT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft:     { label: "Черновик",     color: "text-muted-foreground" },
  open:      { label: "Открыт",       color: "text-emerald-600 border-emerald-300" },
  in_progress:{ label: "В работе",    color: "text-blue-600 border-blue-300" },
  completed: { label: "Завершён",     color: "text-purple-600 border-purple-300" },
  cancelled: { label: "Отменён",      color: "text-red-600 border-red-300" },
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  new_year: "Новый год",
  christmas: "Рождество",
  feb_23: "23 февраля",
  mar_8: "8 марта",
  easter: "Пасха",
  may_1: "1 мая",
  may_9: "9 мая",
  russia_day: "День России",
  nov_4: "День народного единства",
  knowledge_day: "День знаний",
  company_anniversary: "Годовщина компании",
  office_party: "Офисная вечеринка",
  team_building: "Тимбилдинг",
  conference: "Конференция",
  client_event: "Клиентское мероприятие",
  corporate_gifts: "Корпоративные подарки",
  other: "Другое",
};

export function AdminEventsManager() {
  const events = useAppStore((s) => s.corporateEvents);
  const confectioners = useAppStore((s) => s.confectioners);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [viewingEvent, setViewingEvent] = useState<CorporateEvent | null>(null);

  const filtered = useMemo(() => {
    return events.filter((e: any) => {
      if (search) {
        const q = search.toLowerCase();
        if (!e.title?.toLowerCase().includes(q) && !e.companyName?.toLowerCase().includes(q) && !e.contactName?.toLowerCase().includes(q)) return false;
      }
      if (filterStatus !== "all" && e.status !== filterStatus) return false;
      return true;
    });
  }, [events, search, filterStatus]);

  const stats = {
    total: events.length,
    open: events.filter((e) => e.status === "open").length,
    inProgress: events.filter((e) => e.status === "in_progress").length,
    completed: events.filter((e) => e.status === "completed").length,
    totalBudget: events.reduce((sum, e) => sum + (e.budget?.max || 0), 0),
  };

  const updateEventStatus = (id: string, status: any) => {
    useAppStore.setState((s) => ({
      corporateEvents: s.corporateEvents.map((e) => e.id === id ? { ...e, status } : e),
    }));
    toast.success("Статус события обновлён", { description: EVENT_STATUS_LABELS[status]?.label });
    if (viewingEvent?.id === id) {
      setViewingEvent({ ...viewingEvent, status });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          Корпоративные события
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Управление B2B-мероприятиями: заявки от компаний, отклики кондитеров, выбор исполнителя
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Всего</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Открытые</div>
          <div className="text-2xl font-bold text-emerald-600">{stats.open}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">В работе</div>
          <div className="text-2xl font-bold text-blue-600">{stats.inProgress}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Завершено</div>
          <div className="text-2xl font-bold text-purple-600">{stats.completed}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Суммарный бюджет</div>
          <div className="text-2xl font-bold text-amber-700">{formatCurrency(stats.totalBudget)}</div>
        </Card>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию, компании, контактному лицу..."
            className="pl-9"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger><SelectValue placeholder="Статус" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            {Object.entries(EVENT_STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            События не найдены.
          </Card>
        ) : filtered.map((e: any) => (
          <Card
            key={e.id}
            className="p-3 flex flex-wrap items-center gap-3 cursor-pointer hover:border-primary/40 transition-colors"
            onClick={() => setViewingEvent(e)}
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <CalendarDays className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{e.title}</span>
                <Badge variant="outline" className={`text-[10px] ${EVENT_STATUS_LABELS[e.status]?.color}`}>
                  {EVENT_STATUS_LABELS[e.status]?.label || e.status}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {EVENT_TYPE_LABELS[e.type] || e.type}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                <Building2 className="h-3 w-3 inline mr-1" />
                {e.companyName}
                <span className="mx-1">•</span>
                <Users className="h-3 w-3 inline mr-1" />
                {e.attendeesCount} чел.
                <span className="mx-1">•</span>
                <Clock className="h-3 w-3 inline mr-1" />
                {formatDate(e.eventDate)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Бюджет</div>
              <div className="font-semibold text-sm">
                {formatCurrency(e.budget?.min)} – {formatCurrency(e.budget?.max)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {e.responsesCount} откликов
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={(ev) => { ev.stopPropagation(); setViewingEvent(e); }}>
              <Eye className="h-3.5 w-3.5 mr-1" />Открыть
            </Button>
          </Card>
        ))}
      </div>

      {/* Event Details */}
      {viewingEvent && (
        <EventDetailsDialog
          event={viewingEvent}
          onClose={() => setViewingEvent(null)}
          onStatusChange={updateEventStatus}
          confectioners={confectioners}
        />
      )}
    </div>
  );
}

function EventDetailsDialog({
  event,
  onClose,
  onStatusChange,
  confectioners,
}: {
  event: CorporateEvent;
  onClose: () => void;
  onStatusChange: (id: string, status: any) => void;
  confectioners: any[];
}) {
  const setChatOpen = useAppStore((s) => s.setChatOpen);
  const setActiveChatRoom = useAppStore((s) => s.setActiveChatRoom);
  const chatRooms = useAppStore((s) => s.chatRooms);
  const user = useAppStore((s) => s.user);

  const selectedConfectioner = event.selectedConfectionerId
    ? confectioners.find((c) => c.id === event.selectedConfectionerId)
    : null;

  const handleChatWithConfectioner = (confectionerId: string) => {
    const conf = confectioners.find((c) => c.id === confectionerId);
    if (!conf) return;
    const existing = chatRooms.find(
      (r) => r.type === "direct" && r.participants?.some((p) => p.id === confectionerId)
    );
    if (existing) {
      setActiveChatRoom(existing.id);
      setChatOpen(true);
      onClose();
      return;
    }
    const newRoom = {
      id: `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "direct" as const,
      name: conf.businessName || conf.name,
      avatar: conf.avatar,
      participants: [
        { id: user?.id || "admin", name: user?.name || "Администратор", avatar: user?.avatar },
        { id: confectionerId, name: conf.businessName || conf.name, avatar: conf.avatar },
      ],
      unreadCount: 0,
    };
    useAppStore.setState((s) => ({
      chatRooms: [newRoom, ...s.chatRooms],
      activeChatRoom: newRoom.id,
      chatOpen: true,
    }));
    toast.success("Чат с кондитером открыт", { description: conf.businessName || conf.name });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {event.title}
            <Badge variant="outline" className={`text-[10px] ${EVENT_STATUS_LABELS[event.status]?.color}`}>
              {EVENT_STATUS_LABELS[event.status]?.label}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {EVENT_TYPE_LABELS[event.type] || event.type}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Создан {formatDate(event.createdAt)} • Дедлайн: {formatDate(event.deadline)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status change */}
          <Card className="p-3">
            <Label className="text-xs font-semibold">Управление статусом</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {Object.entries(EVENT_STATUS_LABELS).map(([k, v]) => (
                <Button
                  key={k}
                  size="sm"
                  variant={event.status === k ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => onStatusChange(event.id, k)}
                >
                  {event.status === k && <Check className="h-3 w-3 mr-1" />}
                  {v.label}
                </Button>
              ))}
            </div>
          </Card>

          {/* Company + Contact */}
          <div className="grid md:grid-cols-2 gap-3">
            <Card className="p-3">
              <div className="text-xs font-semibold mb-2 flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />Заказчик
              </div>
              <div className="text-sm font-medium">{event.companyName}</div>
              {event.companyInn && (
                <div className="text-xs text-muted-foreground">ИНН: {event.companyInn}</div>
              )}
              <div className="text-xs text-muted-foreground mt-1">{event.contactName}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <Phone className="h-3 w-3" />{event.contactPhone}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Mail className="h-3 w-3" />{event.contactEmail}
              </div>
            </Card>

            <Card className="p-3">
              <div className="text-xs font-semibold mb-2 flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />Детали
              </div>
              <div className="text-xs space-y-1">
                <div><CalendarDays className="h-3 w-3 inline mr-1" />{formatDate(event.eventDate)}</div>
                <div><MapPin className="h-3 w-3 inline mr-1" />{event.eventLocation || "не указано"}</div>
                <div><Users className="h-3 w-3 inline mr-1" />{event.attendeesCount} чел.</div>
                <div>
                  <Wallet className="h-3 w-3 inline mr-1" />
                  Бюджет: {formatCurrency(event.budget?.min)} – {formatCurrency(event.budget?.max)}
                </div>
              </div>
            </Card>
          </div>

          {/* Description */}
          {event.description && (
            <Card className="p-3">
              <div className="text-xs font-semibold mb-1">Описание</div>
              <p className="text-sm text-muted-foreground">{event.description}</p>
            </Card>
          )}

          {/* What's needed */}
          {event.neededItems && event.neededItems.length > 0 && (
            <Card className="p-3">
              <div className="text-xs font-semibold mb-2">Что нужно</div>
              <div className="flex flex-wrap gap-1">
                {event.neededItems.map((item, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px]">{item}</Badge>
                ))}
              </div>
            </Card>
          )}

          {/* B2B details */}
          <Card className="p-3">
            <div className="text-xs font-semibold mb-2">B2B-условия</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              <div className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {event.needsInvoice ? "Счёт: ✓" : "Счёт: —"}
              </div>
              <div>{event.needsVatInvoice ? "НДС: ✓" : "НДС: —"}</div>
              <div>{event.needsAct ? "Акт: ✓" : "Акт: —"}</div>
              <div>{event.needsContract ? "Договор: ✓" : "Договор: —"}</div>
              <div>{event.paymentDeferred ? `Отсрочка: ${event.paymentDays || 0} дн.` : "Без отсрочки"}</div>
              <div>Откликов: {event.responsesCount}</div>
            </div>
          </Card>

          {/* Selected confectioner */}
          {selectedConfectioner && (
            <Card className="p-3 border-emerald-300 bg-emerald-50/30">
              <div className="text-xs font-semibold mb-2 flex items-center gap-1 text-emerald-700">
                <Award className="h-3.5 w-3.5" />Выбранный исполнитель
              </div>
              <div className="flex items-center gap-3">
                <div className="text-sm font-medium">{selectedConfectioner.businessName || selectedConfectioner.name}</div>
                <Button size="sm" onClick={() => handleChatWithConfectioner(selectedConfectioner.id)}>
                  <MessageSquare className="h-3.5 w-3.5 mr-1" />Написать
                </Button>
              </div>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Закрыть</Button>
          {event.status === "open" && (
            <>
              <Button
                variant="destructive"
                onClick={() => onStatusChange(event.id, "cancelled")}
              >
                <X className="h-4 w-4 mr-1" />Отменить событие
              </Button>
              <Button
                onClick={() => onStatusChange(event.id, "in_progress")}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <TrendingUp className="h-4 w-4 mr-1" />Перевести в работу
              </Button>
            </>
          )}
          {event.status === "in_progress" && (
            <Button
              onClick={() => onStatusChange(event.id, "completed")}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Check className="h-4 w-4 mr-1" />Завершить
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
