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
import { DECOR_CATEGORIES } from "@/lib/mock-data-decor";
import { MarketplaceCtaCard } from "@/components/marketplace/marketplace-cta-card";
import { formatCurrency } from "@/lib/finance";
import type { DecorCategory } from "@/lib/types";
import {
  Search,
  MapPin,
  Star,
  Check,
  Plus,
  ShoppingCart,
  ChevronLeft,
  Sparkles,
  Truck,
  Gift,
} from "lucide-react";
import { toast } from "sonner";

export function DecorShopPage() {
  const navigate = useAppStore((s) => s.navigate);
  const decorShops = useAppStore((s) => s.decorShops);
  const decorProducts = useAppStore((s) => s.decorProducts);
  const addToCart = useAppStore((s) => s.addToCart);
  const cart = useAppStore((s) => s.cart);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [shopFilter, setShopFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState("popular");

  const filtered = useMemo(() => {
    let result = decorProducts.filter((p) => {
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
  }, [decorProducts, search, category, shopFilter, sortBy]);

  const handleAddToCart = (product: typeof decorProducts[0]) => {
    // Создаём pseudo-product для корзины
    const cartItem = {
      productId: product.id,
      title: product.title,
      image: product.images[0],
      price: product.price,
      quantity: 1,
      confectionerId: product.shopId,
    };
    // Используем напрямую через store
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
        <Badge className="mb-2 bg-rose-100 text-rose-800 border-rose-200">
          <Gift className="h-3 w-3 mr-1" />
          Декор и упаковка
        </Badge>
        <h1 className="font-display text-2xl lg:text-3xl font-bold mb-2">
          Декор и упаковка для тортов
        </h1>
        <p className="text-muted-foreground">
          Свечи, топперы, подложки, коробки, ленты, бенгальские огни, сахарные
          фигурки. Доставка по всей России. Скидки для покупателей платформы.
        </p>
      </div>

      {/* Shops */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {decorShops.map((shop) => (
          <Card
            key={shop.id}
            className={`p-3 cursor-pointer hover:shadow-md transition-shadow ${
              shopFilter === shop.id ? "border-primary bg-primary/5" : ""
            }`}
            onClick={() =>
              setShopFilter(shopFilter === shop.id ? "all" : shop.id)
            }
          >
            <div className="flex items-center gap-2 mb-1">
              <Avatar className="h-8 w-8">
                <AvatarImage src={shop.avatar} alt={shop.businessName} />
                <AvatarFallback className="text-[10px]">
                  {shop.businessName.slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-xs truncate flex items-center gap-1">
                  {shop.businessName}
                  {shop.verified && <Check className="h-3 w-3 text-primary" />}
                </div>
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                  {shop.rating}
                </div>
              </div>
            </div>
            {shop.platformDiscount && (
              <Badge className="text-[9px] bg-emerald-100 text-emerald-800">
                −{shop.platformDiscount}% для вас
              </Badge>
            )}
          </Card>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск декора и упаковки..."
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

      {/* Category chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setCategory("all")}
          className={`px-3 py-1 text-xs rounded-full border ${
            category === "all"
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border hover:border-primary/40"
          }`}
        >
          Все категории
        </button>
        {DECOR_CATEGORIES.map((cat) => {
          const count = decorProducts.filter((p) => p.category === cat.slug).length;
          if (count === 0) return null;
          return (
            <button
              key={cat.slug}
              onClick={() => setCategory(cat.slug)}
              className={`px-3 py-1 text-xs rounded-full border flex items-center gap-1 ${
                category === cat.slug
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <span>{cat.icon}</span>
              {cat.name}
              <span className="text-[10px] opacity-60">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Products grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.map((product) => {
          const shop = decorShops.find((s) => s.id === product.shopId);
          const discountedPrice = shop?.platformDiscount
            ? Math.round(product.price * (1 - shop.platformDiscount / 100))
            : product.price;
          return (
            <Card key={product.id} className="overflow-hidden p-0 hover:shadow-lg transition-shadow flex flex-col">
              <div className="relative aspect-square bg-muted overflow-hidden">
                <img
                  src={product.images[0]}
                  alt={product.title}
                  className="w-full h-full object-cover" loading="lazy" decoding="async" />
                {product.isPopular && (
                  <Badge className="absolute top-2 left-2 bg-amber-500 text-white text-[10px]">
                    Хит
                  </Badge>
                )}
                {product.isNew && (
                  <Badge className="absolute top-2 left-2 bg-emerald-500 text-white text-[10px]">
                    Новинка
                  </Badge>
                )}
                {product.oldPrice && (
                  <Badge className="absolute top-2 right-2 bg-red-500 text-white text-[10px]">
                    -{Math.round((1 - product.price / product.oldPrice) * 100)}%
                  </Badge>
                )}
              </div>
              <div className="p-3 flex-1 flex flex-col">
                <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Avatar className="h-4 w-4">
                    <AvatarImage src={product.shopAvatar} alt="" />
                    <AvatarFallback className="text-[8px]">
                      {product.shopName.slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  {product.shopName}
                </div>
                <h3 className="font-medium text-sm line-clamp-2 mb-1 min-h-[2.5rem]">
                  {product.title}
                </h3>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                  {product.description}
                </p>
                {/* Characteristics */}
                <div className="flex flex-wrap gap-1 mb-2">
                  {product.packQuantity && product.packQuantity > 1 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {product.packQuantity} шт
                    </Badge>
                  )}
                  {product.reusable && (
                    <Badge variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700">
                      Многоразовое
                    </Badge>
                  )}
                  {product.customizable && (
                    <Badge variant="secondary" className="text-[10px] bg-purple-50 text-purple-700">
                      Персонализация
                    </Badge>
                  )}
                </div>
                {/* Rating */}
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-2">
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                  {product.rating} ({product.reviewsCount})
                </div>
                {/* Price & add */}
                <div className="mt-auto flex items-end justify-between">
                  <div>
                    {product.oldPrice && (
                      <div className="text-[10px] text-muted-foreground line-through">
                        {formatCurrency(product.oldPrice)}
                      </div>
                    )}
                    <div className="font-display font-bold text-sm">
                      {formatCurrency(discountedPrice)}
                    </div>
                    {shop?.platformDiscount && (
                      <div className="text-[10px] text-emerald-600">
                        −{shop.platformDiscount}% скидка
                      </div>
                    )}
                  </div>
                  <Button
                    size="icon"
                    onClick={() => handleAddToCart(product)}
                    className="h-8 w-8 shrink-0"
                  >
                    <Plus className="h-4 w-4" />
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
          <h3 className="font-semibold mb-1">Ничего не найдено</h3>
          <p className="text-sm text-muted-foreground">Измените параметры поиска</p>
        </Card>
      )}

      {/* CTA: зазывалка для производителей декора и упаковки */}
      <MarketplaceCtaCard
        badge="Для магазинов декора и упаковки"
        title="Вы производите декор или упаковку для сладостей?"
        description="Разместите свой каталог на «Уездном кондитере» — покупатели заказывают декор вместе с тортом, а платформа автоматически подбирает ваши товары в карточках изделий. Первый месяц без комиссии."
        primaryLabel="Присоединиться и разместить товары"
        secondaryLabel="Условия для магазинов"
        secondaryView="for-suppliers"
      />

      {/* Info */}
      <Card className="mt-8 p-6 bg-gradient-to-br from-rose-50 to-amber-50 border-rose-200">
        <h3 className="font-display font-semibold mb-2 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-rose-600" />
          Дополните свой торт
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          Закажите декор и упаковку вместе с тортом. Платформа автоматически
          подберёт подходящие товары в карточке товара. При покупке декора
          вместе с тортом — скидка от магазинов-партнёров.
        </p>
        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" />
            Доставка по России
          </div>
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-600" />
            Скидки до 15%
          </div>
          <div className="flex items-center gap-2">
            <Gift className="h-4 w-4 text-rose-600" />
            Подарочные карты
          </div>
        </div>
      </Card>
    </div>
  );
}
