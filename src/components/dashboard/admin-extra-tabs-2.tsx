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
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Utensils, MapPin, Clock, Phone, Check, X, Edit, Trash2, Plus,
  Building2, Store, Search, Filter, Download, Star, TrendingUp,
  Users, Package, DollarSign, AlertCircle, Eye, BarChart3,
  Globe, Search as SearchIcon, Tags, Mail, MessageSquare,
  ExternalLink, Navigation,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/finance";

// ============================================================
// АДМИН: Управление точками дегустации (где попробовать)
// ============================================================
export function AdminTastingLocationsTab() {
  const allLocations = useAppStore((s) => s.tastingLocations);
  const deleteLoc = useAppStore((s) => s.deleteTastingLocation);
  const updateLoc = useAppStore((s) => s.updateTastingLocation);
  const confectioners = useAppStore((s) => s.confectioners);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = allLocations.filter((tl) => {
    if (filter === "active" && tl.status !== "active") return false;
    if (filter === "pending" && tl.status !== "pending") return false;
    if (filter === "unverified" && tl.verified) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        tl.establishmentName.toLowerCase().includes(q) ||
        tl.city.toLowerCase().includes(q) ||
        tl.address.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getConfectionerName = (cid: string) => {
    const c = confectioners.find((c) => c.id === cid);
    return c?.businessName || "Неизвестно";
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Utensils className="h-5 w-5 text-primary" />
          Точки дегустации
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Рестораны и кафе, где можно попробовать продукцию кондитеров
        </p>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Всего</div><div className="text-2xl font-bold">{allLocations.length}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Активных</div><div className="text-2xl font-bold text-emerald-600">{allLocations.filter((t) => t.status === "active").length}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Ожидают</div><div className="text-2xl font-bold text-amber-600">{allLocations.filter((t) => t.status === "pending").length}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Непроверенные</div><div className="text-2xl font-bold text-rose-600">{allLocations.filter((t) => !t.verified).length}</div></Card>
      </div>

      {/* Фильтры */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по названию, городу..." className="pl-9" />
        </div>
        {[
          { id: "all", l: "Все" },
          { id: "active", l: "Активные" },
          { id: "pending", l: "Ожидают" },
          { id: "unverified", l: "Непроверенные" },
        ].map((f) => (
          <Button key={f.id} size="sm" variant={filter === f.id ? "default" : "outline"} onClick={() => setFilter(f.id)}>
            {f.l}
          </Button>
        ))}
      </div>

      {/* Список */}
      <div className="space-y-2">
        {filtered.map((tl) => (
          <Card key={tl.id} className="p-3">
            <div className="flex flex-wrap items-start gap-3">
              {tl.photo && <img src={tl.photo} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" loading="lazy" decoding="async" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{tl.establishmentName}</span>
                  <Badge variant="outline" className="text-[10px]">{tl.typeLabel || tl.type}</Badge>
                  {tl.verified ? (
                    <Badge className="bg-emerald-500 text-white text-[10px]"><Check className="h-2.5 w-2.5 mr-0.5" />Проверено</Badge>
                  ) : (
                    <Badge className="bg-amber-500 text-white text-[10px]">Не проверено</Badge>
                  )}
                  <Badge variant={tl.status === "active" ? "default" : "secondary"} className="text-[10px]">
                    {tl.status === "active" ? "Активна" : tl.status === "pending" ? "Ожидает" : "Скрыта"}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  👩‍🍳 {getConfectionerName(tl.confectionerId)} • 📍 {tl.city}, {tl.address}
                  {tl.workingHours && ` • 🕐 ${tl.workingHours}`}
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{tl.description}</p>
              </div>
              <div className="flex gap-1">
                {!tl.verified && (
                  <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 h-7" onClick={() => updateLoc(tl.id, { verified: true })}>
                    <Check className="h-3 w-3 mr-1" />Подтвердить
                  </Button>
                )}
                {tl.status !== "active" && (
                  <Button size="sm" variant="outline" className="h-7" onClick={() => updateLoc(tl.id, { status: "active" })}>
                    Активировать
                  </Button>
                )}
                {tl.status === "active" && (
                  <Button size="sm" variant="outline" className="h-7" onClick={() => updateLoc(tl.id, { status: "inactive" })}>
                    Скрыть
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => deleteLoc(tl.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// АДМИН: Управление площадками
// ============================================================
export function AdminVenuesTab() {
  const venues = useAppStore((s) => s.venues);
  const venueServices = useAppStore((s) => s.venueServices);
  const venueVendors = useAppStore((s) => s.venueVendors);
  const [search, setSearch] = useState("");
  const [viewingVenue, setViewingVenue] = useState<any>(null);

  const filtered = venues.filter((v) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      v.businessName.toLowerCase().includes(q) ||
      v.city.toLowerCase().includes(q) ||
      (v.fullAddress || v.address || "").toLowerCase().includes(q)
    );
  });

  const getVendorsCount = (venueId: string) =>
    venueVendors.filter((vv: any) => vv.venueId === venueId && vv.status === "active").length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          Площадки и развлечения
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Управление площадками для праздников и их услугами. Полный адрес, размещённые продавцы, услуги.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3"><Building2 className="h-5 w-5 text-primary mb-1" /><div className="text-2xl font-bold">{venues.length}</div><div className="text-xs text-muted-foreground">Площадок</div></Card>
        <Card className="p-3"><Package className="h-5 w-5 text-blue-500 mb-1" /><div className="text-2xl font-bold">{venueServices.length}</div><div className="text-xs text-muted-foreground">Услуг</div></Card>
        <Card className="p-3"><Store className="h-5 w-5 text-purple-500 mb-1" /><div className="text-2xl font-bold text-purple-600">{venueVendors.length}</div><div className="text-xs text-muted-foreground">Продавцов</div></Card>
        <Card className="p-3"><Check className="h-5 w-5 text-emerald-500 mb-1" /><div className="text-2xl font-bold text-emerald-600">{venues.filter((v) => v.verified).length}</div><div className="text-xs text-muted-foreground">Проверено</div></Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по названию, городу или адресу..." className="pl-9" />
      </div>

      <div className="space-y-2">
        {filtered.map((v) => {
          const vendorsCount = getVendorsCount(v.id);
          return (
            <Card key={v.id} className="p-3 flex flex-wrap items-center gap-3">
              <img src={v.logo} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" loading="lazy" decoding="async" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{v.businessName}</span>
                  <Badge variant="outline" className="text-[10px]">{v.venueTypeLabel}</Badge>
                  {v.verified && <Badge className="bg-emerald-500 text-white text-[10px]"><Check className="h-2.5 w-2.5 mr-0.5" />Проверено</Badge>}
                  {vendorsCount > 0 && (
                    <Badge className="bg-purple-500 text-white text-[10px]">
                      <Store className="h-2.5 w-2.5 mr-0.5" />{vendorsCount} продавц.
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  <MapPin className="h-3 w-3 inline mr-1" />
                  {v.fullAddress || `${v.city}, ${v.address || ""}`}
                  {v.floor && v.floor !== "—" && <span className="ml-1">• {v.floor} эт.</span>}
                  {v.pavilion && v.pavilion !== "—" && <span>• пав. {v.pavilion}</span>}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  🏠 {v.area} м² • 👥 {v.capacity} чел • ⭐ {v.rating} • 📞 {v.phone}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Услуг: {venueServices.filter((vs) => vs.venueId === v.id).length}</div>
                <div className="text-xs text-muted-foreground">Заказов: {v.bookingsCount}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setViewingVenue(v)}>
                <Eye className="h-3.5 w-3.5 mr-1" />Просмотр
              </Button>
            </Card>
          );
        })}
      </div>

      {/* Venue View Modal with image carousel + vendors */}
      {viewingVenue && (
        <VenueViewDialog
          venue={viewingVenue}
          services={venueServices.filter((vs: any) => vs.venueId === viewingVenue.id)}
          vendors={venueVendors.filter((vv: any) => vv.venueId === viewingVenue.id)}
          onClose={() => setViewingVenue(null)}
        />
      )}
    </div>
  );
}

// =================== Venue View Dialog with carousel ===================
function VenueViewDialog({ venue, services, vendors, onClose }: {
  venue: any;
  services: any[];
  vendors: any[];
  onClose: () => void;
}) {
  const [activeImg, setActiveImg] = useState(0);
  const gallery = [venue.coverImage, ...(venue.galleryImages || [])].filter(Boolean);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {venue.businessName}
            <Badge variant="outline" className="text-[10px]">{venue.venueTypeLabel}</Badge>
            {venue.verified && <Badge className="bg-emerald-500 text-white text-[10px]"><Check className="h-2.5 w-2.5 mr-0.5" />Проверено</Badge>}
          </DialogTitle>
          <DialogDescription>
            {venue.rating} ⭐ ({venue.reviewsCount} отзывов) • {venue.bookingsCount} заказов
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Image carousel */}
          {gallery.length > 0 && (
            <div className="space-y-2">
              <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                <img src={gallery[activeImg]} alt="" className="w-full h-full object-cover" />
              </div>
              {gallery.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {gallery.map((img: string, i: number) => (
                    <button
                      key={i}
                      onClick={() => setActiveImg(i)}
                      className={`w-20 h-20 rounded overflow-hidden border-2 shrink-0 ${
                        activeImg === i ? "border-primary" : "border-transparent"
                      }`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Address & placement details */}
          <Card className="p-3">
            <div className="text-xs font-semibold mb-2 flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />Адрес и размещение
            </div>
            <div className="text-sm font-medium">{venue.fullAddress || `${venue.city}, ${venue.address}`}</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs mt-2">
              {venue.country && <div><span className="text-muted-foreground">Страна:</span> {venue.country}</div>}
              {venue.region && <div><span className="text-muted-foreground">Регион:</span> {venue.region}</div>}
              {venue.city && <div><span className="text-muted-foreground">Город:</span> {venue.city}</div>}
              {venue.district && <div><span className="text-muted-foreground">Район:</span> {venue.district}</div>}
              {venue.street && <div><span className="text-muted-foreground">Улица:</span> {venue.street}</div>}
              {venue.building && <div><span className="text-muted-foreground">Дом:</span> {venue.building}</div>}
              {venue.floor && venue.floor !== "—" && <div><span className="text-muted-foreground">Этаж:</span> {venue.floor}</div>}
              {venue.pavilion && venue.pavilion !== "—" && <div><span className="text-muted-foreground">Павильон:</span> {venue.pavilion}</div>}
              {venue.unit && venue.unit !== "—" && <div><span className="text-muted-foreground">Расположение:</span> {venue.unit}</div>}
              {venue.postalCode && <div><span className="text-muted-foreground">Индекс:</span> {venue.postalCode}</div>}
            </div>
            {venue.lat && venue.lng && (
              <a
                href={`https://yandex.ru/maps/?pt=${venue.lng},${venue.lat}&z=16&l=map`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline text-xs mt-2 inline-flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" />Открыть на карте
              </a>
            )}
          </Card>

          {/* Description */}
          {venue.description && (
            <Card className="p-3">
              <div className="text-xs font-semibold mb-1">Описание</div>
              <p className="text-sm text-muted-foreground">{venue.description}</p>
            </Card>
          )}

          {/* Characteristics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Card className="p-2"><div className="text-muted-foreground">Площадь</div><div className="font-medium">{venue.area} м²</div></Card>
            <Card className="p-2"><div className="text-muted-foreground">Вместимость</div><div className="font-medium">{venue.capacity} чел.</div></Card>
            <Card className="p-2"><div className="text-muted-foreground">Мин. заказ</div><div className="font-medium">{formatCurrency(venue.minOrder)}</div></Card>
            <Card className="p-2"><div className="text-muted-foreground">Скидка</div><div className="font-medium">{venue.platformDiscount}%</div></Card>
          </div>

          {/* Working hours + contacts */}
          <div className="grid md:grid-cols-2 gap-3">
            <Card className="p-3">
              <div className="text-xs font-semibold mb-2 flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Режим работы</div>
              <div className="text-sm">
                {venue.workingHours?.days}: {venue.workingHours?.from}–{venue.workingHours?.to}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-xs font-semibold mb-2">Контакты</div>
              <div className="text-xs space-y-1">
                <div className="flex items-center gap-1"><Phone className="h-3 w-3" />{venue.phone}</div>
                <div className="flex items-center gap-1"><Mail className="h-3 w-3" />{venue.email}</div>
                {venue.website && (
                  <a href={venue.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                    <ExternalLink className="h-3 w-3" />{venue.website}
                  </a>
                )}
              </div>
            </Card>
          </div>

          {/* Amenities */}
          {venue.amenities && venue.amenities.length > 0 && (
            <Card className="p-3">
              <div className="text-xs font-semibold mb-2">Удобства</div>
              <div className="flex flex-wrap gap-1">
                {venue.amenities.map((a: string, i: number) => (
                  <Badge key={i} variant="secondary" className="text-[10px]">{a}</Badge>
                ))}
              </div>
            </Card>
          )}

          {/* Placed vendors (кондитеры, кейтеринг и т.д.) */}
          <Card className="p-3">
            <div className="text-xs font-semibold mb-2 flex items-center gap-1">
              <Store className="h-3.5 w-3.5" />Размещённые продавцы ({vendors.length})
            </div>
            {vendors.length === 0 ? (
              <div className="text-xs text-muted-foreground">Продавцы не размещены</div>
            ) : (
              <div className="space-y-2">
                {vendors.map((vv: any) => (
                  <div key={vv.id} className="flex items-start gap-2 p-2 border border-border rounded text-xs">
                    <img
                      src={vv.vendorAvatar}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover shrink-0"
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="font-medium">{vv.vendorName}</span>
                        <Badge variant="outline" className="text-[9px]">{vv.vendorType}</Badge>
                        <Badge
                          variant={vv.status === "active" ? "default" : "secondary"}
                          className={`text-[9px] ${vv.status === "active" ? "bg-emerald-500 text-white" : ""}`}
                        >
                          {vv.status === "active" ? "Активен" : vv.status === "pending" ? "Ожидает" : "Неактивен"}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        <MapPin className="h-2.5 w-2.5 inline mr-0.5" />
                        {vv.placement}
                        {vv.floor && vv.floor !== "—" && ` • этаж ${vv.floor}`}
                        {vv.pavilion && vv.pavilion !== "—" && ` • павильон ${vv.pavilion}`}
                        {vv.unit && vv.unit !== "—" && ` • ${vv.unit}`}
                      </div>
                      <div className="text-muted-foreground text-[10px] mt-0.5">
                        {vv.contractStart && `С ${formatDate(vv.contractStart)}`}
                        {vv.contractEnd && ` по ${formatDate(vv.contractEnd)}`}
                        {vv.commissionPercent != null && ` • комиссия ${vv.commissionPercent}%`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Services */}
          {services.length > 0 && (
            <Card className="p-3">
              <div className="text-xs font-semibold mb-2 flex items-center gap-1">
                <Package className="h-3.5 w-3.5" />Услуги площадки ({services.length})
              </div>
              <div className="space-y-1">
                {services.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between text-xs p-2 border border-border rounded">
                    <div>
                      <div className="font-medium">{s.title}</div>
                      {s.description && <div className="text-muted-foreground line-clamp-1">{s.description}</div>}
                    </div>
                    <div className="font-semibold text-primary shrink-0 ml-2">{formatCurrency(s.price)}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// АДМИН: Управление услугами печати
// ============================================================
export function AdminPrintingServicesTab() {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("all");
  const [viewingService, setViewingService] = useState<any>(null);
  const services = useAppStore((s) => s.serviceProducts || []);

  // Фильтр только по печати
  const printServices = (services as any[]).filter((sp) => sp.category?.startsWith("print_"));
  const filtered = printServices.filter((sp) => {
    if (filterCat !== "all" && sp.category !== filterCat) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      sp.title?.toLowerCase().includes(q) ||
      sp.shopName?.toLowerCase().includes(q) ||
      sp.description?.toLowerCase().includes(q)
    );
  });

  const PRINT_CATEGORIES = [
    { value: "print_gingerbread", label: "На пряниках" },
    { value: "print_sugar_paper", label: "На сахарной бумаге" },
    { value: "print_rice_paper", label: "На рисовой бумаге" },
    { value: "print_wafer_paper", label: "На вафельной бумаге" },
    { value: "print_chocolate", label: "На шоколаде" },
    { value: "print_icing_sheet", label: "На глазурной бумаге" },
    { value: "print_custom_cookie", label: "Кастомное печенье" },
    { value: "print_edible_stickers", label: "Съедобные стикеры" },
    { value: "print_design", label: "Дизайн-печать" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Tags className="h-5 w-5 text-primary" />
          Печать на пряниках и бумаге
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Управление услугами пищевой печати от кондитеров. Описания, локации, варианты цен.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Услуг печати</div><div className="text-2xl font-bold">{printServices.length}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Активных</div><div className="text-2xl font-bold text-emerald-600">{printServices.filter((s) => s.available).length}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Популярных</div><div className="text-2xl font-bold text-amber-600">{printServices.filter((s) => s.isPopular).length}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Кондитеров</div><div className="text-2xl font-bold">{new Set(printServices.map((s) => s.shopId)).size}</div></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по названию, кондитеру, описанию..." className="pl-9" />
        </div>
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">Все категории печати</option>
          {PRINT_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Услуги печати не найдены. Добавьте их через кабинет кондитера.
          </Card>
        ) : (
          filtered.map((sp) => {
            const catLabel = PRINT_CATEGORIES.find((c) => c.value === sp.category)?.label || sp.category;
            return (
              <Card key={sp.id} className="p-3">
                <div className="flex flex-wrap items-start gap-3">
                  <img
                    src={sp.images?.[0]}
                    alt=""
                    className="w-16 h-16 rounded-lg object-cover shrink-0"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm line-clamp-1">{sp.title}</span>
                      <Badge variant="outline" className="text-[10px]">{catLabel}</Badge>
                      {sp.isPopular && <Badge className="bg-amber-500 text-white text-[10px]"><Star className="h-2.5 w-2.5 mr-0.5 fill-white" />Хит</Badge>}
                      <Badge variant={sp.available ? "default" : "secondary"} className="text-[10px]">
                        {sp.available ? "Активна" : "Скрыта"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      <Store className="h-3 w-3 inline mr-1" />{sp.shopName} • ⭐ {sp.rating} ({sp.reviewsCount || 0})
                    </div>
                    {sp.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{sp.description}</p>
                    )}
                    {/* Locations */}
                    {sp.locations && sp.locations.length > 0 && (
                      <div className="text-[10px] text-muted-foreground mt-1">
                        <MapPin className="h-2.5 w-2.5 inline mr-0.5" />
                        Локации: {sp.locations.join(" • ")}
                      </div>
                    )}
                    {/* Price offers */}
                    {sp.priceOffers && sp.priceOffers.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {sp.priceOffers.slice(0, 4).map((po: any, i: number) => (
                          <Badge key={i} variant="secondary" className="text-[9px]">
                            {po.name}: <span className="font-bold ml-0.5">{formatCurrency(po.price)}</span>
                            {po.unit && <span className="ml-0.5">/{po.unit}</span>}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs font-bold text-primary mt-1">{formatCurrency(sp.price)}</div>
                    )}
                    {sp.productionTime && (
                      <div className="text-[10px] text-muted-foreground mt-1">
                        <Clock className="h-2.5 w-2.5 inline mr-0.5" />Срок: {sp.productionTime}
                      </div>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setViewingService(sp)}>
                    <Eye className="h-3.5 w-3.5 mr-1" />Просмотр
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* View Service Modal */}
      {viewingService && (
        <PrintingServiceViewDialog
          service={viewingService}
          onClose={() => setViewingService(null)}
        />
      )}
    </div>
  );
}

// =================== Printing Service View Dialog ===================
function PrintingServiceViewDialog({ service, onClose }: {
  service: any;
  onClose: () => void;
}) {
  const [activeImg, setActiveImg] = useState(0);
  const gallery = service.images || [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {service.title}
            {service.isPopular && <Badge className="bg-amber-500 text-white text-[10px]"><Star className="h-2.5 w-2.5 mr-0.5 fill-white" />Хит</Badge>}
            <Badge variant={service.available ? "default" : "secondary"} className="text-[10px]">
              {service.available ? "Активна" : "Скрыта"}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            <Store className="h-3 w-3 inline mr-1" />{service.shopName} • ⭐ {service.rating} ({service.reviewsCount || 0} отзывов)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Image carousel */}
          {gallery.length > 0 && (
            <div className="space-y-2">
              <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                <img src={gallery[activeImg]} alt="" className="w-full h-full object-cover" />
              </div>
              {gallery.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {gallery.map((img: string, i: number) => (
                    <button
                      key={i}
                      onClick={() => setActiveImg(i)}
                      className={`w-20 h-20 rounded overflow-hidden border-2 shrink-0 ${
                        activeImg === i ? "border-primary" : "border-transparent"
                      }`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Description */}
          {service.description && (
            <Card className="p-3">
              <div className="text-xs font-semibold mb-1">Описание услуги</div>
              <p className="text-sm text-muted-foreground">{service.description}</p>
            </Card>
          )}

          {/* Locations */}
          {service.locations && service.locations.length > 0 && (
            <Card className="p-3">
              <div className="text-xs font-semibold mb-2 flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />Локации оказания услуги
              </div>
              <div className="space-y-1">
                {service.locations.map((loc: string, i: number) => (
                  <div key={i} className="text-xs flex items-start gap-1">
                    <MapPin className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                    {loc}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Price offers */}
          <Card className="p-3">
            <div className="text-xs font-semibold mb-2 flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5" />Варианты цен
            </div>
            {service.priceOffers && service.priceOffers.length > 0 ? (
              <div className="space-y-2">
                {service.priceOffers.map((po: any, i: number) => (
                  <div key={i} className="flex items-start justify-between p-2 border border-border rounded text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{po.name}</div>
                      {po.description && <div className="text-xs text-muted-foreground">{po.description}</div>}
                    </div>
                    <div className="font-bold text-primary shrink-0 ml-2">
                      {formatCurrency(po.price)}
                      {po.unit && <span className="text-xs text-muted-foreground ml-0.5">/{po.unit}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-lg font-bold text-primary">{formatCurrency(service.price)}</div>
            )}
          </Card>

          {/* Production details */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            {service.productionTime && (
              <Card className="p-2"><div className="text-muted-foreground">Срок изготовления</div><div className="font-medium">{service.productionTime}</div></Card>
            )}
            {service.priceUnit && (
              <Card className="p-2"><div className="text-muted-foreground">Ед. измерения</div><div className="font-medium">{service.priceUnit}</div></Card>
            )}
            {service.customizable && (
              <Card className="p-2"><div className="text-muted-foreground">Кастомизация</div><div className="font-medium">Доступна</div></Card>
            )}
          </div>

          {/* Suitable for */}
          {service.suitableFor && service.suitableFor.length > 0 && (
            <Card className="p-3">
              <div className="text-xs font-semibold mb-2">Подходит для поводов</div>
              <div className="flex flex-wrap gap-1">
                {service.suitableFor.map((s: string, i: number) => (
                  <Badge key={i} variant="secondary" className="text-[10px]">{s}</Badge>
                ))}
              </div>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// АДМИН: SEO и мета-теги
// ============================================================
export function AdminSeoTab() {
  const [pages, setPages] = useState([
    { id: "home", path: "/", title: "Уездный кондитер — маркетплейс кондитеров России", description: "Закажите авторские торты, десерты и сладости напрямую у частных кондитеров. 5000+ проверенных мастеров.", keywords: "торты на заказ, кондитеры, маркетплейс", indexed: true },
    { id: "catalog", path: "/catalog", title: "Каталог тортов и десертов — Уездный кондитер", description: "Каталог кондитерских изделий от домашних кондитеров. Торты, капкейки, макаронс, чизкейки.", keywords: "каталог тортов, десерты, купить торт", indexed: true },
    { id: "confectioners", path: "/confectioners", title: "Кондитеры России — Уездный кондитер", description: "Найдите проверенного кондитера в вашем городе. Рейтинги, отзывы, портфолио работ.", keywords: "кондитеры, найти кондитера", indexed: true },
    { id: "constructor", path: "/cake-builder", title: "Конструктор тортов — Уездный кондитер", description: "Соберите свой идеальный торт за 8 шагов: основа, начинка, покрытие, декор.", keywords: "конструктор торта, собрать торт", indexed: true },
    { id: "services", path: "/services-shop", title: "Услуги и площадки для праздников — Уездный кондитер", description: "Батутные парки, картинг, лофты, аниматоры, фейерверки для вашего праздника.", keywords: "площадки для праздников, аниматоры", indexed: true },
    { id: "printing", path: "/services-shop?cat=print", title: "Печать на пряниках и съедобной бумаге — Уездный кондитер", description: "Сахарная печать на тортах, пряниках, печенье. Любое фото на съедобной бумаге.", keywords: "сахарная печать, печать на пряниках", indexed: true },
  ]);

  const [editingId, setEditingId] = useState<string | null>(null);

  const handleSave = (id: string) => {
    setEditingId(null);
    // toast.success("SEO обновлено");
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          SEO и мета-теги
        </h2>
        <p className="text-sm text-muted-foreground mt-1">Управление мета-тегами для поисковых систем</p>
      </div>

      <Card className="p-3 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900">
        <div className="flex items-center gap-2 text-sm">
          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
          <span>robots.txt и sitemap.xml генерируются автоматически. Настройте мета-теги для каждой страницы.</span>
        </div>
      </Card>

      <div className="space-y-3">
        {pages.map((p) => (
          <Card key={p.id} className="p-4">
            {editingId === p.id ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{p.path}</Badge>
                  <Button size="sm" onClick={() => handleSave(p.id)}><Check className="h-3.5 w-3.5 mr-1" />Сохранить</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Отмена</Button>
                </div>
                <div>
                  <Label>Title (заголовок страницы)</Label>
                  <Input
                    defaultValue={p.title}
                    onChange={(e) => setPages(pages.map((pp) => pp.id === p.id ? { ...pp, title: e.target.value } : pp))}
                    className="mt-1"
                  />
                  <div className="text-[10px] text-muted-foreground mt-1">{p.title.length}/60 символов (рекомендуется 50-60)</div>
                </div>
                <div>
                  <Label>Description (описание)</Label>
                  <Textarea
                    defaultValue={p.description}
                    onChange={(e) => setPages(pages.map((pp) => pp.id === p.id ? { ...pp, description: e.target.value } : pp))}
                    rows={2}
                    className="mt-1"
                  />
                  <div className="text-[10px] text-muted-foreground mt-1">{p.description.length}/160 символов (рекомендуется 140-160)</div>
                </div>
                <div>
                  <Label>Keywords (ключевые слова)</Label>
                  <Input
                    defaultValue={p.keywords}
                    onChange={(e) => setPages(pages.map((pp) => pp.id === p.id ? { ...pp, keywords: e.target.value } : pp))}
                    className="mt-1"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={p.indexed}
                    onChange={(e) => setPages(pages.map((pp) => pp.id === p.id ? { ...pp, indexed: e.target.checked } : pp))}
                    className="w-4 h-4 accent-primary"
                  />
                  Индексировать поисковиками
                </label>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <Globe className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge variant="outline">{p.path}</Badge>
                    {p.indexed ? (
                      <Badge className="bg-emerald-500 text-white text-[10px]">Индексируется</Badge>
                    ) : (
                      <Badge className="bg-rose-500 text-white text-[10px]">noindex</Badge>
                    )}
                  </div>
                  <div className="font-medium text-sm line-clamp-1">{p.title}</div>
                  <div className="text-xs text-muted-foreground line-clamp-1">{p.description}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setEditingId(p.id)}>
                  <Edit className="h-3.5 w-3.5 mr-1" />Изменить
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">robots.txt</h3>
        <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto">
{`User-agent: *
Allow: /
Disallow: /api/
Disallow: /dashboard
Disallow: /checkout

Sitemap: https://conditera.ru/sitemap.xml`}
        </pre>
      </Card>
    </div>
  );
}

// ============================================================
// АДМИН: Управление отзывами на tasting locations
// ============================================================
export function AdminTastingReviewsTab() {
  const locations = useAppStore((s) => s.tastingLocations);
  const confectioners = useAppStore((s) => s.confectioners);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Star className="h-5 w-5 text-primary" />
          Отзывы о точках дегустации
        </h2>
        <p className="text-sm text-muted-foreground mt-1">Отзывы покупателей о заведениях</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {locations.filter((l) => l.status === "active").map((loc) => {
          const conf = confectioners.find((c) => c.id === loc.confectionerId);
          return (
            <Card key={loc.id} className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Utensils className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm line-clamp-1">{loc.establishmentName}</span>
              </div>
              <div className="text-xs text-muted-foreground mb-2">
                {conf?.businessName} • {loc.city}
              </div>
              <div className="flex items-center gap-1 mb-1">
                {[1,2,3,4,5].map((s) => (
                  <Star key={s} className="h-3 w-3 text-amber-400 fill-amber-400" />
                ))}
                <span className="text-xs ml-1">5.0 (нет отзывов)</span>
              </div>
              <Button size="sm" variant="outline" className="w-full text-xs">Просмотреть отзывы</Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// АДМИН: Карта точек дегустации
// ============================================================
export function AdminTastingMapTab() {
  const locations = useAppStore((s) => s.tastingLocations);
  const cities = Array.from(new Set(locations.map((l) => l.city)));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          Карта точек дегустации
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          География точек, где можно попробовать продукцию кондитеров
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3"><MapPin className="h-5 w-5 text-primary mb-1" /><div className="text-2xl font-bold">{locations.length}</div><div className="text-xs text-muted-foreground">Точек всего</div></Card>
        <Card className="p-3"><Building2 className="h-5 w-5 text-blue-500 mb-1" /><div className="text-2xl font-bold">{cities.length}</div><div className="text-xs text-muted-foreground">Городов</div></Card>
        <Card className="p-3"><Utensils className="h-5 w-5 text-purple-500 mb-1" /><div className="text-2xl font-bold">{new Set(locations.map((l) => l.type)).size}</div><div className="text-xs text-muted-foreground">Типов заведений</div></Card>
        <Card className="p-3"><Check className="h-5 w-5 text-emerald-500 mb-1" /><div className="text-2xl font-bold text-emerald-600">{locations.filter((l) => l.verified).length}</div><div className="text-xs text-muted-foreground">Проверено</div></Card>
      </div>

      {/* По городам */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Распределение по городам</h3>
        <div className="space-y-2">
          {cities.map((city) => {
            const count = locations.filter((l) => l.city === city).length;
            const percent = (count / locations.length) * 100;
            return (
              <div key={city}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{city}</span>
                  <span className="font-medium">{count} точек</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-primary to-accent" style={{ width: `${percent}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Список с координатами */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Точки с координатами</h3>
        <div className="space-y-2">
          {locations.filter((l) => l.lat && l.lng).map((l) => (
            <div key={l.id} className="flex items-center gap-3 p-2 border border-border rounded-lg text-sm">
              <Navigation className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-medium">{l.establishmentName}</span>
                <span className="text-xs text-muted-foreground ml-2">{l.city}, {l.address}</span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">{l.lat?.toFixed(4)}, {l.lng?.toFixed(4)}</span>
              <a
                href={`https://yandex.ru/maps/?pt=${l.lng},${l.lat}&z=16&l=map`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline text-xs flex items-center gap-0.5"
              >
                Карта <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
