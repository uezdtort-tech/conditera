"use client";

import { useAppStore } from "@/lib/store";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Building2,
  Calendar,
  Users,
  MapPin,
  TrendingUp,
  Clock,
  FileText,
  Receipt,
  ChevronLeft,
  Plus,
  Gift,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  CORPORATE_EVENT_TYPES,
  UPCOMING_HOLIDAYS,
} from "@/lib/mock-data-corporate";
import { formatCurrency, formatDate } from "@/lib/finance";
import { toast } from "sonner";
import type { CorporateEventType } from "@/lib/types";

export function CorporateEventsPage() {
  const navigate = useAppStore((s) => s.navigate);
  const corporateEvents = useAppStore((s) => s.corporateEvents);
  const createCorporateEvent = useAppStore((s) => s.createCorporateEvent);
  const respondToCorporateEvent = useAppStore((s) => s.respondToCorporateEvent);
  const user = useAppStore((s) => s.user);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);

  const [showCreate, setShowCreate] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");

  const filtered = corporateEvents.filter(
    (e) => filterType === "all" || e.type === filterType
  );

  const handleRespond = (eventId: string) => {
    if (!user) {
      setAuthModalOpen(true);
      toast.info("Войдите как кондитер, чтобы откликнуться");
      return;
    }
    respondToCorporateEvent(eventId, user.id);
    toast.success("Отклик отправлен!", {
      description: "Заказчик свяжется с вами",
    });
  };

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10">
      <button
        onClick={() => navigate("home")}
        className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        На главную
      </button>

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <div>
          <Badge className="mb-2 bg-indigo-100 text-indigo-800 border-indigo-200">
            <Building2 className="h-3 w-3 mr-1" />
            B2B · Корпоративные заказы
          </Badge>
          <h1 className="font-display text-2xl lg:text-3xl font-bold mb-2">
            Корпоративные праздники и мероприятия
          </h1>
          <p className="text-muted-foreground">
            Торты, капкейки и подарочные наборы для компаний. Счета на оплату,
            договоры, отсрочка платежа, работа с НДС.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Создать тендер
        </Button>
      </div>

      {/* Upcoming holidays */}
      <div className="mb-8">
        <h2 className="font-display text-xl font-bold mb-3 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Предстоящие праздники
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {UPCOMING_HOLIDAYS.map((holiday) => (
            <Card
              key={holiday.type}
              className={`p-3 cursor-pointer hover:shadow-md transition-shadow border ${holiday.color}`}
              onClick={() => setFilterType(holiday.type)}
            >
              <div className="text-2xl mb-1">{holiday.icon}</div>
              <div className="font-semibold text-xs">{holiday.name}</div>
              {holiday.date && (
                <div className="text-[10px] opacity-80 mt-0.5">
                  {formatDate(holiday.date)}
                </div>
              )}
              {holiday.daysLeft !== null && (
                <div className="text-[10px] font-medium mt-1">
                  {holiday.daysLeft > 0 ? `через ${holiday.daysLeft} дн.` : "сегодня!"}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setFilterType("all")}
          className={`px-3 py-1 text-xs rounded-full border ${
            filterType === "all"
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border hover:border-primary/40"
          }`}
        >
          Все события
        </button>
        {Object.entries(CORPORATE_EVENT_TYPES)
          .filter(([key]) => corporateEvents.some((e) => e.type === key))
          .map(([key, info]) => (
            <button
              key={key}
              onClick={() => setFilterType(key)}
              className={`px-3 py-1 text-xs rounded-full border flex items-center gap-1 ${
                filterType === key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <span>{info.icon}</span>
              {info.label}
            </button>
          ))}
      </div>

      {/* Events list */}
      <div className="space-y-4">
        {filtered.map((event) => {
          const typeInfo = CORPORATE_EVENT_TYPES[event.type];
          return (
            <Card key={event.id} className="p-5">
              <div className="flex flex-col lg:flex-row gap-4">
                {/* Left */}
                <div className="flex-1 min-w-0">
                  {/* Header */}
                  <div className="flex items-start gap-2 mb-2 flex-wrap">
                    <Badge className={typeInfo.color}>
                      {typeInfo.icon} {typeInfo.label}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={
                        event.status === "open"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : event.status === "completed"
                          ? "bg-slate-50 text-slate-700 border-slate-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }
                    >
                      {event.status === "open"
                        ? "Открыт тендер"
                        : event.status === "completed"
                        ? "Завершён"
                        : event.status === "in_progress"
                        ? "В работе"
                        : "Черновик"}
                    </Badge>
                    {event.responsesCount > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        {event.responsesCount} откликов
                      </Badge>
                    )}
                  </div>

                  <h3 className="font-display font-bold text-lg mb-2">
                    {event.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {event.description}
                  </p>

                  {/* Company */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={event.customerAvatar} alt={event.companyName} />
                      <AvatarFallback className="text-[10px]">
                        {event.companyName.slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{event.companyName}</span>
                    {event.companyInn && (
                      <>
                        <span>•</span>
                        <span>ИНН {event.companyInn}</span>
                      </>
                    )}
                  </div>

                  {/* Details */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-primary" />
                      {formatDate(event.eventDate)}
                    </div>
                    <div className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5 text-primary" />
                      {event.attendeesCount} чел.
                    </div>
                    <div className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-primary" />
                      <span className="truncate">{event.eventLocation}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-primary" />
                      До {formatDate(event.deadline)}
                    </div>
                  </div>

                  {/* B2B flags */}
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {event.needsInvoice && (
                      <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                        <FileText className="h-3 w-3 mr-0.5" />
                        Счёт на оплату
                      </Badge>
                    )}
                    {event.needsVatInvoice && (
                      <Badge variant="outline" className="text-[10px] bg-purple-50 text-purple-700 border-purple-200">
                        <Receipt className="h-3 w-3 mr-0.5" />
                        С НДС
                      </Badge>
                    )}
                    {event.needsContract && (
                      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                        Договор
                      </Badge>
                    )}
                    {event.needsAct && (
                      <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                        Акт выполненных работ
                      </Badge>
                    )}
                    {event.paymentDeferred && (
                      <Badge variant="outline" className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200">
                        Отсрочка {event.paymentDays} дн.
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Right — budget & action */}
                <div className="lg:w-56 shrink-0 flex flex-col gap-2 lg:border-l lg:pl-4">
                  <div className="text-center p-3 bg-primary/5 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Бюджет</div>
                    <div className="font-display font-bold text-lg text-primary">
                      {formatCurrency(event.budget.min)}
                    </div>
                    <div className="text-xs text-muted-foreground">— {formatCurrency(event.budget.max)}</div>
                  </div>
                  {event.status === "open" && (
                    <Button onClick={() => handleRespond(event.id)} className="w-full">
                      Откликнуться
                    </Button>
                  )}
                  {event.status === "completed" && event.selectedConfectionerId && (
                    <Badge className="bg-emerald-100 text-emerald-800 justify-center py-2">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Исполнитель выбран
                    </Badge>
                  )}
                  <Button variant="outline" size="sm" className="w-full text-xs">
                    Подробнее
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* B2B info */}
      <Card className="mt-8 p-6 bg-gradient-to-br from-indigo-50 to-purple-50 border-indigo-200">
        <div className="flex items-start gap-3">
          <Building2 className="h-8 w-8 text-indigo-600 shrink-0" />
          <div>
            <h3 className="font-display font-semibold mb-2">
              B2B-возможности для корпоративных клиентов
            </h3>
            <ul className="text-sm text-muted-foreground space-y-1 mb-4">
              <li>• Закрывающие документы: счёт, счёт-фактура, акт, договор</li>
              <li>• Работа с НДС и без (УСН, ОСНО)</li>
              <li>• Отсрочка платежа до 30 дней</li>
              <li>• Массовые заказы: до 500+ порций</li>
              <li>• Логотип и фирменный стиль на тортах</li>
              <li>• Регулярные поставки (ежемесячные контракты)</li>
              <li>• Персональный менеджер и приоритетная поддержка</li>
            </ul>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Разместить тендер
            </Button>
          </div>
        </div>
      </Card>

      {/* Create dialog */}
      {showCreate && (
        <CreateCorporateEventDialog
          onClose={() => setShowCreate(false)}
          onCreate={(event) => {
            createCorporateEvent(event);
            toast.success("Тендер создан!", {
              description: "Кондитеры получат уведомление",
            });
            setShowCreate(false);
          }}
          user={user}
        />
      )}
    </div>
  );
}

function CreateCorporateEventDialog({
  onClose,
  onCreate,
  user,
}: {
  onClose: () => void;
  onCreate: (event: any) => void;
  user: any;
}) {
  const [type, setType] = useState<CorporateEventType>("office_party");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [companyName, setCompanyName] = useState(user?.legalInfo?.companyName || "");
  const [companyInn, setCompanyInn] = useState(user?.legalInfo?.inn || "");
  const [contactName, setContactName] = useState(user?.name || "");
  const [contactPhone, setContactPhone] = useState(user?.phone || "");
  const [contactEmail, setContactEmail] = useState(user?.email || "");
  const [eventDate, setEventDate] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [attendeesCount, setAttendeesCount] = useState(50);
  const [budgetMin, setBudgetMin] = useState(20000);
  const [budgetMax, setBudgetMax] = useState(50000);
  const [deadline, setDeadline] = useState("");
  const [needsInvoice, setNeedsInvoice] = useState(true);
  const [needsVatInvoice, setNeedsVatInvoice] = useState(false);
  const [needsAct, setNeedsAct] = useState(true);
  const [needsContract, setNeedsContract] = useState(false);
  const [paymentDeferred, setPaymentDeferred] = useState(false);
  const [paymentDays, setPaymentDays] = useState(14);

  const handleSubmit = () => {
    if (!title || !description || !eventDate || !companyName) {
      toast.error("Заполните обязательные поля");
      return;
    }
    onCreate({
      customerId: user?.id || "u_anon",
      customerName: companyName,
      companyName,
      companyInn,
      contactName,
      contactPhone,
      contactEmail,
      type,
      title,
      description,
      eventDate,
      eventLocation,
      attendeesCount,
      budget: { min: budgetMin, max: budgetMax },
      neededItems: [],
      status: "open",
      deadline,
      needsInvoice,
      needsVatInvoice,
      needsAct,
      needsContract,
      paymentDeferred,
      paymentDays: paymentDeferred ? paymentDays : undefined,
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Создать корпоративный тендер</DialogTitle>
          <DialogDescription>
            Заполните детали мероприятия. Кондитеры получат уведомление и смогут откликнуться.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Тип мероприятия</Label>
            <Select value={type} onValueChange={(v) => setType(v as CorporateEventType)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CORPORATE_EVENT_TYPES).map(([key, info]) => (
                  <SelectItem key={key} value={key}>
                    {info.icon} {info.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Название тендера *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Корпоратив на Новый год — 200 человек"
            />
          </div>
          <div>
            <Label>Описание *</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Что нужно, в каком количестве, декор, логотип..."
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Название компании *</Label>
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="ООО «Ромашка»"
              />
            </div>
            <div>
              <Label>ИНН</Label>
              <Input
                value={companyInn}
                onChange={(e) => setCompanyInn(e.target.value.replace(/\D/g, ""))}
                placeholder="7700000000"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Контактное лицо</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div>
              <Label>Телефон</Label>
              <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Дата мероприятия *</Label>
              <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </div>
            <div>
              <Label>Срок подачи заявок</Label>
              <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Место проведения</Label>
            <Input
              value={eventLocation}
              onChange={(e) => setEventLocation(e.target.value)}
              placeholder="Москва, ул. Тверская, 16"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Кол-во гостей</Label>
              <Input
                type="number"
                value={attendeesCount}
                onChange={(e) => setAttendeesCount(+e.target.value)}
              />
            </div>
            <div>
              <Label>Бюджет мин, ₽</Label>
              <Input
                type="number"
                value={budgetMin}
                onChange={(e) => setBudgetMin(+e.target.value)}
              />
            </div>
            <div>
              <Label>Бюджет макс, ₽</Label>
              <Input
                type="number"
                value={budgetMax}
                onChange={(e) => setBudgetMax(+e.target.value)}
              />
            </div>
          </div>

          {/* B2B опции */}
          <div className="p-3 border border-indigo-200 bg-indigo-50 rounded-lg space-y-2">
            <div className="text-xs font-semibold text-indigo-900">Документы и оплата (B2B)</div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={needsInvoice} onCheckedChange={(v) => setNeedsInvoice(!!v)} />
              <FileText className="h-3.5 w-3.5" />
              Нужен счёт на оплату
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={needsVatInvoice} onCheckedChange={(v) => setNeedsVatInvoice(!!v)} />
              <Receipt className="h-3.5 w-3.5" />
              Работа с НДС (счёт-фактура)
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={needsAct} onCheckedChange={(v) => setNeedsAct(!!v)} />
              Акт выполненных работ
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={needsContract} onCheckedChange={(v) => setNeedsContract(!!v)} />
              Договор
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={paymentDeferred} onCheckedChange={(v) => setPaymentDeferred(!!v)} />
              Отсрочка платежа
            </label>
            {paymentDeferred && (
              <div>
                <Label>Отсрочка, дней</Label>
                <Input
                  type="number"
                  value={paymentDays}
                  onChange={(e) => setPaymentDays(+e.target.value)}
                  className="mt-1"
                />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={handleSubmit}>Опубликовать тендер</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
