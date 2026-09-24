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
  Star, TrendingUp, MessageSquare, ThumbsUp, Share2, Flag,
  Search, Filter, Eye, Reply, Check, X, Clock, Users, Heart,
  ShoppingBag, Repeat, Phone, Mail, MapPin, Cake, Calendar,
  Gift, Tag, Plus, Edit, Trash2, BarChart3, DollarSign,
  Printer, Image as ImageIcon, Upload, Settings, Truck, Map,
  Navigation, Zap, AlertCircle, ChevronRight,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/finance";
import { toast } from "sonner";

// ============================================================
// ВКЛАДКА: Отзывы и рейтинги
// ============================================================
export function ConfectionerReviewsTab({ confectionerId }: { confectionerId: string }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const mockReviews = [
    { id: "r1", author: "Анна К.", avatar: "https://i.pravatar.cc/150?img=49", rating: 5, date: "2026-06-28", product: "Свадебный торт «Сахарная печать»", text: "Невероятный торт! Сахарная печать получилась идеальной — фото было как настоящее. Все гости были в восторге. Спасибо большое!", hasReply: false, likes: 12, status: "published" },
    { id: "r2", author: "Михаил В.", avatar: "https://i.pravatar.cc/150?img=51", rating: 5, date: "2026-06-25", product: "Торт на крестины «Ангел»", text: "Заказывали торт на крестины дочери. Очень нежный, вкусный, и фото малыша на торте — это просто волшебство. Рекомендуем!", hasReply: true, reply: "Спасибо за доверие! Будем рады видеть вас снова 🎂", likes: 8, status: "published" },
    { id: "r3", author: "Ольга М.", avatar: "https://i.pravatar.cc/150?img=23", rating: 4, date: "2026-06-20", product: "Торт с фото на день рождения", text: "Торт красивый и вкусный, но доставка задержалась на 20 минут. В целом довольны.", hasReply: false, likes: 3, status: "published" },
    { id: "r4", author: "Игорь П.", avatar: "https://i.pravatar.cc/150?img=58", rating: 5, date: "2026-06-15", product: "Набор пряников с печатью", text: "Заказывал набор пряников с фото для коллег. Все в восторге! Качество печати — отличное, пряники вкусные.", hasReply: false, likes: 5, status: "pending" },
    { id: "r5", author: "Светлана К.", avatar: "https://i.pravatar.cc/150?img=33", rating: 5, date: "2026-06-10", product: "Торт на заказ (индивидуальный)", text: "Исполнитель на 100%! Торт превзошёл все ожидания. Сахарная печать, декор, вкус — всё на высшем уровне.", hasReply: true, reply: "Светлана, спасибо за тёплые слова! 🌸", likes: 15, status: "published" },
  ];

  const filtered = mockReviews.filter((r) => {
    if (filter === "pending" && r.status !== "pending") return false;
    if (filter === "positive" && r.rating < 4) return false;
    if (filter === "negative" && r.rating >= 4) return false;
    if (filter === "unreplied" && r.hasReply) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.author.toLowerCase().includes(q) || r.text.toLowerCase().includes(q) || r.product.toLowerCase().includes(q);
    }
    return true;
  });

  const avgRating = (mockReviews.reduce((s, r) => s + r.rating, 0) / mockReviews.length).toFixed(1);
  const totalLikes = mockReviews.reduce((s, r) => s + r.likes, 0);

  const handleReply = (id: string) => {
    if (!replyText.trim()) return;
    toast.success("Ответ отправлен");
    setReplyingTo(null);
    setReplyText("");
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Star className="h-5 w-5 text-primary" />
          Отзывы и рейтинги
        </h2>
        <p className="text-sm text-muted-foreground mt-1">Отзывы покупателей о вашей работе</p>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3">
          <Star className="h-5 w-5 text-amber-500 mb-1" />
          <div className="text-2xl font-bold">{avgRating}</div>
          <div className="text-xs text-muted-foreground">Средний рейтинг</div>
        </Card>
        <Card className="p-3">
          <MessageSquare className="h-5 w-5 text-blue-500 mb-1" />
          <div className="text-2xl font-bold">{mockReviews.length}</div>
          <div className="text-xs text-muted-foreground">Всего отзывов</div>
        </Card>
        <Card className="p-3">
          <ThumbsUp className="h-5 w-5 text-emerald-500 mb-1" />
          <div className="text-2xl font-bold">{totalLikes}</div>
          <div className="text-xs text-muted-foreground">Лайков</div>
        </Card>
        <Card className="p-3">
          <Clock className="h-5 w-5 text-amber-500 mb-1" />
          <div className="text-2xl font-bold text-amber-600">{mockReviews.filter((r) => r.status === "pending").length}</div>
          <div className="text-xs text-muted-foreground">Ожидают ответа</div>
        </Card>
        <Card className="p-3">
          <Repeat className="h-5 w-5 text-purple-500 mb-1" />
          <div className="text-2xl font-bold">{Math.round(mockReviews.filter((r) => r.rating === 5).length / mockReviews.length * 100)}%</div>
          <div className="text-xs text-muted-foreground">Повторных</div>
        </Card>
      </div>

      {/* Распределение оценок */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Распределение оценок</h3>
        <div className="space-y-1.5">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = mockReviews.filter((r) => r.rating === star).length;
            const percent = (count / mockReviews.length) * 100;
            return (
              <div key={star} className="flex items-center gap-2 text-sm">
                <span className="w-4">{star}</span>
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-amber-400" style={{ width: `${percent}%` }} />
                </div>
                <span className="w-8 text-right text-muted-foreground">{count}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Фильтры */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по отзывам..." className="pl-9" />
        </div>
        {[
          { id: "all", l: "Все" },
          { id: "pending", l: "Без ответа" },
          { id: "positive", l: "Положительные" },
          { id: "negative", l: "Нуждают внимания" },
        ].map((f) => (
          <Button key={f.id} size="sm" variant={filter === f.id ? "default" : "outline"} onClick={() => setFilter(f.id)}>
            {f.l}
          </Button>
        ))}
      </div>

      {/* Список отзывов */}
      <div className="space-y-3">
        {filtered.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-start gap-3">
              <img src={r.avatar} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" loading="lazy" decoding="async" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-medium text-sm">{r.author}</span>
                  <div className="flex gap-0.5">
                    {[1,2,3,4,5].map((s) => (
                      <Star key={s} className={`h-3 w-3 ${s <= r.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDate(r.date)}</span>
                  {r.status === "pending" && <Badge className="bg-amber-500 text-white text-[10px]">Без ответа</Badge>}
                </div>
                <Badge variant="outline" className="text-[10px] mb-1.5">{r.product}</Badge>
                <p className="text-sm text-muted-foreground mb-2">{r.text}</p>

                {/* Ответ кондитера */}
                {r.hasReply && (
                  <div className="ml-4 pl-3 border-l-2 border-primary/30 mb-2">
                    <div className="text-xs font-medium text-primary mb-0.5">Ваш ответ:</div>
                    <p className="text-xs text-muted-foreground">{r.reply}</p>
                  </div>
                )}

                {/* Действия */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <button className="flex items-center gap-1 hover:text-primary transition">
                    <ThumbsUp className="h-3 w-3" />{r.likes}
                  </button>
                  {!r.hasReply && (
                    <button
                      onClick={() => setReplyingTo(replyingTo === r.id ? null : r.id)}
                      className="flex items-center gap-1 hover:text-primary transition"
                    >
                      <Reply className="h-3 w-3" />Ответить
                    </button>
                  )}
                  <button className="flex items-center gap-1 hover:text-primary transition">
                    <Share2 className="h-3 w-3" />Поделиться
                  </button>
                  <button className="flex items-center gap-1 hover:text-rose-500 transition ml-auto">
                    <Flag className="h-3 w-3" />Пожаловаться
                  </button>
                </div>

                {/* Форма ответа */}
                {replyingTo === r.id && (
                  <div className="mt-3 flex gap-2">
                    <Textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Ваш ответ на отзыв..."
                      rows={2}
                      className="text-sm"
                    />
                    <div className="flex flex-col gap-1">
                      <Button size="sm" onClick={() => handleReply(r.id)}><Check className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" onClick={() => setReplyingTo(null)}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// ВКЛАДКА: Клиенты (CRM)
// ============================================================
export function ConfectionerClientsTab({ confectionerId }: { confectionerId: string }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const mockClients = [
    { id: "cl1", name: "Анна К.", phone: "+7 916 555-12-34", email: "anna@example.ru", avatar: "https://i.pravatar.cc/150?img=49", ordersCount: 5, totalSpent: 18500, lastOrder: "2026-06-28", city: "Волоколамск", status: "vip", tags: ["Постоянный", "Свадебные торты"] },
    { id: "cl2", name: "Михаил В.", phone: "+7 916 222-33-44", email: "mikhail@example.ru", avatar: "https://i.pravatar.cc/150?img=51", ordersCount: 3, totalSpent: 9800, lastOrder: "2026-06-25", city: "Волоколамск", status: "regular", tags: ["Крестины"] },
    { id: "cl3", name: "Ольга М.", phone: "+7 905 333-44-55", email: "olga@example.ru", avatar: "https://i.pravatar.cc/150?img=23", ordersCount: 2, totalSpent: 5600, lastOrder: "2026-06-20", city: "Москва", status: "regular", tags: [] },
    { id: "cl4", name: "Игорь П.", phone: "+7 926 444-55-66", email: "igor@example.ru", avatar: "https://i.pravatar.cc/150?img=58", ordersCount: 1, totalSpent: 1200, lastOrder: "2026-06-15", city: "Волоколамск", status: "new", tags: ["Корпоратив"] },
    { id: "cl5", name: "Светлана К.", phone: "+7 915 666-77-88", email: "svetlana@example.ru", avatar: "https://i.pravatar.cc/150?img=33", ordersCount: 8, totalSpent: 34200, lastOrder: "2026-06-10", city: "Москва", status: "vip", tags: ["Постоянный", "VIP"] },
  ];

  const filtered = mockClients.filter((c) => {
    if (filter === "vip" && c.status !== "vip") return false;
    if (filter === "new" && c.status !== "new") return false;
    if (search) {
      const q = search.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.email.toLowerCase().includes(q);
    }
    return true;
  });

  const totalRevenue = mockClients.reduce((s, c) => s + c.totalSpent, 0);
  const vipCount = mockClients.filter((c) => c.status === "vip").length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          Клиенты (CRM)
        </h2>
        <p className="text-sm text-muted-foreground mt-1">База клиентов, история заказов, сегментация</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3"><Users className="h-5 w-5 text-primary mb-1" /><div className="text-2xl font-bold">{mockClients.length}</div><div className="text-xs text-muted-foreground">Клиентов</div></Card>
        <Card className="p-3"><DollarSign className="h-5 w-5 text-emerald-500 mb-1" /><div className="text-2xl font-bold text-emerald-600">{formatCurrency(totalRevenue)}</div><div className="text-xs text-muted-foreground">Сумма покупок</div></Card>
        <Card className="p-3"><Heart className="h-5 w-5 text-rose-500 mb-1" /><div className="text-2xl font-bold text-rose-600">{vipCount}</div><div className="text-xs text-muted-foreground">VIP клиентов</div></Card>
        <Card className="p-3"><Repeat className="h-5 w-5 text-purple-500 mb-1" /><div className="text-2xl font-bold">{Math.round(mockClients.filter((c) => c.ordersCount > 1).length / mockClients.length * 100)}%</div><div className="text-xs text-muted-foreground">Возвращаются</div></Card>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по имени, телефону, email..." className="pl-9" />
        </div>
        {[
          { id: "all", l: "Все" },
          { id: "vip", l: "VIP" },
          { id: "new", l: "Новые" },
        ].map((f) => (
          <Button key={f.id} size="sm" variant={filter === f.id ? "default" : "outline"} onClick={() => setFilter(f.id)}>
            {f.l}
          </Button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((c) => (
          <Card key={c.id} className="p-3 flex flex-wrap items-center gap-3">
            <img src={c.avatar} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" loading="lazy" decoding="async" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{c.name}</span>
                {c.status === "vip" && <Badge className="bg-amber-500 text-white text-[10px]">VIP</Badge>}
                {c.status === "new" && <Badge variant="secondary" className="text-[10px]">Новый</Badge>}
                {c.tags.map((t) => <Badge key={t} variant="outline" className="text-[9px]">{t}</Badge>)}
              </div>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-3 mt-0.5">
                <span><Phone className="h-3 w-3 inline" /> {c.phone}</span>
                <span><MapPin className="h-3 w-3 inline" /> {c.city}</span>
                <span><Calendar className="h-3 w-3 inline" /> Последний: {formatDate(c.lastOrder)}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="font-bold text-sm">{formatCurrency(c.totalSpent)}</div>
              <div className="text-xs text-muted-foreground">{c.ordersCount} заказов</div>
            </div>
            <Button size="sm" variant="outline"><Eye className="h-3.5 w-3.5 mr-1" />Профиль</Button>
            <Button size="sm" variant="ghost"><Mail className="h-3.5 w-3.5" /></Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// ВКЛАДКА: Маркетинг (акции, промокоды, баннеры)
// ============================================================
export function ConfectionerMarketingTab({ confectionerId, confectionerName }: { confectionerId: string; confectionerName: string }) {
  const [tab, setTab] = useState<"promos" | "banners" | "coupons">("promos");

  const mockPromos = [
    { id: "pr1", title: "Скидка 15% на свадебные торты", discount: 15, active: true, uses: 23, limit: 50, endDate: "2026-08-31", revenue: 34500 },
    { id: "pr2", title: "Набор пряников + печать в подарок", discount: 0, active: true, uses: 12, limit: 30, endDate: "2026-07-31", revenue: 14400 },
    { id: "pr3", title: "Скидка 10% на день рождения", discount: 10, active: false, uses: 45, limit: 100, endDate: "2026-06-30", revenue: 56700 },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Gift className="h-5 w-5 text-primary" />
          Маркетинг
        </h2>
        <p className="text-sm text-muted-foreground mt-1">Акции, промокоды и баннеры для продвижения</p>
      </div>

      <div className="flex gap-1 border-b">
        {[
          { id: "promos", l: "Акции", icon: Gift },
          { id: "coupons", l: "Промокоды", icon: Tag },
          { id: "banners", l: "Баннеры", icon: ImageIcon },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition flex items-center gap-1.5 ${
              tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.l}
          </button>
        ))}
      </div>

      {tab === "promos" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />Создать акцию</Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-3"><Gift className="h-5 w-5 text-primary mb-1" /><div className="text-2xl font-bold">{mockPromos.length}</div><div className="text-xs text-muted-foreground">Акций</div></Card>
            <Card className="p-3"><Check className="h-5 w-5 text-emerald-500 mb-1" /><div className="text-2xl font-bold text-emerald-600">{mockPromos.filter((p) => p.active).length}</div><div className="text-xs text-muted-foreground">Активных</div></Card>
            <Card className="p-3"><ShoppingBag className="h-5 w-5 text-blue-500 mb-1" /><div className="text-2xl font-bold">{mockPromos.reduce((s, p) => s + p.uses, 0)}</div><div className="text-xs text-muted-foreground">Использовано</div></Card>
            <Card className="p-3"><DollarSign className="h-5 w-5 text-emerald-500 mb-1" /><div className="text-2xl font-bold text-emerald-600">{formatCurrency(mockPromos.reduce((s, p) => s + p.revenue, 0))}</div><div className="text-xs text-muted-foreground">Доход</div></Card>
          </div>
          {mockPromos.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.title}</span>
                  {p.discount > 0 && <Badge className="bg-rose-500 text-white">-{p.discount}%</Badge>}
                  <Badge variant={p.active ? "default" : "secondary"}>{p.active ? "Активна" : "Выключена"}</Badge>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost"><Edit className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><span className="text-muted-foreground text-xs">Использовано:</span><div className="font-medium">{p.uses} / {p.limit}</div></div>
                <div><span className="text-muted-foreground text-xs">Доход:</span><div className="font-medium text-emerald-600">{formatCurrency(p.revenue)}</div></div>
                <div><span className="text-muted-foreground text-xs">Действует до:</span><div className="font-medium">{formatDate(p.endDate)}</div></div>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${(p.uses / p.limit) * 100}%` }} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === "coupons" && (
        <Card className="p-6 text-center">
          <Tag className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
          <h3 className="font-semibold">Промокоды</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Создавайте промокоды для скидок</p>
          <Button><Plus className="h-4 w-4 mr-1" />Создать промокод</Button>
        </Card>
      )}

      {tab === "banners" && (
        <Card className="p-6 text-center">
          <ImageIcon className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
          <h3 className="font-semibold">Баннеры</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Рекламные баннеры для вашего профиля</p>
          <Button><Plus className="h-4 w-4 mr-1" />Загрузить баннер</Button>
        </Card>
      )}
    </div>
  );
}

// ============================================================
// ВКЛАДКА: Печать на пряниках и бумаге
// ============================================================
export function ConfectionerPrintingTab({ confectionerId, confectionerName }: { confectionerId: string; confectionerName: string }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", price: 0, priceUnit: "sheet",
    category: "print_sugar_paper", availableProducts: "",
  });

  const mockPrintServices = [
    { id: "sp_print_1", title: "Печать на пряниках (фото, логотип)", price: 150, unit: "за шт", category: "print_gingerbread", active: true, orders: 23 },
    { id: "sp_print_2", title: "Печать на сахарной бумаге (А4)", price: 500, unit: "за лист", category: "print_sugar_paper", active: true, orders: 45 },
    { id: "sp_print_3", title: "Печать на рисовой бумаге (А4)", price: 450, unit: "за лист", category: "print_rice_paper", active: true, orders: 12 },
    { id: "sp_print_10", title: "Набор пряников с печатью (10 шт)", price: 1200, unit: "за набор", category: "print_gingerbread", active: true, orders: 18 },
  ];

  const categories = [
    { value: "print_gingerbread", label: "🍪 Печать на пряниках" },
    { value: "print_sugar_paper", label: "📄 Сахарная бумага" },
    { value: "print_rice_paper", label: "📃 Рисовая бумага" },
    { value: "print_wafer_paper", label: "🖼️ Вафельная бумага" },
    { value: "print_chocolate", label: "🍫 Печать на шоколаде" },
    { value: "print_icing_sheet", label: "✨ Глазурная бумага" },
    { value: "print_custom_cookie", label: "🍪 Печать на печенье" },
    { value: "print_edible_stickers", label: "🏷️ Съедобные наклейки" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" />
            Печать на пряниках и бумаге
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Услуги пищевой печати для ваших клиентов</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4 mr-1" />Добавить услугу
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols=4 gap-3">
        <Card className="p-3"><Printer className="h-5 w-5 text-primary mb-1" /><div className="text-2xl font-bold">{mockPrintServices.length}</div><div className="text-xs text-muted-foreground">Услуг</div></Card>
        <Card className="p-3"><ShoppingBag className="h-5 w-5 text-blue-500 mb-1" /><div className="text-2xl font-bold">{mockPrintServices.reduce((s, p) => s + p.orders, 0)}</div><div className="text-xs text-muted-foreground">Заказов</div></Card>
        <Card className="p-3"><DollarSign className="h-5 w-5 text-emerald-500 mb-1" /><div className="text-2xl font-bold text-emerald-600">{formatCurrency(mockPrintServices.reduce((s, p) => s + p.price * p.orders, 0))}</div><div className="text-xs text-muted-foreground">Доход</div></Card>
        <Card className="p-3"><Check className="h-5 w-5 text-emerald-500 mb-1" /><div className="text-2xl font-bold text-emerald-600">{mockPrintServices.filter((p) => p.active).length}</div><div className="text-xs text-muted-foreground">Активных</div></Card>
      </div>

      {showForm && (
        <Card className="p-4 space-y-3 border-2 border-primary/30">
          <h3 className="font-semibold">Новая услуга печати</h3>
          <div>
            <Label>Тип печати</Label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full h-10 rounded-md border border-border bg-card px-3 text-sm mt-1">
              {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <Label>Название услуги</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Печать на пряниках (фото, логотип)" />
          </div>
          <div>
            <Label>Описание</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2} placeholder="Пищевая печать на имбирных пряниках..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Цена, ₽</Label>
              <Input type="number" value={form.price || ""} onChange={(e) => setForm({ ...form, price: +e.target.value })} />
            </div>
            <div>
              <Label>Единица</Label>
              <select value={form.priceUnit} onChange={(e) => setForm({ ...form, priceUnit: e.target.value })}
                className="w-full h-10 rounded-md border border-border bg-card px-3 text-sm mt-1">
                <option value="sheet">за лист</option>
                <option value="item">за шт</option>
                <option value="set">за набор</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => { toast.success("Услуга добавлена"); setShowForm(false); }}>Добавить</Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>Отмена</Button>
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {mockPrintServices.map((sp) => (
          <Card key={sp.id} className="p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Printer className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{sp.title}</div>
              <div className="text-xs text-muted-foreground">
                {categories.find((c) => c.value === sp.category)?.label} • {sp.orders} заказов
              </div>
            </div>
            <div className="font-bold text-primary">{formatCurrency(sp.price)}</div>
            <div className="text-xs text-muted-foreground">{sp.unit}</div>
            <Badge variant={sp.active ? "default" : "secondary"} className="text-[10px]">
              {sp.active ? "Активна" : "Скрыта"}
            </Badge>
            <Button size="sm" variant="ghost"><Edit className="h-3.5 w-3.5" /></Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// ВКЛАДКА: Доставка (зоны, тарифы, самовывоз)
// ============================================================
export function ConfectionerDeliveryTab({ confectionerId, city }: { confectionerId: string; city: string }) {
  const [zones, setZones] = useState([
    { id: "z1", name: "Центр города", radius: "5 км", cost: 300, freeFrom: 3000, active: true },
    { id: "z2", name: "Пригород", radius: "15 км", cost: 500, freeFrom: 5000, active: true },
    { id: "z3", name: "Доставка в Москву", radius: "100 км", cost: 1000, freeFrom: 10000, active: true },
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" />
          Доставка
        </h2>
        <p className="text-sm text-muted-foreground mt-1">Зоны доставки, тарифы, точки самовывоза</p>
      </div>

      {/* Настройки */}
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">Общие настройки</h3>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" defaultChecked className="w-4 h-4 accent-primary" />
            <span className="text-sm">Самовывоз доступен</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" defaultChecked className="w-4 h-4 accent-primary" />
            <span className="text-sm">Своя доставка</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" defaultChecked className="w-4 h-4 accent-primary" />
            <span className="text-sm">Курьер платформы</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-primary" />
            <span className="text-sm">Пункты выдачи (ПВЗ)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-primary" />
            <span className="text-sm">СДЭК</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-primary" />
            <span className="text-sm">Boxberry</span>
          </label>
        </div>
      </Card>

      {/* Зоны доставки */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Зоны доставки</h3>
          <Button size="sm"><Plus className="h-4 w-4 mr-1" />Добавить зону</Button>
        </div>
        <div className="space-y-2">
          {zones.map((z) => (
            <div key={z.id} className="flex items-center gap-3 p-3 border border-border rounded-lg">
              <Navigation className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1">
                <div className="font-medium text-sm">{z.name}</div>
                <div className="text-xs text-muted-foreground">Радиус: {z.radius}</div>
              </div>
              <div className="text-right">
                <div className="font-bold text-sm">{formatCurrency(z.cost)}</div>
                <div className="text-xs text-muted-foreground">бесплатно от {formatCurrency(z.freeFrom)}</div>
              </div>
              <Badge variant={z.active ? "default" : "secondary"} className="text-[10px]">
                {z.active ? "Активна" : "Скрыта"}
              </Badge>
              <Button size="sm" variant="ghost"><Edit className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </div>
      </Card>

      {/* Точки самовывоза */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Точки самовывоза</h3>
          <Button size="sm"><Plus className="h-4 w-4 mr-1" />Добавить точку</Button>
        </div>
        <Card className="p-3 bg-muted/30 border-dashed">
          <div className="flex items-center gap-3">
            <MapPin className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <div className="text-sm font-medium">{city}, ул. Революционная, 15</div>
              <div className="text-xs text-muted-foreground">Кофейня «Уют» • Пн-Вс 9:00-21:00</div>
            </div>
            <Button size="sm" variant="ghost"><Edit className="h-3.5 w-3.5" /></Button>
          </div>
        </Card>
      </Card>
    </div>
  );
}
