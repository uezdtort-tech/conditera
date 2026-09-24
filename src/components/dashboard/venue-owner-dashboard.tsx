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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  LayoutDashboard, Package, FileText, Wallet, Settings, LogOut,
  Plus, Edit, Trash2, Star, Eye, Upload, ChevronLeft, Calendar,
  TrendingUp, DollarSign, Users, MapPin, Clock, Sparkles, Check,
  X, Building2, Image as ImageIcon, ArrowRight, Download, Megaphone,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/finance";
import { SERVICE_CATEGORIES, PRICE_UNIT_LABELS } from "@/lib/mock-data-services";
import { ServicesManager } from "@/components/dashboard/services-manager";
import { toast } from "sonner";

type Tab = "overview" | "venue" | "services" | "listings" | "priceLists" | "bookings" | "earnings" | "settings";

export function VenueOwnerDashboard() {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const venue = useAppStore((s) => s.getVenueByOwner(user?.id || ""));
  const services = useAppStore((s) => s.venueServices);
  const priceLists = useAppStore((s) => s.priceLists);
  const [tab, setTab] = useState<Tab>("overview");

  // Используем первую площадку моковую если своей нет (для demo)
  // ВАЖНО: useMemo должны вызываться до early return (rules-of-hooks)
  const myVenue = venue || (user?.id === "demo-venue-owner" ? useAppStore.getState().venues.find((v) => v.id === "v1") : undefined);
  const myServices = useMemo(
    () => myVenue ? services.filter((s) => s.venueId === myVenue.id) : [],
    [services, myVenue]
  );
  const myPriceLists = useMemo(
    () => priceLists.filter((pl) => pl.ownerId === (user?.id || "")),
    [priceLists, user?.id]
  );

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>Войти</Button>
      </div>
    );
  }

  const tabs = [
    { id: "overview" as Tab, label: "Обзор", icon: LayoutDashboard },
    { id: "venue" as Tab, label: "Моя площадка", icon: Building2 },
    { id: "services" as Tab, label: "Услуги площадки", icon: Package, badge: String(myServices.length) },
    { id: "listings" as Tab, label: "Объявления услуг", icon: Megaphone },
    { id: "priceLists" as Tab, label: "Прайс-листы", icon: FileText, badge: String(myPriceLists.length) },
    { id: "bookings" as Tab, label: "Бронирования", icon: Calendar, badge: "3" },
    { id: "earnings" as Tab, label: "Финансы", icon: Wallet },
    { id: "settings" as Tab, label: "Настройки", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="container mx-auto px-4 py-6">
        <button
          onClick={() => navigate("home")}
          className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 mb-4"
        >
          <ChevronLeft className="h-4 w-4" /> На главную
        </button>

        <div className="grid lg:grid-cols-[260px_1fr] gap-6">
          {/* Сайдбар */}
          <aside>
            <Card className="p-4 sticky top-20">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white">
                  <Building2 className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{user.name}</div>
                  <div className="text-xs text-muted-foreground">Владелец площадки</div>
                </div>
              </div>
              <div className="space-y-1">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded-md text-sm transition ${
                      tab === t.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent"
                    }`}
                  >
                    <t.icon className="h-4 w-4" />
                    <span className="flex-1">{t.label}</span>
                    {t.badge && <Badge variant="secondary" className="text-[10px]">{t.badge}</Badge>}
                  </button>
                ))}
              </div>
              <div className="pt-4 mt-4 border-t">
                <Button variant="ghost" size="sm" onClick={logout} className="w-full justify-start text-destructive">
                  <LogOut className="h-4 w-4 mr-2" /> Выйти
                </Button>
              </div>
            </Card>
          </aside>

          {/* Контент */}
          <div>
            {tab === "overview" && (
              <div className="space-y-4">
                <h1 className="text-2xl font-bold">Кабинет владельца площадки</h1>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Card className="p-4">
                    <DollarSign className="h-5 w-5 text-emerald-500 mb-1" />
                    <div className="text-2xl font-bold">142 800 ₽</div>
                    <div className="text-xs text-muted-foreground">Доход за месяц</div>
                  </Card>
                  <Card className="p-4">
                    <Calendar className="h-5 w-5 text-blue-500 mb-1" />
                    <div className="text-2xl font-bold">18</div>
                    <div className="text-xs text-muted-foreground">Бронирований</div>
                  </Card>
                  <Card className="p-4">
                    <Package className="h-5 w-5 text-purple-500 mb-1" />
                    <div className="text-2xl font-bold">{myServices.length}</div>
                    <div className="text-xs text-muted-foreground">Активных услуг</div>
                  </Card>
                  <Card className="p-4">
                    <Star className="h-5 w-5 text-amber-500 mb-1" />
                    <div className="text-2xl font-bold">{myVenue?.rating || "—"}</div>
                    <div className="text-xs text-muted-foreground">Рейтинг</div>
                  </Card>
                </div>

                {myVenue && (
                  <Card className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <img src={myVenue.logo} alt="" className="w-12 h-12 rounded-xl object-cover" loading="lazy" decoding="async" />
                      <div className="flex-1">
                        <div className="font-semibold">{myVenue.businessName}</div>
                        <div className="text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 inline mr-1" />
                          {myVenue.city}, {myVenue.address}
                        </div>
                      </div>
                      {myVenue.verified && <Badge className="bg-emerald-500 text-white">✓ Проверен</Badge>}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                      <div><span className="text-muted-foreground text-xs">Тип:</span> {myVenue.venueTypeLabel}</div>
                      <div><span className="text-muted-foreground text-xs">Площадь:</span> {myVenue.area} м²</div>
                      <div><span className="text-muted-foreground text-xs">Вместимость:</span> {myVenue.capacity} чел</div>
                      <div><span className="text-muted-foreground text-xs">Часы:</span> {myVenue.workingHours.from}-{myVenue.workingHours.to}</div>
                    </div>
                  </Card>
                )}

                <Card className="p-4">
                  <h3 className="font-semibold mb-3">Бронирования на ближайшую неделю</h3>
                  <div className="space-y-2">
                    {[
                      { date: "5 июля, сб", time: "12:00-14:00", client: "Анна К.", service: "День рождения (15 детей)", sum: 12000, status: "confirmed" },
                      { date: "6 июля, вс", time: "15:00-17:00", client: "Игорь П.", service: "Детский праздник (10 детей)", sum: 18000, status: "confirmed" },
                      { date: "8 июля, вт", time: "11:00-13:00", client: "Ольга М.", service: "Игровая комната", sum: 2500, status: "pending" },
                    ].map((b, i) => (
                      <div key={i} className="flex items-center gap-3 p-2 border border-border rounded text-sm">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Calendar className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{b.client} — {b.service}</div>
                          <div className="text-xs text-muted-foreground">{b.date} • {b.time}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold">{formatCurrency(b.sum)}</div>
                          <Badge variant={b.status === "confirmed" ? "default" : "secondary"} className="text-[10px]">
                            {b.status === "confirmed" ? "Подтверждено" : "Ожидает"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {tab === "venue" && myVenue && <VenueProfileTab venue={myVenue} />}
            {tab === "venue" && !myVenue && (
              <Card className="p-8 text-center">
                <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <h3 className="font-semibold mb-1">У вас пока нет площадки</h3>
                <p className="text-sm text-muted-foreground mb-4">Создайте карточку площадки, чтобы начать принимать бронирования</p>
                <Button><Plus className="h-4 w-4 mr-1" />Создать площадку</Button>
              </Card>
            )}

            {tab === "services" && myVenue && <VenueServicesTab venueId={myVenue.id} venueName={myVenue.businessName} venueLogo={myVenue.logo} venueImages={myVenue.galleryImages} />}
            {tab === "services" && !myVenue && (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                Сначала создайте площадку
              </Card>
            )}

            {tab === "priceLists" && <PriceListsTab ownerId={user.id} ownerName={user.name} />}

            {tab === "bookings" && (
              <Card className="p-6 text-center">
                <Calendar className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                <h3 className="font-semibold">Календарь бронирований</h3>
                <p className="text-sm text-muted-foreground mt-1">Полный список и управление слотами</p>
                <Button className="mt-3">Открыть календарь</Button>
              </Card>
            )}

            {tab === "earnings" && (
              <div className="space-y-4">
                <h2 className="text-xl font-bold">Финансы</h2>
                <div className="grid grid-cols-3 gap-3">
                  <Card className="p-4"><div className="text-xs text-muted-foreground">За месяц</div><div className="text-2xl font-bold text-emerald-600">142 800 ₽</div></Card>
                  <Card className="p-4"><div className="text-xs text-muted-foreground">Комиссия (5%)</div><div className="text-2xl font-bold text-rose-600">7 140 ₽</div></Card>
                  <Card className="p-4"><div className="text-xs text-muted-foreground">К выплате</div><div className="text-2xl font-bold">135 660 ₽</div></Card>
                </div>
                <Card className="p-4">
                  <h3 className="font-semibold mb-3">Динамика по месяцам</h3>
                  <div className="flex items-end gap-2 h-32">
                    {[45, 62, 58, 78, 85, 92, 105, 118, 142].map((h, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <div className="text-[10px] font-medium">{[68, 89, 82, 112, 124, 132, 152, 168, 142][i]}K</div>
                        <div className="w-full bg-gradient-to-t from-primary to-accent rounded-t" style={{ height: `${h}%` }} />
                        <span className="text-[10px] text-muted-foreground">{["Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя"][i]}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {tab === "listings" && (
              <ServicesManager />
            )}

            {tab === "settings" && (
              <Card className="p-6 space-y-4">
                <h3 className="font-semibold">Настройки профиля</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <div><Label>Название площадки</Label><Input defaultValue={myVenue?.businessName || ""} /></div>
                  <div><Label>Телефон</Label><Input defaultValue={myVenue?.phone || user.phone || ""} /></div>
                  <div><Label>Email</Label><Input defaultValue={myVenue?.email || user.email} /></div>
                  <div><Label>Сайт</Label><Input defaultValue={myVenue?.website || ""} placeholder="https://..." /></div>
                </div>
                <Button>Сохранить</Button>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Вкладка: Профиль площадки =====
function VenueProfileTab({ venue }: { venue: NonNullable<ReturnType<typeof useAppStore.getState>["venues"][number]> }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Профиль площадки</h2>

      {/* Обложка + лого */}
      <Card className="overflow-hidden">
        <div className="relative h-40">
          <img src={venue.coverImage} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <Button size="sm" className="absolute top-3 right-3">
            <Upload className="h-3.5 w-3.5 mr-1" />Сменить обложку
          </Button>
        </div>
        <div className="p-4 -mt-10 relative">
          <img src={venue.logo} alt="" className="w-16 h-16 rounded-2xl border-4 border-card object-cover" loading="lazy" decoding="async" />
          <div className="mt-2">
            <h3 className="font-bold text-lg">{venue.businessName}</h3>
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <MapPin className="h-3 w-3" />{venue.city}, {venue.address}
            </div>
          </div>
        </div>
      </Card>

      {/* Галерея */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Фотогалерея ({venue.galleryImages.length})</h3>
          <Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5 mr-1" />Добавить фото</Button>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
          {venue.galleryImages.map((img, i) => (
            <div key={i} className="relative aspect-square rounded-lg overflow-hidden group">
              <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
              <button className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition">
                <X className="h-3 w-3 mx-auto" />
              </button>
            </div>
          ))}
          <button className="aspect-square rounded-lg border-2 border-dashed border-border hover:border-primary/40 flex items-center justify-center text-muted-foreground hover:text-primary">
            <Plus className="h-6 w-6" />
          </button>
        </div>
      </Card>

      {/* Характеристики */}
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">Характеристики</h3>
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <div className="flex items-center justify-between p-2 rounded bg-muted/40">
            <span className="text-muted-foreground">Тип площадки</span>
            <Badge variant="outline">{venue.venueTypeLabel}</Badge>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-muted/40">
            <span className="text-muted-foreground">Площадь</span>
            <span className="font-medium">{venue.area} м²</span>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-muted/40">
            <span className="text-muted-foreground">Вместимость</span>
            <span className="font-medium">{venue.capacity} чел</span>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-muted/40">
            <span className="text-muted-foreground">Часы работы</span>
            <span className="font-medium">{venue.workingHours.days} {venue.workingHours.from}-{venue.workingHours.to}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Возрастные группы</div>
          <div className="flex flex-wrap gap-1">
            {venue.ageGroups.map((g) => <Badge key={g} variant="secondary">{g}</Badge>)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Удобства</div>
          <div className="flex flex-wrap gap-1">
            {venue.amenities.map((a) => <Badge key={a} variant="outline">{a}</Badge>)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Услуги</div>
          <div className="flex flex-wrap gap-1">
            {venue.services.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-2">Описание</h3>
        <Textarea rows={4} defaultValue={venue.description} />
        <Button size="sm" className="mt-2">Сохранить</Button>
      </Card>
    </div>
  );
}

// ===== Вкладка: Карточки услуг =====
function VenueServicesTab({ venueId, venueName, venueLogo, venueImages }: {
  venueId: string;
  venueName: string;
  venueLogo: string;
  venueImages: string[];
}) {
  const services = useAppStore((s) => s.venueServices);
  const addVenueService = useAppStore((s) => s.addVenueService);
  const updateVenueService = useAppStore((s) => s.updateVenueService);
  const deleteVenueService = useAppStore((s) => s.deleteVenueService);
  const toggleFeatured = useAppStore((s) => s.toggleVenueServiceFeatured);

  const myServices = useMemo(() => services.filter((s) => s.venueId === venueId), [services, venueId]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "", description: "", category: "venue_trampoline", price: 0,
    priceUnit: "event", durationMinutes: 120, groupMin: 5, groupMax: 15,
    ageMin: 5, ageMax: 15, suitableFor: "birthday,kids", includes: "", safetyNote: "",
  });

  const resetForm = () => {
    setForm({
      title: "", description: "", category: "venue_trampoline", price: 0,
      priceUnit: "event", durationMinutes: 120, groupMin: 5, groupMax: 15,
      ageMin: 5, ageMax: 15, suitableFor: "birthday,kids", includes: "", safetyNote: "",
    });
    setEditingId(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error("Введите название услуги"); return; }
    const cat = SERVICE_CATEGORIES.find((c) => c.slug === form.category);
    const serviceData = {
      venueId, venueName, venueLogo,
      title: form.title.trim(),
      description: form.description.trim(),
      category: form.category,
      categoryLabel: cat?.name || form.category,
      includes: form.includes.split(",").map((s) => s.trim()).filter(Boolean),
      images: venueImages.slice(0, 1),
      mainImage: venueImages[0] || venueLogo,
      price: form.price,
      priceUnit: form.priceUnit,
      durationMinutes: form.durationMinutes,
      groupSize: { min: form.groupMin, max: form.groupMax },
      ageRestriction: { min: form.ageMin, max: form.ageMax },
      suitableFor: form.suitableFor.split(",").map((s) => s.trim()).filter(Boolean),
      isPopular: false,
      isFeatured: false,
      availability: "available" as const,
      crossSellWith: [],
      safetyNote: form.safetyNote || undefined,
      status: "published" as const,
    };
    if (editingId) {
      updateVenueService(editingId, serviceData);
      toast.success("Услуга обновлена");
    } else {
      addVenueService(serviceData);
      toast.success("Услуга добавлена");
    }
    setShowForm(false);
    resetForm();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Карточки услуг</h2>
          <p className="text-sm text-muted-foreground">Создавайте карточки услуг, которые увидят покупатели</p>
        </div>
        <Button onClick={() => { resetForm(); setShowForm(true); }}>
          <Plus className="h-4 w-4 mr-1" />Добавить услугу
        </Button>
      </div>

      {myServices.length === 0 ? (
        <Card className="p-8 text-center">
          <Package className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-4">Пока нет услуг. Создайте первую!</p>
          <Button onClick={() => { resetForm(); setShowForm(true); }}>Создать услугу</Button>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {myServices.map((s) => (
            <Card key={s.id} className="overflow-hidden">
              <div className="relative aspect-video bg-muted">
                <img src={s.mainImage} alt={s.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                <div className="absolute top-2 right-2 flex gap-1">
                  <Button
                    size="icon"
                    variant="secondary"
                    className={`h-7 w-7 ${s.isFeatured ? "bg-amber-500 text-white" : ""}`}
                    onClick={() => toggleFeatured(s.id)}
                    title="В карусель на главной"
                  >
                    <Sparkles className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-7 w-7"
                    onClick={() => {
                      setEditingId(s.id);
                      setForm({
                        title: s.title, description: s.description, category: s.category,
                        price: s.price, priceUnit: s.priceUnit,
                        durationMinutes: s.durationMinutes || 0,
                        groupMin: (s.groupSize && typeof s.groupSize === "object") ? s.groupSize.min : 0,
                        groupMax: (s.groupSize && typeof s.groupSize === "object") ? s.groupSize.max : 0,
                        ageMin: (s.ageRestriction && typeof s.ageRestriction === "object") ? s.ageRestriction.min : 0,
                        ageMax: (s.ageRestriction && typeof s.ageRestriction === "object") ? s.ageRestriction.max : 0,
                        suitableFor: (s.suitableFor || []).join(","),
                        includes: (s.includes || []).join(","),
                        safetyNote: s.safetyNote || "",
                      });
                      setShowForm(true);
                    }}
                  >
                    <Edit className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-7 w-7 text-destructive"
                    onClick={() => {
                      if (confirm(`Удалить «${s.title}»?`)) {
                        deleteVenueService(s.id);
                        toast.success("Услуга удалена");
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {s.isFeatured && (
                  <Badge className="absolute top-2 left-2 bg-amber-500 text-white text-[10px]">
                    <Sparkles className="h-2.5 w-2.5 mr-0.5" />В карусели
                  </Badge>
                )}
              </div>
              <div className="p-3">
                <h3 className="font-medium text-sm line-clamp-1">{s.title}</h3>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[9px]">{s.categoryLabel}</Badge>
                  <span>⏱ {s.durationMinutes} мин</span>
                  <span>👥 {(s.groupSize && typeof s.groupSize === "object") ? `${s.groupSize.min}-${s.groupSize.max}` : ""}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="font-bold text-primary">{formatCurrency(s.price)}</div>
                  <span className="text-xs text-muted-foreground">/{PRICE_UNIT_LABELS[s.priceUnit] || s.priceUnit}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Модальная форма */}
      <Dialog open={showForm} onOpenChange={(open) => { setShowForm(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{editingId ? "Редактировать услугу" : "Новая услуга"}</DialogTitle>
            <DialogDescription>Заполните данные карточки услуги</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label>Название *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Аренда батутного парка на день рождения" required />
            </div>
            <div>
              <Label>Описание</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Что включено, особенности, выгоды..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Категория</Label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full h-10 rounded-md border border-border bg-card px-3 text-sm">
                  {SERVICE_CATEGORIES.map((c) => (
                    <option key={c.slug} value={c.slug}>{c.icon} {c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Единица цены</Label>
                <select value={form.priceUnit} onChange={(e) => setForm({ ...form, priceUnit: e.target.value })} className="w-full h-10 rounded-md border border-border bg-card px-3 text-sm">
                  {Object.entries(PRICE_UNIT_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div><Label>Цена, ₽</Label><Input type="number" value={form.price || ""} onChange={(e) => setForm({ ...form, price: +e.target.value })} /></div>
              <div><Label>Длительность, мин</Label><Input type="number" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: +e.target.value })} /></div>
              <div><Label>Мин. чел</Label><Input type="number" value={form.groupMin} onChange={(e) => setForm({ ...form, groupMin: +e.target.value })} /></div>
              <div><Label>Макс. чел</Label><Input type="number" value={form.groupMax} onChange={(e) => setForm({ ...form, groupMax: +e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Мин. возраст</Label><Input type="number" value={form.ageMin} onChange={(e) => setForm({ ...form, ageMin: +e.target.value })} /></div>
              <div><Label>Макс. возраст</Label><Input type="number" value={form.ageMax} onChange={(e) => setForm({ ...form, ageMax: +e.target.value })} /></div>
            </div>
            <div>
              <Label>Что включено (через запятую)</Label>
              <Input value={form.includes} onChange={(e) => setForm({ ...form, includes: e.target.value })} placeholder="2 часа аренды, Аниматор, Комната для чаепития" />
            </div>
            <div>
              <Label>Подходит для (через запятую)</Label>
              <Input value={form.suitableFor} onChange={(e) => setForm({ ...form, suitableFor: e.target.value })} placeholder="birthday, kids, corporate" />
            </div>
            <div>
              <Label>Заметка по безопасности</Label>
              <Input value={form.safetyNote} onChange={(e) => setForm({ ...form, safetyNote: e.target.value })} placeholder="Возраст от 7 лет, рост от 120 см" />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1">{editingId ? "Сохранить" : "Добавить услугу"}</Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Отмена</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===== Вкладка: Прайс-листы =====
function PriceListsTab({ ownerId, ownerName }: { ownerId: string; ownerName: string }) {
  const priceLists = useAppStore((s) => s.priceLists);
  const addPriceList = useAppStore((s) => s.addPriceList);
  const addPriceListItem = useAppStore((s) => s.addPriceListItem);
  const deletePriceListItem = useAppStore((s) => s.deletePriceListItem);
  const convertPriceItemToService = useAppStore((s) => s.convertPriceItemToService);

  // Для демо показываем все прайсы, в проде — только свои
  const myPriceLists = priceLists.filter((pl) => pl.ownerId === ownerId || pl.ownerId.startsWith("demo-venue"));
  const [showCreatePL, setShowCreatePL] = useState(false);
  const [plTitle, setPlTitle] = useState("");
  const [plCategory, setPlCategory] = useState("venue_trampoline");
  const [expandedPL, setExpandedPL] = useState<string | null>(null);

  // Форма новой позиции
  const [newItem, setNewItem] = useState({
    serviceName: "", description: "", price: 0, priceUnit: "event",
    duration: 60, notes: "",
  });

  const handleCreatePL = (e: React.FormEvent) => {
    e.preventDefault();
    if (!plTitle.trim()) return;
    addPriceList({
      ownerId, ownerName, ownerType: "VENUE_OWNER",
      title: plTitle.trim(),
      category: plCategory,
      validFrom: new Date().toISOString().slice(0, 10),
      currency: "RUB",
      items: [],
      status: "active",
    });
    toast.success("Прайс-лист создан");
    setPlTitle("");
    setShowCreatePL(false);
  };

  const handleAddItem = (plId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.serviceName.trim()) return;
    addPriceListItem(plId, {
      serviceName: newItem.serviceName.trim(),
      description: newItem.description,
      category: plCategory,
      price: newItem.price,
      priceUnit: newItem.priceUnit,
      duration: newItem.duration,
      notes: newItem.notes,
      isAvailable: true,
    });
    setNewItem({ serviceName: "", description: "", price: 0, priceUnit: "event", duration: 60, notes: "" });
    toast.success("Позиция добавлена");
  };

  const handleConvert = (plId: string, itemId: string, name: string) => {
    convertPriceItemToService(plId, itemId);
    toast.success(`«${name}» → карточка услуги создана`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Прайс-листы</h2>
          <p className="text-sm text-muted-foreground">Загружайте прайсы и превращайте позиции в карточки услуг</p>
        </div>
        <Button onClick={() => setShowCreatePL(!showCreatePL)}>
          <Plus className="h-4 w-4 mr-1" />Новый прайс
        </Button>
      </div>

      {showCreatePL && (
        <Card className="p-4 space-y-3 border-2 border-primary/30">
          <h3 className="font-semibold">Новый прайс-лист</h3>
          <form onSubmit={handleCreatePL} className="grid md:grid-cols-2 gap-3">
            <div><Label>Название</Label><Input value={plTitle} onChange={(e) => setPlTitle(e.target.value)} placeholder="Прайс-лист 2026" required /></div>
            <div>
              <Label>Категория</Label>
              <select value={plCategory} onChange={(e) => setPlCategory(e.target.value)} className="w-full h-10 rounded-md border border-border bg-card px-3 text-sm">
                {SERVICE_CATEGORIES.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.icon} {c.name}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2 flex gap-2">
              <Button type="submit">Создать</Button>
              <Button type="button" variant="outline" onClick={() => setShowCreatePL(false)}>Отмена</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Загрузка Excel/CSV */}
      <Card className="p-4 border-2 border-dashed border-border hover:border-primary/40 transition cursor-pointer">
        <div className="text-center py-4">
          <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <div className="text-sm font-medium">Загрузить прайс из Excel/CSV</div>
          <p className="text-xs text-muted-foreground mt-1">Перетащите файл .xlsx или .csv, позиции импортируются автоматически</p>
          <Button size="sm" variant="outline" className="mt-2">Выбрать файл</Button>
        </div>
      </Card>

      {/* Список прайс-листов */}
      {myPriceLists.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Нет прайс-листов. Создайте первый!
        </Card>
      ) : (
        <div className="space-y-3">
          {myPriceLists.map((pl) => (
            <Card key={pl.id} className="overflow-hidden">
              <button
                onClick={() => setExpandedPL(expandedPL === pl.id ? null : pl.id)}
                className="w-full flex items-center gap-3 p-4 hover:bg-accent/40 transition text-left"
              >
                <FileText className="h-5 w-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{pl.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {pl.items.length} позиций • Создан {formatDate(pl.createdAt)} • {pl.status === "active" ? "Активен" : "Архив"}
                  </div>
                </div>
                <Badge variant="outline">{pl.items.length}</Badge>
                <ChevronLeft className={`h-4 w-4 transition-transform ${expandedPL === pl.id ? "-rotate-90" : ""}`} />
              </button>

              {expandedPL === pl.id && (
                <div className="border-t bg-muted/20">
                  {/* Существующие позиции */}
                  <div className="divide-y">
                    {pl.items.map((it) => (
                      <div key={it.id} className="flex items-center gap-3 p-3 hover:bg-accent/30">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium line-clamp-1">{it.serviceName}</div>
                          {it.description && <div className="text-xs text-muted-foreground line-clamp-1">{it.description}</div>}
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {it.duration ? `${it.duration} мин • ` : ""}{PRICE_UNIT_LABELS[it.priceUnit] || it.priceUnit}
                            {it.notes && ` • ${it.notes}`}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-sm">{formatCurrency(it.price)}</div>
                          {it.oldPrice && <div className="text-xs text-muted-foreground line-through">{formatCurrency(it.oldPrice)}</div>}
                        </div>
                        {it.venueServiceId ? (
                          <Badge className="bg-emerald-500 text-white text-[10px]">
                            <Check className="h-2.5 w-2.5 mr-0.5" />Карточка
                          </Badge>
                        ) : (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleConvert(pl.id, it.id, it.serviceName)}>
                            <ArrowRight className="h-3 w-3 mr-1" />В карточку
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          onClick={() => deletePriceListItem(pl.id, it.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  {/* Форма добавления позиции */}
                  <form onSubmit={(e) => handleAddItem(pl.id, e)} className="p-3 border-t bg-card">
                    <div className="text-xs font-semibold text-muted-foreground mb-2">Добавить позицию:</div>
                    <div className="grid grid-cols-12 gap-2">
                      <Input
                        className="col-span-12 md:col-span-4 h-8 text-sm"
                        placeholder="Название услуги"
                        value={newItem.serviceName}
                        onChange={(e) => setNewItem({ ...newItem, serviceName: e.target.value })}
                        required
                      />
                      <Input
                        className="col-span-4 md:col-span-2 h-8 text-sm"
                        type="number"
                        placeholder="Цена"
                        value={newItem.price || ""}
                        onChange={(e) => setNewItem({ ...newItem, price: +e.target.value })}
                        required
                      />
                      <select
                        className="col-span-4 md:col-span-2 h-8 text-sm rounded-md border border-border bg-card px-2"
                        value={newItem.priceUnit}
                        onChange={(e) => setNewItem({ ...newItem, priceUnit: e.target.value })}
                      >
                        {Object.entries(PRICE_UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <Input
                        className="col-span-4 md:col-span-2 h-8 text-sm"
                        type="number"
                        placeholder="Мин"
                        value={newItem.duration || ""}
                        onChange={(e) => setNewItem({ ...newItem, duration: +e.target.value })}
                      />
                      <Button type="submit" size="sm" className="col-span-12 md:col-span-2 h-8">
                        <Plus className="h-3 w-3 mr-1" />Добавить
                      </Button>
                    </div>
                  </form>

                  {/* Экспорт */}
                  <div className="p-3 border-t flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Действия:</span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost"><Download className="h-3 w-3 mr-1" />Excel</Button>
                      <Button size="sm" variant="ghost"><Download className="h-3 w-3 mr-1" />CSV</Button>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
