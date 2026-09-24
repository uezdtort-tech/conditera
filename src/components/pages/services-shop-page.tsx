"use client";

import { useAppStore } from "@/lib/store";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  SERVICE_CATEGORIES,
  SERVICE_GROUPS,
  PRICE_UNIT_LABELS,
} from "@/lib/mock-data-services";
import { formatCurrency } from "@/lib/finance";
import type { ServiceCategory } from "@/lib/types";
import {
  Search,
  Star,
  Check,
  Plus,
  ChevronLeft,
  Sparkles,
  MapPin,
  Clock,
  AlertTriangle,
  Users,
} from "lucide-react";
import { toast } from "sonner";

export function ServicesShopPage() {
  const navigate = useAppStore((s) => s.navigate);
  const serviceShops = useAppStore((s) => s.serviceShops);
  const serviceProducts = useAppStore((s) => s.serviceProducts);
  const userCity = useAppStore((s) => s.userCity);
  const cart = useAppStore((s) => s.cart);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [shopFilter, setShopFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState("popular");

  const filtered = useMemo(() => {
    let result = serviceProducts.filter((p) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !p.title.toLowerCase().includes(q) &&
          !p.description.toLowerCase().includes(q)
        )
          return false;
      }
      if (category !== "all" && p.category !== category) return false;
      if (shopFilter !== "all" && p.shopId !== shopFilter) return false;
      if (groupFilter !== "all") {
        const catInfo = SERVICE_CATEGORIES.find((c) => c.slug === p.category);
        if (catInfo?.group !== groupFilter) return false;
      }
      // Фильтр по городу пользователя
      if (userCity) {
        const shop = serviceShops.find((s) => s.id === p.shopId);
        if (shop && !shop.shipsNationwide) {
          const delivers =
            shop.city === userCity ||
            shop.deliveryCities?.includes(userCity) ||
            shop.serviceRadiusKm; // аниматоры ездят в радиусе
          if (!delivers) return false;
        }
      }
      return true;
    });

    switch (sortBy) {
      case "price-asc":
        result.sort((a, b) => a.price - b.price);
        break;
      case "price-desc":
        result.sort((a, b) => b.price - a.price);
        break;
      case "rating":
        result.sort((a, b) => b.rating - a.rating);
        break;
      case "popular":
      default:
        result.sort((a, b) => b.reviewsCount - a.reviewsCount);
    }
    return result;
  }, [serviceProducts, search, category, shopFilter, groupFilter, sortBy, userCity, serviceShops]);

  const handleAddToCart = (product: typeof serviceProducts[0]) => {
    const cartItem = {
      productId: product.id,
      title: product.title,
      image: product.images[0],
      price: product.price,
      quantity: 1,
      confectionerId: product.shopId,
    };
    useAppStore.setState((state) => ({
      cart: [...state.cart, cartItem],
      cartOpen: true,
    }));
    toast.success("Добавлено в корзину", {
      description: product.title,
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
        <Badge className="mb-2 bg-purple-100 text-purple-800 border-purple-200">
          <Sparkles className="h-3 w-3 mr-1" />
          Услуги для праздника
        </Badge>
        <h1 className="font-display text-2xl lg:text-3xl font-bold mb-2">
          Фейерверки, шары и аниматоры
        </h1>
        <p className="text-muted-foreground">
          Полный спектр услуг для вашего праздника. Фейерверки и салюты, воздушные
          шары и композиции, аниматоры и ведущие. Заказывайте вместе с тортом —
          всё в одном месте.
          {userCity && <span className="text-primary"> Услуги в городе {userCity}.</span>}
        </p>
      </div>

      {/* Shops */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-6">
        {serviceShops.map((shop) => (
          <Card
            key={shop.id}
            className={`p-2.5 cursor-pointer hover:shadow-md transition-shadow ${
              shopFilter === shop.id ? "border-primary bg-primary/5" : ""
            }`}
            onClick={() => setShopFilter(shopFilter === shop.id ? "all" : shop.id)}
          >
            <div className="flex items-center gap-2">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarImage src={shop.avatar} alt={shop.businessName} />
                <AvatarFallback className="text-[10px]">
                  {shop.businessName.slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[11px] truncate flex items-center gap-1">
                  {shop.businessName}
                  {shop.verified && <Check className="h-2.5 w-2.5 text-primary" />}
                </div>
                <div className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                  <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                  {shop.rating} • {shop.city}
                </div>
              </div>
            </div>
            {shop.platformDiscount && (
              <Badge className="text-[9px] bg-emerald-100 text-emerald-800 mt-1">
                −{shop.platformDiscount}%
              </Badge>
            )}
          </Card>
        ))}
      </div>

      {/* Search + sort */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск услуг..."
            className="pl-10"
          />
        </div>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Сортировка" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">Популярные</SelectItem>
            <SelectItem value="price-asc">Сначала дешевле</SelectItem>
            <SelectItem value="price-desc">Сначала дороже</SelectItem>
            <SelectItem value="rating">По рейтингу</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Group filter */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => {
            setGroupFilter("all");
            setCategory("all");
          }}
          className={`px-3 py-1 text-xs rounded-full border ${
            groupFilter === "all"
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border hover:border-primary/40"
          }`}
        >
          Все услуги
        </button>
        {SERVICE_GROUPS.map((g) => (
          <button
            key={g}
            onClick={() => setGroupFilter(groupFilter === g ? "all" : g)}
            className={`px-3 py-1 text-xs rounded-full border ${
              groupFilter === g
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border hover:border-primary/40"
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        {SERVICE_CATEGORIES.filter(
          (c) => groupFilter === "all" || c.group === groupFilter
        ).map((cat) => {
          const count = serviceProducts.filter((p) => p.category === cat.slug).length;
          if (count === 0) return null;
          return (
            <button
              key={cat.slug}
              onClick={() => setCategory(category === cat.slug ? "all" : cat.slug)}
              className={`px-2.5 py-1 text-[11px] rounded-full border flex items-center gap-1 ${
                category === cat.slug
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <span>{cat.icon}</span>
              {cat.name}
              <span className="opacity-60">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Products grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((product) => {
          const shop = serviceShops.find((s) => s.id === product.shopId);
          const catInfo = SERVICE_CATEGORIES.find((c) => c.slug === product.category);
          const discountedPrice = shop?.platformDiscount
            ? Math.round(product.price * (1 - shop.platformDiscount / 100))
            : product.price;
          const inCart = cart.some((c) => c.productId === product.id);
          const isService = ["animator_clown", "animator_hero", "animator_show", "animator_facepaint", "animator_quest", "photographer", "videographer", "music", "host"].includes(product.category);
          return (
            <Card key={product.id} className="overflow-hidden p-0 hover:shadow-lg transition-shadow flex flex-col">
              <div className="relative aspect-video bg-muted overflow-hidden">
                <img
                  src={product.images[0]}
                  alt={product.title}
                  className="w-full h-full object-cover" loading="lazy" decoding="async" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                {/* Category badge */}
                <Badge className="absolute top-2 left-2 bg-purple-500 text-white text-[10px]">
                  {catInfo?.icon} {catInfo?.name}
                </Badge>
                {product.isPopular && (
                  <Badge className="absolute top-2 right-2 bg-amber-500 text-white text-[10px]">
                    Хит
                  </Badge>
                )}
                {product.isNew && !product.isPopular && (
                  <Badge className="absolute top-2 right-2 bg-emerald-500 text-white text-[10px]">
                    Новинка
                  </Badge>
                )}
                {/* Title on image */}
                <div className="absolute bottom-2 left-3 right-3">
                  <h3 className="font-display font-bold text-white text-sm line-clamp-2 drop-shadow">
                    {product.title}
                  </h3>
                </div>
              </div>

              <div className="p-3 flex-1 flex flex-col">
                {/* Shop */}
                <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Avatar className="h-4 w-4">
                    <AvatarImage src={product.shopAvatar} alt="" />
                    <AvatarFallback className="text-[8px]">
                      {product.shopName.slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  {product.shopName}
                  <span>•</span>
                  <MapPin className="h-2.5 w-2.5" />
                  {shop?.city}
                </div>

                {/* Description */}
                <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                  {product.description}
                </p>

                {/* Characteristics */}
                <div className="flex flex-wrap gap-1 mb-2">
                  {product.duration && (
                    <Badge variant="secondary" className="text-[10px]">
                      <Clock className="h-2.5 w-2.5 mr-0.5" />
                      {product.duration}
                    </Badge>
                  )}
                  {product.ageRange && (
                    <Badge variant="secondary" className="text-[10px]">
                      <Users className="h-2.5 w-2.5 mr-0.5" />
                      {product.ageRange}
                    </Badge>
                  )}
                  {product.balloonsCount && (
                    <Badge variant="secondary" className="text-[10px]">
                      🎈 {product.balloonsCount} шт
                    </Badge>
                  )}
                  {product.shotsCount && (
                    <Badge variant="secondary" className="text-[10px]">
                      🎆 {product.shotsCount} залп.
                    </Badge>
                  )}
                  {product.customizable && (
                    <Badge variant="secondary" className="text-[10px] bg-purple-50 text-purple-700">
                      Персонал.
                    </Badge>
                  )}
                </div>

                {/* Safety note for fireworks */}
                {product.safetyNote && (
                  <div className="mb-2 p-1.5 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-800 flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                    <span>{product.safetyNote}</span>
                  </div>
                )}

                {/* Rating */}
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-2">
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                  {product.rating} ({product.reviewsCount} отзывов)
                </div>

                {/* Price & add */}
                <div className="mt-auto flex items-end justify-between">
                  <div>
                    {product.oldPrice && (
                      <div className="text-[10px] text-muted-foreground line-through">
                        {formatCurrency(product.oldPrice)}
                      </div>
                    )}
                    <div className="font-display font-bold text-base">
                      {formatCurrency(discountedPrice)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {PRICE_UNIT_LABELS[product.priceUnit] || ""}
                    </div>
                    {shop?.platformDiscount && (
                      <div className="text-[10px] text-emerald-600">
                        −{shop.platformDiscount}% скидка
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={inCart ? "default" : "outline"}
                    onClick={() => handleAddToCart(product)}
                    disabled={inCart}
                  >
                    {inCart ? (
                      <>
                        <Check className="h-4 w-4 mr-1" />
                        В корзине
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-1" />
                        {isService ? "Заказать" : "В корзину"}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <Card className="p-12 text-center">
          <Search className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-1">Услуги не найдены</h3>
          <p className="text-sm text-muted-foreground">
            {userCity
              ? `В вашем городе (${userCity}) нет услуг этого типа. Попробуйте сменить город или категорию.`
              : "Измените параметры поиска"}
          </p>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => {
              setSearch("");
              setCategory("all");
              setGroupFilter("all");
              setShopFilter("all");
            }}
          >
            Сбросить фильтры
          </Button>
        </Card>
      )}

      {/* Info */}
      <Card className="mt-8 p-6 bg-gradient-to-br from-purple-50 to-rose-50 border-purple-200">
        <h3 className="font-display font-semibold mb-2 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-600" />
          Праздник под ключ
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          Закажите торт + декор + фейерверки + шары + аниматора — всё в одном месте.
          Платформа автоматически подбирает подходящие услуги в карточке товара.
          При заказе нескольких услуг — скидки от партнёров до 15%.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎆</span>
            Фейерверки и салюты
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🎈</span>
            Воздушные шары
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🤡</span>
            Аниматоры
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📷</span>
            Фотографы и ведущие
          </div>
        </div>
      </Card>
    </div>
  );
}
