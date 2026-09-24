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
  Calendar,
  Plus,
  Trash2,
  Bell,
  Gift,
  Users,
  Copy,
  Check,
  TrendingUp,
  Clock,
  MapPin,
  Phone,
  Navigation,
  Star,
  ChevronRight,
  ChevronLeft,
  Video,
  Play,
  ThumbsUp,
  Eye,
  Send,
  Sparkles,
} from "lucide-react";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/finance";
import { toast } from "sonner";

// ==================== КАЛЕНДАРЬ ПРАЗДНИКОВ ====================
export function CustomerHolidaysTab() {
  const holidays = useAppStore((s) => s.userHolidays);
  const addHoliday = useAppStore((s) => s.addHoliday);
  const deleteHoliday = useAppStore((s) => s.deleteHoliday);
  const navigate = useAppStore((s) => s.navigate);
  const [showAdd, setShowAdd] = useState(false);

  const sorted = [...holidays].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const upcoming = sorted.filter((h) => {
    const date = new Date(h.date);
    const now = new Date();
    const daysLeft = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return daysLeft >= -30 && daysLeft <= 365;
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "birthday": return "🎂";
      case "wedding_anniversary": return "💍";
      case "anniversary": return "🎉";
      case "graduation": return "🎓";
      default: return "📅";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary" />
            Календарь праздников
          </h1>
          <p className="text-sm text-muted-foreground">
            Не забудьте про дни рождения близких. Мы напомним заранее и поможем выбрать торт.
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" /> Добавить
        </Button>
      </div>

      {/* Timeline */}
      <div className="space-y-3">
        {upcoming.map((holiday) => {
          const date = new Date(holiday.date);
          const now = new Date();
          const daysLeft = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          const isToday = daysLeft === 0;
          const isPast = daysLeft < 0;
          const isSoon = daysLeft > 0 && daysLeft <= holiday.reminderDays;

          return (
            <Card
              key={holiday.id}
              className={`p-4 ${isToday ? "border-primary bg-primary/5" : isSoon ? "border-amber-300 bg-amber-50/50" : ""}`}
            >
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/10 to-accent flex items-center justify-center shrink-0">
                  <span className="text-2xl">{getTypeIcon(holiday.type)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm flex items-center gap-2">
                        {holiday.title}
                        {isToday && <Badge className="bg-primary text-primary-foreground text-[10px]">Сегодня!</Badge>}
                        {isSoon && !isToday && <Badge className="bg-amber-500 text-white text-[10px]">Скоро</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(holiday.date)}
                        {holiday.personName && ` • ${holiday.personName}`}
                        {holiday.relationship && ` (${holiday.relationship})`}
                        {holiday.recurring && " • ежегодно"}
                      </div>
                      {holiday.notes && (
                        <div className="text-xs text-muted-foreground mt-1 italic">{holiday.notes}</div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {isPast ? (
                        <Badge variant="outline" className="text-[10px]">Прошёл</Badge>
                      ) : (
                        <div>
                          <div className={`font-display font-bold text-lg ${isToday ? "text-primary" : isSoon ? "text-amber-600" : ""}`}>
                            {daysLeft === 0 ? "Сегодня!" : daysLeft === 1 ? "Завтра" : `${daysLeft} дн.`}
                          </div>
                          {isSoon && (
                            <div className="text-[10px] text-amber-600 flex items-center gap-0.5">
                              <Bell className="h-2.5 w-2.5" /> Напомнить за {holiday.reminderDays} дн.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {!isPast && (
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate("catalog")}>
                        <Gift className="h-3 w-3 mr-1" /> Заказать торт
                      </Button>
                      <Button size="sm" variant="ghost" className="text-xs text-destructive" onClick={() => deleteHoliday(holiday.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {upcoming.length === 0 && (
        <Card className="p-12 text-center">
          <Calendar className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-1">Нет запланированных праздников</h3>
          <p className="text-sm text-muted-foreground mb-4">Добавьте дни рождения близких — мы напомним заранее</p>
          <Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-1" /> Добавить праздник</Button>
        </Card>
      )}

      {showAdd && <AddHolidayDialog onClose={() => setShowAdd(false)} onAdd={(h) => { addHoliday(h); toast.success("Праздник добавлен!"); setShowAdd(false); }} />}
    </div>
  );
}

function AddHolidayDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (h: any) => void }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("birthday");
  const [date, setDate] = useState("");
  const [personName, setPersonName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [recurring, setRecurring] = useState(true);
  const [reminderDays, setReminderDays] = useState(14);
  const [notes, setNotes] = useState("");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Добавить праздник</DialogTitle>
          <DialogDescription>Мы напомним вам за {reminderDays} дней до события</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Название *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="День рождения Маши" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Тип</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="birthday">День рождения</SelectItem>
                  <SelectItem value="wedding_anniversary">Годовщина свадьбы</SelectItem>
                  <SelectItem value="anniversary">Годовщина</SelectItem>
                  <SelectItem value="graduation">Выпускной</SelectItem>
                  <SelectItem value="other">Другое</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Дата *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Имя именинника</Label>
              <Input value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Маша" />
            </div>
            <div>
              <Label>Кто это?</Label>
              <Input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="Дочь" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Напомнить за (дн.)</Label>
              <Select value={String(reminderDays)} onValueChange={(v) => setReminderDays(+v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 дня</SelectItem>
                  <SelectItem value="7">7 дней</SelectItem>
                  <SelectItem value="14">14 дней</SelectItem>
                  <SelectItem value="30">30 дней</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
                Ежегодно
              </label>
            </div>
          </div>
          <div>
            <Label>Заметки</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Любит шоколадные торты" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button disabled={!title || !date} onClick={() => onAdd({ title, type, date, personName, relationship, recurring, reminderDays, notes })}>Добавить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== РЕФЕРАЛЬНАЯ ПРОГРАММА ====================
export function CustomerReferralTab() {
  const referral = useAppStore((s) => s.referral);
  const [copied, setCopied] = useState(false);

  if (!referral) {
    return <Card className="p-8 text-center text-muted-foreground">Реферальная программа недоступна</Card>;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(referral.referralLink);
    setCopied(true);
    toast.success("Ссылка скопирована!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = (platform: string) => {
    const text = encodeURIComponent(`Заказывай торты на Уездном кондитере и получи 500₽ на первый заказ! ${referral.referralLink}`);
    const urls: Record<string, string> = {
      telegram: `https://t.me/share/url?url=${encodeURIComponent(referral.referralLink)}&text=${text}`,
      whatsapp: `https://wa.me/?text=${text}`,
      vk: `https://vk.com/share.php?url=${encodeURIComponent(referral.referralLink)}&title=${text}`,
    };
    if (urls[platform]) {
      window.open(urls[platform], "_blank");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" />
          Реферальная программа
        </h1>
        <p className="text-sm text-muted-foreground">
          Приглашайте друзей — получайте 500₽ за каждого + 5% от их заказов навсегда
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <Users className="h-5 w-5 text-blue-600 mb-1" />
          <div className="font-display text-xl font-bold">{referral.totalInvited}</div>
          <div className="text-xs text-muted-foreground">приглашено</div>
        </Card>
        <Card className="p-4">
          <Check className="h-5 w-5 text-emerald-600 mb-1" />
          <div className="font-display text-xl font-bold text-emerald-600">{referral.activeReferrals}</div>
          <div className="text-xs text-muted-foreground">сделали заказ</div>
        </Card>
        <Card className="p-4">
          <TrendingUp className="h-5 w-5 text-primary mb-1" />
          <div className="font-display text-xl font-bold">{formatCurrency(referral.totalEarned)}</div>
          <div className="text-xs text-muted-foreground">заработано всего</div>
        </Card>
        <Card className="p-4 bg-primary/5 border-primary/20">
          <Gift className="h-5 w-5 text-primary mb-1" />
          <div className="font-display text-xl font-bold text-primary">{formatCurrency(referral.availableBalance)}</div>
          <div className="text-xs text-muted-foreground">доступно к использованию</div>
        </Card>
      </div>

      {/* Referral link */}
      <Card className="p-4">
        <h3 className="font-semibold text-sm mb-2">Ваша реферальная ссылка</h3>
        <div className="flex gap-2">
          <Input value={referral.referralLink} readOnly className="font-mono text-sm" />
          <Button onClick={handleCopy} variant={copied ? "default" : "outline"}>
            {copied ? <><Check className="h-4 w-4 mr-1" /> Скопировано</> : <><Copy className="h-4 w-4 mr-1" /> Копировать</>}
          </Button>
        </div>
        <div className="text-xs text-muted-foreground mt-2 mb-3">Код друга: <code className="bg-muted px-1.5 py-0.5 rounded font-mono">{referral.referralCode}</code></div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => handleShare("telegram")}>Telegram</Button>
          <Button size="sm" variant="outline" onClick={() => handleShare("whatsapp")}>WhatsApp</Button>
          <Button size="sm" variant="outline" onClick={() => handleShare("vk")}>ВКонтакте</Button>
        </div>
      </Card>

      {/* How it works */}
      <Card className="p-4 bg-gradient-to-br from-primary/5 to-accent/30">
        <h3 className="font-semibold text-sm mb-3">Как это работает</h3>
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { num: "1", title: "Поделитесь ссылкой", desc: "Отправьте другу вашу уникальную ссылку" },
            { num: "2", title: "Друг делает заказ", desc: `Друг получает ${formatCurrency(referral.rewardAmount)} на первый заказ` },
            { num: "3", title: "Вы получаете 5%", desc: "5% от каждого заказа друга — навсегда" },
          ].map((step) => (
            <div key={step.num} className="flex items-start gap-2">
              <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">{step.num}</div>
              <div>
                <div className="font-medium text-sm">{step.title}</div>
                <div className="text-xs text-muted-foreground">{step.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* History */}
      <Card className="p-4">
        <h3 className="font-semibold text-sm mb-3">История приглашений ({referral.history.length})</h3>
        <div className="space-y-2">
          {referral.history.map((h) => (
            <div key={h.id} className="flex items-center justify-between p-2 border border-border rounded text-sm">
              <div>
                <div className="font-medium text-xs">{h.referredName}</div>
                <div className="text-[10px] text-muted-foreground">{h.referredEmail} • {formatDate(h.invitedAt)}</div>
              </div>
              <div className="text-right">
                <Badge variant="outline" className={
                  h.status === "ordered" ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]" :
                  h.status === "registered" ? "bg-blue-50 text-blue-700 border-blue-200 text-[10px]" :
                  h.status === "invited" ? "bg-amber-50 text-amber-700 border-amber-200 text-[10px]" :
                  "bg-slate-50 text-slate-700 border-slate-200 text-[10px]"
                }>
                  {h.status === "ordered" ? "Заказал" : h.status === "registered" ? "Зарегистрирован" : h.status === "invited" ? "Приглашён" : "Неактивен"}
                </Badge>
                {h.earnedAmount && (
                  <div className="text-[10px] text-emerald-600 mt-0.5">+{formatCurrency(h.earnedAmount)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ==================== ТРЕКИНГ КУРЬЕРА ====================
export function CustomerTrackingTab() {
  const tracking = useAppStore((s) => s.courierTracking);
  const setChatOpen = useAppStore((s) => s.setChatOpen);

  if (!tracking) {
    return <Card className="p-8 text-center text-muted-foreground">Нет активных доставок для отслеживания</Card>;
  }

  const statusInfo: Record<string, { label: string; color: string; percent: number }> = {
    picked_up: { label: "Заказ забран", color: "bg-blue-500", percent: 25 },
    en_route: { label: "В пути", color: "bg-primary", percent: 60 },
    nearby: { label: "Почти у вас", color: "bg-amber-500", percent: 85 },
    arrived: { label: "Курьер прибыл", color: "bg-emerald-500", percent: 95 },
    delivered: { label: "Доставлен", color: "bg-emerald-600", percent: 100 },
  };
  const info = statusInfo[tracking.status] || statusInfo.en_route;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Navigation className="h-6 w-6 text-primary" />
          Отслеживание доставки
        </h1>
        <p className="text-sm text-muted-foreground">Заказ {tracking.orderNumber} • Курьер в пути</p>
      </div>

      {/* Map (стилизованная) */}
      <Card className="p-0 overflow-hidden">
        <div className="relative aspect-[16/9] bg-gradient-to-br from-blue-50 via-emerald-50 to-amber-50 overflow-hidden">
          {/* Сетка дорог */}
          <div className="absolute inset-0 bg-pattern opacity-30" />
          {/* Маршрут — пунктирная линия */}
          <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 56">
            <line x1="20" y1="40" x2="50" y2="30" stroke="oklch(0.55 0.18 25)" strokeWidth="0.5" strokeDasharray="2 1" opacity="0.5" />
            <line x1="50" y1="30" x2="75" y2="20" stroke="oklch(0.55 0.18 25)" strokeWidth="0.5" strokeDasharray="2 1" opacity="0.5" />
          </svg>
          {/* Точка А — кондитер */}
          <div className="absolute" style={{ left: "20%", top: "70%" }}>
            <div className="flex flex-col items-center">
              <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shadow-lg">
                <span className="text-white text-xs font-bold">А</span>
              </div>
              <div className="mt-1 bg-white/90 backdrop-blur px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap">Кондитер</div>
            </div>
          </div>
          {/* Точка Б — доставка */}
          <div className="absolute" style={{ left: "75%", top: "35%" }}>
            <div className="flex flex-col items-center">
              <div className="h-8 w-8 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg">
                <span className="text-white text-xs font-bold">Б</span>
              </div>
              <div className="mt-1 bg-white/90 backdrop-blur px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap">Вы</div>
            </div>
          </div>
          {/* Текущая позиция курьера */}
          <div className="absolute" style={{ left: "50%", top: "53%" }}>
            <div className="flex flex-col items-center animate-pulse">
              <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center shadow-xl border-4 border-white">
                <span className="text-white">🚗</span>
              </div>
              <div className="mt-1 bg-blue-500 text-white px-2 py-0.5 rounded text-[9px] font-bold whitespace-nowrap">Курьер</div>
            </div>
          </div>
          {/* ETA badge */}
          <div className="absolute top-3 right-3 bg-white/90 backdrop-blur rounded-lg shadow-md p-2 text-center">
            <div className="text-[10px] text-muted-foreground">Прибудет через</div>
            <div className="font-display font-bold text-lg text-primary">{tracking.minutesLeft} мин</div>
          </div>
        </div>
      </Card>

      {/* Progress */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-sm">{info.label}</span>
          <span className="text-xs text-muted-foreground">{tracking.distanceLeftKm} км осталось</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className={`h-full ${info.color} transition-all`} style={{ width: `${info.percent}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>Забран</span>
          <span>В пути</span>
          <span>Прибыл</span>
          <span>Доставлен</span>
        </div>
      </Card>

      {/* Courier info */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-12 w-12">
            <AvatarImage src={tracking.courierAvatar} alt={tracking.courierName} />
            <AvatarFallback>{tracking.courierName.slice(0, 2)}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="font-semibold text-sm">{tracking.courierName}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              4.9 • {tracking.transport === "car" ? "🚗 Автомобиль" : tracking.transport}
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setChatOpen(true)}>
            <Send className="h-4 w-4 mr-1" /> Чат
          </Button>
          <a href={`tel:${tracking.courierPhone}`}>
            <Button size="icon" variant="outline"><Phone className="h-4 w-4" /></Button>
          </a>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-2 bg-muted/30 rounded">
            <div className="text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> Откуда</div>
            <div className="font-medium mt-0.5">{tracking.pickupPoint.label}</div>
            {tracking.pickupPoint.arrived && <Badge className="bg-emerald-100 text-emerald-700 text-[9px] mt-1">✓ Забран</Badge>}
          </div>
          <div className="p-2 bg-muted/30 rounded">
            <div className="text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> Куда</div>
            <div className="font-medium mt-0.5">{tracking.deliveryPoint.label}</div>
            {!tracking.deliveryPoint.arrived && <Badge className="bg-amber-100 text-amber-700 text-[9px] mt-1">В пути</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          Ожидаемое время прибытия: {formatDateTime(tracking.estimatedArrival)}
        </div>
      </Card>
    </div>
  );
}

// ==================== TELEGRAM BOT PAGE ====================
export function TelegramBotPage() {
  const navigate = useAppStore((s) => s.navigate);

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10 max-w-3xl">
      <button onClick={() => navigate("home")} className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 mb-4">
        <ChevronLeft className="h-4 w-4" /> На главную
      </button>

      <div className="text-center mb-8">
        <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
          <Send className="h-10 w-10 text-white" />
        </div>
        <h1 className="font-display text-2xl lg:text-3xl font-bold mb-2">Telegram-бот «Уездный кондитер»</h1>
        <p className="text-muted-foreground">Заказывайте торты прямо в Telegram — без открытия браузера</p>
      </div>

      <Card className="p-6 mb-4 bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-200">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          {/* QR code placeholder */}
          <div className="w-40 h-40 bg-white rounded-xl shadow-md flex items-center justify-center shrink-0">
            <div className="text-center">
              <div className="grid grid-cols-8 gap-px mb-2">
                {Array.from({ length: 64 }).map((_, i) => (
                  <div key={i} className={`w-3 h-3 ${Math.random() > 0.5 ? "bg-black" : "bg-white"}`} />
                ))}
              </div>
              <div className="text-[10px] text-muted-foreground">QR-код</div>
            </div>
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h3 className="font-display font-bold text-lg mb-2">Отсканируйте или нажмите</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Бот @conditera_bot — ваш персональный помощник для заказа тортов
            </p>
            <Button className="bg-blue-500 hover:bg-blue-600" onClick={() => toast.success("Открываем Telegram...")}>
              <Send className="h-4 w-4 mr-1" /> Открыть в Telegram
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        {[
          { icon: "🎂", title: "Заказ торта", desc: "Полный каталог и конструктор — прямо в чате" },
          { icon: "🔔", title: "Уведомления", desc: "Статус заказа, напоминания о праздниках" },
          { icon: "💳", title: "Оплата", desc: "СБП, карта, рассрочка — не выходя из Telegram" },
          { icon: "📍", title: "Трекинг", desc: "Отслеживание курьера в реальном времени" },
          { icon: "🎁", title: "Акции", desc: "Персональные скидки и промокоды" },
          { icon: "💬", title: "Поддержка", desc: "Чат с кондитером и службой поддержки" },
        ].map((f, i) => (
          <Card key={i} className="p-4 flex items-start gap-3">
            <div className="text-2xl shrink-0">{f.icon}</div>
            <div>
              <div className="font-medium text-sm">{f.title}</div>
              <div className="text-xs text-muted-foreground">{f.desc}</div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4 bg-muted/30">
        <h3 className="font-semibold text-sm mb-2">Как начать пользоваться</h3>
        <ol className="text-sm text-muted-foreground space-y-1">
          <li>1. Найдите бота <code className="bg-muted px-1 rounded">@conditera_bot</code> в Telegram</li>
          <li>2. Нажмите /start — бот привяжется к вашему аккаунту</li>
          <li>3. Закажите торт командой /catalog или через меню</li>
          <li>4. Оплатите и отслеживайте доставку — всё в чате</li>
        </ol>
      </Card>
    </div>
  );
}

// ==================== ВИДЕО-ОТЗЫВЫ В КАРТОЧКЕ ТОВАРА ====================
export function VideoReviewsSection({ productId }: { productId: string }) {
  const videoReviews = useAppStore((s) => s.videoReviews);
  const productReviews = videoReviews.filter((r) => r.productId === productId);
  const [playing, setPlaying] = useState<string | null>(null);

  if (productReviews.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="font-display text-xl font-bold mb-4 flex items-center gap-2">
        <Video className="h-5 w-5 text-rose-600" />
        Видео-отзывы ({productReviews.length})
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {productReviews.map((review) => (
          <Card key={review.id} className="overflow-hidden p-0">
            <div className="relative aspect-video bg-muted cursor-pointer" onClick={() => setPlaying(playing === review.id ? null : review.id)}>
              <img src={review.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                <div className="h-12 w-12 rounded-full bg-white/80 flex items-center justify-center">
                  <Play className="h-6 w-6 text-primary fill-primary ml-1" />
                </div>
              </div>
              <Badge className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px]">
                {review.duration}с
              </Badge>
              <div className="absolute top-2 left-2 flex items-center gap-1">
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className={`h-3 w-3 ${i < review.rating ? "fill-amber-400 text-amber-400" : "text-white/50"}`} />
                  ))}
                </div>
              </div>
            </div>
            <div className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={review.userAvatar} alt={review.userName} />
                  <AvatarFallback className="text-[10px]">{review.userName[0]}</AvatarFallback>
                </Avatar>
                <span className="text-xs font-medium">{review.userName}</span>
                <span className="text-[10px] text-muted-foreground">{formatDate(review.createdAt)}</span>
              </div>
              {review.text && <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{review.text}</p>}
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" /> {review.views}</span>
                <span className="flex items-center gap-0.5"><ThumbsUp className="h-3 w-3" /> {review.likes}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <div className="mt-3 text-center">
        <Button variant="outline" size="sm">
          <Video className="h-4 w-4 mr-1" /> Записать видео-отзыв
        </Button>
      </div>
    </div>
  );
}
