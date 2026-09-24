"use client";

import { useAppStore } from "@/lib/store";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfectionerCard } from "@/components/marketplace/confectioner-card";
import { ConfectionersMap } from "@/components/marketplace/confectioners-map";
import {
  Search,
  MapPin,
  Star,
  Navigation,
  Filter,
  Users,
  LayoutGrid,
  Map as MapIcon,
  Truck,
  ShieldCheck,
  Award,
  Building2,
  User as UserIcon,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import {
  confectionerServesCity,
  confectionerDeliversToCoords,
  calculateDistance,
  LEGAL_STATUS_INFO,
  TRUST_LEVELS,
  TARIFFS,
} from "@/lib/finance";
import type { LegalStatus } from "@/lib/types";

export function ConfectionersPage() {
  const confectioners = useAppStore((s) => s.confectioners);
  const userCity = useAppStore((s) => s.userCity);
  const userLocation = useAppStore((s) => s.userLocation);
  const setUserCity = useAppStore((s) => s.setUserCity);
  const detectUserLocation = useAppStore((s) => s.detectUserLocation);

  const [search, setSearch] = useState("");
  const [city, setCity] = useState<string>("all");
  const [sortBy, setSortBy] = useState("rating");
  const [onlyNearby, setOnlyNearby] = useState(false);
  const [maxDistance, setMaxDistance] = useState<number>(50);
  const [selectedLegalStatuses, setSelectedLegalStatuses] = useState<LegalStatus[]>([]);
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [onlySelfPickup, setOnlySelfPickup] = useState(false);
  const [onlySimpleX, setOnlySimpleX] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [showFilters, setShowFilters] = useState(false);

  const cities = Array.from(
    new Set(
      confectioners.flatMap((c) => [c.city, ...(c.location.deliveryCities || [])])
    )
  );

  const filtered = useMemo(() => {
    let result = confectioners.filter((c) => {
      // Поиск
      if (search) {
        const q = search.toLowerCase();
        const match =
          c.businessName.toLowerCase().includes(q) ||
          c.specialization.some((s) => s.toLowerCase().includes(q));
        if (!match) return false;
      }
      // Город
      const targetCity = city === "all" ? userCity || "" : city;
      if (targetCity && !confectionerServesCity(c, targetCity)) return false;
      // Юридический статус
      if (selectedLegalStatuses.length > 0 && !selectedLegalStatuses.includes(c.legalInfo.status)) {
        return false;
      }
      // Верификация
      if (onlyVerified && !c.verified) return false;
      // Самовывоз
      if (onlySelfPickup && !c.selfPickup) return false;
      // SimpleX (E2E-канал) — фильтруем по тарифу PREMIUM/BUSINESS как прокси
      // (полная проверка SimpleXContact требует запроса в БД на каждого кондитера,
      // здесь показываем кондитеров с премиум-доступом)
      if (onlySimpleX && !["PREMIUM", "BUSINESS"].includes(c.tariff || "START")) return false;
      // Рядом (по координатам)
      if (onlyNearby && userLocation?.lat && userLocation?.lng && c.location.lat && c.location.lng) {
        const dist = calculateDistance(
          userLocation.lat,
          userLocation.lng,
          c.location.lat,
          c.location.lng
        );
        if (dist > maxDistance) return false;
      }
      return true;
    });

    // Сортировка
    switch (sortBy) {
      case "rating":
        result.sort((a, b) => b.rating - a.rating);
        break;
      case "orders":
        result.sort((a, b) => b.ordersCount - a.ordersCount);
        break;
      case "followers":
        result.sort((a, b) => b.followersCount - a.followersCount);
        break;
      case "distance":
        if (userLocation?.lat && userLocation?.lng) {
          result.sort((a, b) => {
            const distA = a.location.lat
              ? calculateDistance(userLocation.lat!, userLocation.lng!, a.location.lat, a.location.lng!)
              : 9999;
            const distB = b.location.lat
              ? calculateDistance(userLocation.lat!, userLocation.lng!, b.location.lat, b.location.lng!)
              : 9999;
            return distA - distB;
          });
        }
        break;
    }

    return result;
  }, [
    confectioners,
    search,
    city,
    userCity,
    selectedLegalStatuses,
    onlyVerified,
    onlySelfPickup,
    onlySimpleX,
    onlyNearby,
    maxDistance,
    userLocation,
    sortBy,
  ]);

  // Подсчёт проверенных кондитеров в отфильтрованном списке
  const verifiedCount = filtered.filter((c) => c.verified).length;

  const toggleLegalStatus = (status: LegalStatus) => {
    setSelectedLegalStatuses((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status]
    );
  };

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10">
      <div className="mb-6">
        <h1 className="font-display text-2xl lg:text-3xl font-bold mb-2">
          Кондитеры платформы
        </h1>
        <p className="text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "кондитер" : "кондитеров"}
          {userCity ? ` в городе ${userCity}` : " по всей России"}
          {verifiedCount > 0 && verifiedCount < filtered.length && (
            <span className="ml-2 text-emerald-600 dark:text-emerald-400">
              • {verifiedCount} {verifiedCount === 1 ? "проверен" : "проверено"}
            </span>
          )}
          {verifiedCount === filtered.length && filtered.length > 0 && (
            <span className="ml-2 text-emerald-600 dark:text-emerald-400">
              • все проверены
            </span>
          )}
        </p>
      </div>

      {/* Search + sort */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по имени или специализации..."
            className="pl-10"
          />
        </div>
        <Button variant="outline" onClick={() => setShowFilters(!showFilters)} className="sm:w-auto">
          <Filter className="h-4 w-4 mr-1.5" />
          Фильтры
          {(onlyNearby || selectedLegalStatuses.length > 0 || onlyVerified || onlySelfPickup || onlySimpleX) && (
            <Badge className="ml-1.5 h-5 w-5 p-0 text-[10px] flex items-center justify-center bg-primary text-primary-foreground">
              {(onlyNearby ? 1 : 0) + selectedLegalStatuses.length + (onlyVerified ? 1 : 0) + (onlySelfPickup ? 1 : 0) + (onlySimpleX ? 1 : 0)}
            </Badge>
          )}
        </Button>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Сортировка" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rating">По рейтингу</SelectItem>
            <SelectItem value="orders">По заказам</SelectItem>
            <SelectItem value="followers">По подписчикам</SelectItem>
            <SelectItem value="distance">По расстоянию</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card className="p-4 mb-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Location filter */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">
                Локация
              </Label>
              <Select value={city} onValueChange={setCity}>
                <SelectTrigger className="h-9">
                  <MapPin className="h-3.5 w-3.5 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{userCity ? `Рядом (${userCity})` : "Все города"}</SelectItem>
                  {cities.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={onlyNearby}
                  onCheckedChange={(v) => setOnlyNearby(!!v)}
                />
                <span>В радиусе {maxDistance} км</span>
              </label>
              {onlyNearby && (
                <div className="px-1">
                  <Slider
                    value={[maxDistance]}
                    onValueChange={(v) => setMaxDistance(v[0])}
                    min={5}
                    max={200}
                    step={5}
                  />
                </div>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="w-full text-xs"
                onClick={async () => {
                  await detectUserLocation();
                }}
              >
                <Navigation className="h-3 w-3 mr-1" />
                Моё местоположение
              </Button>
            </div>

            {/* Legal status */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">
                Юридический статус
              </Label>
              <div className="space-y-1.5">
                {(Object.keys(LEGAL_STATUS_INFO) as LegalStatus[]).map((status) => (
                  <label
                    key={status}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedLegalStatuses.includes(status)}
                      onCheckedChange={() => toggleLegalStatus(status)}
                    />
                    <span className="flex items-center gap-1">
                      <span>{LEGAL_STATUS_INFO[status].icon}</span>
                      {LEGAL_STATUS_INFO[status].shortLabel}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Other filters */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">
                Дополнительно
              </Label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={onlyVerified} onCheckedChange={(v) => setOnlyVerified(!!v)} />
                <ShieldCheck className="h-3.5 w-3.5" />
                Только верифицированные
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={onlySelfPickup} onCheckedChange={(v) => setOnlySelfPickup(!!v)} />
                <Truck className="h-3.5 w-3.5" />
                С самовывозом
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={onlySimpleX} onCheckedChange={(v) => setOnlySimpleX(!!v)} />
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                С приватным каналом SimpleX (E2E)
                <Badge variant="outline" className="text-[10px] ml-1 text-emerald-700 border-emerald-200">PREMIUM</Badge>
              </label>
            </div>

            {/* Reset */}
            <div className="flex flex-col gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setOnlyNearby(false);
                  setSelectedLegalStatuses([]);
                  setOnlyVerified(false);
                  setOnlySelfPickup(false);
                  setOnlySimpleX(false);
                  setCity("all");
                  setMaxDistance(50);
                }}
              >
                Сбросить фильтры
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Quick city chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setCity("all")}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
            city === "all"
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border hover:border-primary/40"
          }`}
        >
          Все города
        </button>
        {cities.map((c) => (
          <button
            key={c}
            onClick={() => setCity(c)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              city === c
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border hover:border-primary/40"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Search className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-1">Кондитеры не найдены</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Попробуйте изменить параметры поиска или город
          </p>
          <Button
            onClick={() => {
              setSearch("");
              setCity("all");
              setOnlyNearby(false);
              setSelectedLegalStatuses([]);
              setOnlyVerified(false);
              setOnlySelfPickup(false);
            }}
          >
            Сбросить всё
          </Button>
        </Card>
      ) : (
        <>
          {/* View mode toggle */}
          <div className="flex items-center gap-2 mb-4">
            <Button
              size="sm"
              variant={viewMode === "list" ? "default" : "outline"}
              onClick={() => setViewMode("list")}
              className="gap-1.5"
            >
              <LayoutGrid className="h-4 w-4" />
              Список
            </Button>
            <Button
              size="sm"
              variant={viewMode === "map" ? "default" : "outline"}
              onClick={() => setViewMode("map")}
              className="gap-1.5"
            >
              <MapIcon className="h-4 w-4" />
              Карта
            </Button>
          </div>

          {viewMode === "map" ? (
            <ConfectionersMap />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((c) => {
                const distance =
                  userLocation?.lat && userLocation?.lng && c.location.lat && c.location.lng
                    ? calculateDistance(
                        userLocation.lat,
                        userLocation.lng,
                        c.location.lat,
                        c.location.lng
                      )
                    : null;
                return (
                  <div key={c.id} className="relative">
                    <ConfectionerCard confectioner={c} />
                    {distance !== null && (
                      <div className="absolute top-2 left-2 z-10">
                        <Badge className="bg-background/90 backdrop-blur text-foreground border-border text-[10px] shadow-sm">
                          <Navigation className="h-2.5 w-2.5 mr-0.5" />
                          {distance < 1 ? "рядом" : `${distance} км`}
                        </Badge>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* === Карточка-приглашение в конце списка === */}
          <div
            onClick={() => useAppStore.getState().setAuthModalOpen(true)}
            className="group relative overflow-hidden rounded-xl border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary/5 via-accent/10 to-primary/5 hover:border-primary/50 hover:shadow-lg transition-all cursor-pointer min-h-[280px] flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity">
              <div className="absolute top-4 right-4 text-6xl">🎂</div>
              <div className="absolute bottom-4 left-4 text-5xl">🧁</div>
            </div>
            <div className="relative z-10 space-y-3">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <Sparkles className="h-7 w-7 text-primary" />
              </div>
              <h3 className="font-display text-lg font-bold">Не нашли кондитера?</h3>
              <p className="text-xs text-muted-foreground max-w-[200px] mx-auto leading-relaxed">
                Возможно, это вы! Зарегистрируйтесь как кондитер
                и начните принимать заказы
              </p>
              <div className="inline-flex items-center gap-1 text-primary text-sm font-medium group-hover:gap-2 transition-all">
                Стать кондитером
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
