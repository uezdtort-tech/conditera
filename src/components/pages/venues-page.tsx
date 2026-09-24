"use client";

/**
 * VenuesPage — публичный раздел площадок (/venues) на live-данных.
 *
 * Источник: GET /api/venues (таблица venues, миграция 0019/0029).
 * Dual-mode: если БД пуста/недоступна — показываются mock-площадки из store.
 * Фильтры: поиск, город, минимальная вместимость, сортировка.
 * Карточка → диалог с деталями, удобствами, правилами и контактами.
 */

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MarketplaceCtaCard } from "@/components/marketplace/marketplace-cta-card";
import { toast } from "sonner";
import {
  Search,
  Star,
  MapPin,
  Users,
  Clock,
  ShieldCheck,
  ChevronLeft,
  Building2,
  Phone,
  Check,
} from "lucide-react";

interface VenueListing {
  id: string;
  owner_id: string;
  name: string;
  address: string;
  city: string | null;
  region: string | null;
  capacity: number;
  price_per_hour: number;
  min_rent_hours: number | null;
  description: string | null;
  images: string[] | null;
  amenities: string[] | null;
  contacts: { phone?: string; email?: string; telegram?: string } | Record<string, unknown> | null;
  rules: string | null;
  is_verified: boolean;
  rating: number | null;
  reviews_count: number | null;
  bookings_count: number | null;
  created_at: string;
}

/** Человекочитаемые лейблы удобств. */
const AMENITY_LABELS: Record<string, string> = {
  wifi: "Wi-Fi",
  parking: "Парковка",
  kitchen: "Кухня",
  sound: "Звук",
  projector: "Проектор",
  stage: "Сцена",
  wardrobe: "Гардероб",
  soft_play: "Мягкая зона",
  ball_pit: "Сухой бассейн",
  air_conditioner: "Кондиционер",
  bbq: "Мангальная зона",
  outdoor: "Открытая площадка",
  pond: "Водоём",
};

function amenityLabel(a: string): string {
  return AMENITY_LABELS[a] || a;
}

/** Цена в БД — копейки за час. */
function formatPrice(kop: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(kop / 100)) + " ₽";
}

function asContacts(c: VenueListing["contacts"]): { phone?: string } {
  if (!c || typeof c !== "object") return {};
  return c as { phone?: string };
}

export function VenuesPage() {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);

  const [liveVenues, setLiveVenues] = useState<VenueListing[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [city, setCity] = useState<string>("all");
  const [minCapacity, setMinCapacity] = useState<string>("any");
  const [sortBy, setSortBy] = useState("popular");
  const [selected, setSelected] = useState<VenueListing | null>(null);

  // Загрузка live-данных (публичный API)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/venues?limit=60");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { venues?: VenueListing[] };
        if (!cancelled && json.venues && json.venues.length > 0) {
          setLiveVenues(json.venues);
        }
      } catch {
        // dual-mode: оставляем mock-данные из store
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fallback на mock-площадки (store) при пустой БД
  const fallbackVenues = useAppStore((s) => s.venues);
  const isLive = liveVenues.length > 0;

  const venues: VenueListing[] = useMemo(() => {
    if (isLive) return liveVenues;
    // Приводим mock Venue к VenueListing
    return fallbackVenues.map((v) => ({
      id: v.id,
      owner_id: v.ownerId,
      name: v.businessName,
      address: v.fullAddress || [v.city, v.street, v.building].filter(Boolean).join(", "),
      city: v.city,
      region: v.region,
      capacity: v.capacity,
      price_per_hour: (v.minOrder || 1000) * 100,
      min_rent_hours: 1,
      description: v.description,
      images: [v.coverImage || v.logo].filter(Boolean),
      amenities: v.amenities,
      contacts: {},
      rules: null,
      is_verified: v.verified,
      rating: v.rating,
      reviews_count: v.reviewsCount,
      bookings_count: v.bookingsCount,
      created_at: v.createdAt,
    }));
  }, [isLive, liveVenues, fallbackVenues]);

  const cities = useMemo(() => {
    const set = new Set<string>();
    venues.forEach((v) => {
      const c = v.city || v.address?.split(",")[0]?.trim();
      if (c) set.add(c);
    });
    return [...set].sort();
  }, [venues]);

  const filtered = useMemo(() => {
    let result = venues.filter((v) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !v.name.toLowerCase().includes(q) &&
          !(v.description || "").toLowerCase().includes(q) &&
          !v.address.toLowerCase().includes(q)
        )
          return false;
      }
      if (city !== "all") {
        const vCity = v.city || v.address?.split(",")[0]?.trim() || "";
        if (vCity.toLowerCase() !== city.toLowerCase()) return false;
      }
      if (minCapacity !== "any") {
        const cap = parseInt(minCapacity, 10);
        if (!isNaN(cap) && v.capacity < cap) return false;
      }
      return true;
    });
    switch (sortBy) {
      case "price-asc":
        result.sort((a, b) => a.price_per_hour - b.price_per_hour);
        break;
      case "price-desc":
        result.sort((a, b) => b.price_per_hour - a.price_per_hour);
        break;
      case "capacity":
        result.sort((a, b) => b.capacity - a.capacity);
        break;
      case "popular":
      default:
        result.sort(
          (a, b) =>
            (b.bookings_count ?? 0) - (a.bookings_count ?? 0) ||
            (b.rating ?? 0) - (a.rating ?? 0)
        );
    }
    return result;
  }, [venues, search, city, minCapacity, sortBy]);

  const handleBookingRequest = (v: VenueListing) => {
    const phone = asContacts(v.contacts).phone;
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    toast.success("Заявка на бронирование отправлена", {
      description: phone
        ? `«${v.name}» ответит вам в ближайшее время. Телефон площадки: ${phone}`
        : `«${v.name}» ответит вам в ближайшее время.`,
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

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
            <Building2 className="h-3 w-3 mr-1" />
            Площадки
          </Badge>
          {loaded && isLive && (
            <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1 inline-block" />
              Supabase (live)
            </Badge>
          )}
        </div>
        <h1 className="font-display text-2xl lg:text-3xl font-bold mb-2">
          Площадки для праздников
        </h1>
        <p className="text-muted-foreground">
          Лофты, банкетные залы, детские студии и веранды для дня рождения, выпускного и
          корпоратива. Бронируйте вместе с аниматорами и тортом — всё в одном месте.
        </p>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию, адресу..."
            className="pl-10"
          />
        </div>
        <Select value={city} onValueChange={setCity}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Город" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все города</SelectItem>
            {cities.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={minCapacity} onValueChange={setMinCapacity}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Вместимость" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Любая вместимость</SelectItem>
            <SelectItem value="20">от 20 гостей</SelectItem>
            <SelectItem value="40">от 40 гостей</SelectItem>
            <SelectItem value="60">от 60 гостей</SelectItem>
            <SelectItem value="100">от 100 гостей</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Сортировка" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">Популярные</SelectItem>
            <SelectItem value="price-asc">Сначала дешевле</SelectItem>
            <SelectItem value="price-desc">Сначала дороже</SelectItem>
            <SelectItem value="capacity">По вместимости</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Найдено площадок: {filtered.length}
      </p>

      {/* Venue cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((v) => {
          const image = v.images?.[0] || "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=800";
          return (
            <Card
              key={v.id}
              className="overflow-hidden p-0 hover:shadow-lg transition-shadow cursor-pointer flex flex-col"
              onClick={() => setSelected(v)}
            >
              <div className="relative aspect-video bg-muted overflow-hidden">
                <img
                  src={image}
                  alt={v.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute top-2 left-2 flex gap-1">
                  {v.is_verified && (
                    <Badge className="bg-emerald-500 text-white text-[10px]">
                      <ShieldCheck className="h-2.5 w-2.5 mr-0.5" />
                      Проверена
                    </Badge>
                  )}
                </div>
                <div className="absolute bottom-2 left-3 right-3">
                  <h3 className="font-display font-bold text-white text-sm line-clamp-1 drop-shadow">
                    {v.name}
                  </h3>
                </div>
              </div>

              <div className="p-3 flex-1 flex flex-col">
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{v.city || v.address}</span>
                </div>

                {v.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{v.description}</p>
                )}

                <div className="flex flex-wrap gap-1 mb-2">
                  <Badge variant="secondary" className="text-[10px]">
                    <Users className="h-2.5 w-2.5 mr-0.5" />
                    до {v.capacity}
                  </Badge>
                  {v.min_rent_hours && v.min_rent_hours > 1 && (
                    <Badge variant="secondary" className="text-[10px]">
                      <Clock className="h-2.5 w-2.5 mr-0.5" />
                      от {v.min_rent_hours} ч
                    </Badge>
                  )}
                  {(v.amenities || []).slice(0, 2).map((a) => (
                    <Badge key={a} variant="secondary" className="text-[10px]">
                      {amenityLabel(a)}
                    </Badge>
                  ))}
                </div>

                <div className="mt-auto flex items-end justify-between">
                  <div>
                    <div className="font-display font-bold text-base">
                      {formatPrice(v.price_per_hour)}
                      <span className="text-[10px] font-normal text-muted-foreground"> / час</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                      {v.rating ?? 0} ({v.reviews_count ?? 0})
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(v);
                    }}
                  >
                    Подробнее
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && loaded && (
        <Card className="p-12 text-center">
          <Building2 className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-1">Площадки не найдены</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Измените параметры поиска или сбросьте фильтры.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setSearch("");
              setCity("all");
              setMinCapacity("any");
            }}
          >
            Сбросить фильтры
          </Button>
        </Card>
      )}

      {/* CTA: зазывала для владельцев площадок */}
      <MarketplaceCtaCard
        badge="Для владельцев площадок"
        title="Сдайте площадку под праздник"
        description="Разместите лофт, банкетный зал, детскую студию или веранду: фото, вместимость, прайс и удобства. Покупатели тортов находят площадку и бронируют дату прямо на платформе."
        primaryLabel="Присоединиться и разместить площадку"
        secondaryLabel="Условия для партнёров"
        secondaryView="for-suppliers"
        className="from-emerald-50 via-accent/30 to-teal-100 border-emerald-200"
      />

      {/* Venue details dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <div className="relative aspect-video rounded-lg overflow-hidden mb-4 bg-muted">
                <img
                  src={selected.images?.[0] || ""}
                  alt={selected.name}
                  className="w-full h-full object-cover"
                />
                {selected.is_verified && (
                  <Badge className="absolute top-3 left-3 bg-emerald-500 text-white">
                    <ShieldCheck className="h-3 w-3 mr-1" />
                    Проверенная площадка
                  </Badge>
                )}
              </div>

              <DialogHeader>
                <DialogTitle className="font-display text-xl">{selected.name}</DialogTitle>
                <DialogDescription className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {selected.address}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-3 gap-2 my-3 text-center">
                <div className="rounded-lg border p-2">
                  <div className="font-bold text-sm">{formatPrice(selected.price_per_hour)}</div>
                  <div className="text-[10px] text-muted-foreground">за час</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="font-bold text-sm">до {selected.capacity}</div>
                  <div className="text-[10px] text-muted-foreground">гостей</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="font-bold text-sm flex items-center justify-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    {selected.rating ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {selected.reviews_count ?? 0} отзывов
                  </div>
                </div>
              </div>

              {selected.description && (
                <p className="text-sm text-muted-foreground mb-3">{selected.description}</p>
              )}

              {(selected.amenities?.length ?? 0) > 0 && (
                <div className="mb-3">
                  <h4 className="text-sm font-semibold mb-1.5">Удобства</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.amenities!.map((a) => (
                      <Badge key={a} variant="secondary" className="text-[11px]">
                        <Check className="h-2.5 w-2.5 mr-0.5 text-emerald-600" />
                        {amenityLabel(a)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {selected.rules && (
                <div className="mb-3 p-3 rounded-lg bg-muted text-sm">
                  <h4 className="font-semibold mb-1">Правила площадки</h4>
                  <p className="text-muted-foreground">{selected.rules}</p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2 mt-2">
                <Button className="flex-1" onClick={() => handleBookingRequest(selected)}>
                  {user ? "Запросить бронирование" : "Войти и забронировать"}
                </Button>
                {asContacts(selected.contacts).phone && (
                  <Button variant="outline" asChild>
                    <a href={`tel:${asContacts(selected.contacts).phone}`}>
                      <Phone className="h-4 w-4 mr-1" />
                      {asContacts(selected.contacts).phone}
                    </a>
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
