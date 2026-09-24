"use client";

import { useAppStore } from "@/lib/store";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Search,
  MapPin,
  TrendingUp,
  Tag,
  Truck,
  Gift,
  Package,
  Calendar,
  Star,
  Clock,
  UserPlus,
  PartyPopper,
  Sparkles,
  Flame,
  Copy,
  Check,
  ChevronLeft,
} from "lucide-react";
import { PROMOTION_TYPE_INFO } from "@/lib/mock-data-extra";
import { formatCurrency, formatDate } from "@/lib/finance";
import type { PromotionType } from "@/lib/types";
import { toast } from "sonner";

const ICON_MAP: Record<string, typeof Tag> = {
  percent: Tag,
  tag: Tag,
  truck: Truck,
  gift: Gift,
  package: Package,
  calendar: Calendar,
  star: Star,
  clock: Clock,
  "user-plus": UserPlus,
  "party-popper": PartyPopper,
};

export function PromotionsPage() {
  const navigate = useAppStore((s) => s.navigate);
  const promotions = useAppStore((s) => s.promotions);
  const userCity = useAppStore((s) => s.userCity);
  const userLocation = useAppStore((s) => s.userLocation);
  const addToCart = useAppStore((s) => s.addToCart);
  const products = useAppStore((s) => s.products);

  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [onlyActive, setOnlyActive] = useState(true);
  const [sortBy, setSortBy] = useState("newest");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const cities = Array.from(
    new Set(promotions.flatMap((p) => p.cities || []))
  );

  const filtered = useMemo(() => {
    let result = promotions.filter((p) => {
      if (onlyActive && p.status !== "active") return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !p.title.toLowerCase().includes(q) &&
          !p.description.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      if (cityFilter !== "all") {
        if (!p.cities?.includes(cityFilter)) return false;
      } else if (userCity) {
        // По умолчанию показываем акции в городе пользователя или общие
        const inCity = p.cities?.includes(userCity);
        const inRegion = p.regions?.some((r) =>
          userLocation?.region?.includes(r) || r.includes(userCity)
        );
        if (!inCity && !inRegion) return false;
      }
      if (typeFilter !== "all" && p.type !== typeFilter) return false;
      return true;
    });

    switch (sortBy) {
      case "ending_soon":
        result.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
        break;
      case "popular":
        result.sort((a, b) => b.views - a.views);
        break;
      case "promoted":
        result.sort((a, b) => Number(b.isPromoted) - Number(a.isPromoted));
        break;
      case "newest":
      default:
        result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    return result;
  }, [promotions, onlyActive, search, cityFilter, typeFilter, sortBy, userCity, userLocation]);

  const handleCopyCode = (code: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success("Промокод скопирован", { description: code });
    setTimeout(() => setCopiedCode(null), 2000);
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
        <Badge className="mb-2 bg-rose-100 text-rose-800 border-rose-200">
          <Flame className="h-3 w-3 mr-1" />
          Акции и спецпредложения
        </Badge>
        <h1 className="font-display text-2xl lg:text-3xl font-bold mb-2">
          Акции кондитеров
          {userCity && <span className="text-primary"> в {userCity}</span>}
        </h1>
        <p className="text-muted-foreground">
          {filtered.length} активных акций от проверенных кондитеров.
          Используйте промокоды при оформлении заказа.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск акций..."
            className="pl-10"
          />
        </div>
        <Select value={cityFilter} onValueChange={setCityFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <MapPin className="h-3.5 w-3.5 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{userCity ? `Возле меня (${userCity})` : "Все города"}</SelectItem>
            {cities.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Тип" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            {Object.entries(PROMOTION_TYPE_INFO).map(([key, info]) => (
              <SelectItem key={key} value={key}>
                {info.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Сортировка" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Сначала новые</SelectItem>
            <SelectItem value="ending_soon">Скоро закончатся</SelectItem>
            <SelectItem value="popular">Популярные</SelectItem>
            <SelectItem value="promoted">Продвигаемые</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer mb-6">
        <Checkbox checked={onlyActive} onCheckedChange={(v) => setOnlyActive(!!v)} />
        Показывать только активные акции
      </label>

      {/* Promotions grid */}
      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Search className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-1">Акции не найдены</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Попробуйте изменить фильтры или город
          </p>
          <Button
            onClick={() => {
              setSearch("");
              setCityFilter("all");
              setTypeFilter("all");
              setOnlyActive(true);
            }}
          >
            Сбросить фильтры
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((promo) => {
            const typeInfo = PROMOTION_TYPE_INFO[promo.type];
            const Icon = ICON_MAP[typeInfo.icon] || Tag;
            const confectioner = useAppStore.getState().confectioners.find(
              (c) => c.id === promo.confectionerId
            );
            const daysLeft = Math.ceil(
              (new Date(promo.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            );
            return (
              <Card
                key={promo.id}
                className="overflow-hidden p-0 hover:shadow-lg transition-shadow cursor-pointer group"
                onClick={() => navigate("confectioner-profile", { id: promo.confectionerId })}
              >
                {/* Image with promoted badge */}
                <div className="relative aspect-video bg-muted overflow-hidden">
                  {promo.image && (
                    <img
                      src={promo.image}
                      alt={promo.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" decoding="async" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  {/* Type badge */}
                  <Badge className={`absolute top-2 left-2 ${typeInfo.color}`}>
                    <Icon className="h-3 w-3 mr-1" />
                    {typeInfo.label}
                  </Badge>
                  {/* Promoted badge */}
                  {promo.isPromoted && (
                    <Badge className="absolute top-2 right-2 bg-amber-500 text-white">
                      <Sparkles className="h-3 w-3 mr-1" />
                      Реклама
                    </Badge>
                  )}
                  {/* Title on image */}
                  <div className="absolute bottom-2 left-3 right-3">
                    <h3 className="font-display font-bold text-white text-base line-clamp-2 drop-shadow">
                      {promo.title}
                    </h3>
                  </div>
                </div>

                {/* Content */}
                <div className="p-3 space-y-2">
                  {/* Confectioner */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={promo.confectionerAvatar} alt={promo.confectionerName} />
                      <AvatarFallback className="text-[9px]">
                        {promo.confectionerName.slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{promo.confectionerName}</span>
                    <span>•</span>
                    <MapPin className="h-3 w-3" />
                    <span className="truncate">{promo.cities?.[0] || "Россия"}</span>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {promo.description}
                  </p>

                  {/* Value */}
                  {promo.value && (
                    <div className="flex items-center gap-2">
                      <div className="font-display font-bold text-2xl text-primary">
                        {promo.type === "discount_percent" || promo.type === "early_booking" || promo.type === "holiday" || promo.type === "happy_hours" || promo.type === "first_order"
                          ? `-${promo.value}%`
                          : promo.type === "discount_fixed"
                          ? `-${formatCurrency(promo.value)}`
                          : `×${promo.value}`}
                      </div>
                      {promo.minOrderAmount && (
                        <div className="text-[10px] text-muted-foreground">
                          от {formatCurrency(promo.minOrderAmount)}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Promo code */}
                  {promo.promoCode && (
                    <button
                      onClick={(e) => handleCopyCode(promo.promoCode!, e)}
                      className="w-full flex items-center justify-between p-2 border border-dashed border-primary/40 rounded-md bg-primary/5 hover:bg-primary/10 transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <Tag className="h-3.5 w-3.5 text-primary" />
                        <span className="font-mono font-bold text-sm text-primary">
                          {promo.promoCode}
                        </span>
                      </div>
                      {copiedCode === promo.promoCode ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-2 border-t text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      до {formatDate(promo.endDate)}
                    </span>
                    {daysLeft >= 0 && daysLeft <= 7 && (
                      <Badge className="bg-amber-100 text-amber-800 text-[10px]">
                        Осталось {daysLeft} дн.
                      </Badge>
                    )}
                    {daysLeft < 0 && (
                      <Badge className="bg-red-100 text-red-800 text-[10px]">
                        Истекла
                      </Badge>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>{promo.views} просмотров</span>
                    <span>{promo.usedCount} использовали</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Info card */}
      <Card className="mt-8 p-6 bg-gradient-to-br from-primary/5 to-accent/30">
        <h3 className="font-display font-semibold mb-2 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Хотите продвигать свою акцию?
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          Платное продвижение показывает вашу акцию во всплывающем окне у
          пользователей из выбранных регионов. Стоимость от 500 ₽ за 1000 показов.
        </p>
        <Button onClick={() => navigate("dashboard-confectioner", { tab: "promotions" })}>
          Создать акцию
        </Button>
      </Card>
    </div>
  );
}
