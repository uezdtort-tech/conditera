"use client";

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Plus,
  Check,
  Star,
  Sparkles,
  Package,
  TrendingUp,
  Clock,
  Users,
} from "lucide-react";
import { formatCurrency } from "@/lib/finance";
import { PRICE_UNIT_LABELS, SERVICE_CATEGORIES } from "@/lib/mock-data-services";
import { toast } from "sonner";
import type { Product } from "@/lib/types";

interface CrossSellBlockProps {
  product: Product;
}

export function CrossSellBlock({ product }: CrossSellBlockProps) {
  const decorProducts = useAppStore((s) => s.decorProducts);
  const serviceProducts = useAppStore((s) => s.serviceProducts);
  const bundles = useAppStore((s) => s.bundles);
  const allProducts = useAppStore((s) => s.products);
  const addToCart = useAppStore((s) => s.addToCart);
  const cart = useAppStore((s) => s.cart);

  // Услуги, связанные с этим тортом (фейерверки, шары, аниматоры)
  const relatedServices = serviceProducts.filter((sp) =>
    sp.crossSellWith?.includes(product.id)
  );

  // 1. Декор, связанный с этим товаром через crossSellWith
  const relatedDecor = decorProducts.filter((dp) =>
    dp.crossSellWith?.includes(product.id)
  );

  // 2. Похожие вкусы (та же категория, другие кондитеры)
  const similarProducts = allProducts
    .filter(
      (p) =>
        p.id !== product.id &&
        p.category === product.category &&
        p.confectionerId !== product.confectionerId
    )
    .slice(0, 4);

  // 3. Готовые наборы для этого товара
  const relatedBundles = bundles.filter(
    (b) => b.mainProductId === product.id
  );

  // 4. Топ декора (если мало связанных)
  const topDecor = decorProducts
    .filter((dp) => dp.isPopular && !relatedDecor.includes(dp))
    .slice(0, 4);

  // Если нечего показывать
  if (
    relatedDecor.length === 0 &&
    similarProducts.length === 0 &&
    relatedBundles.length === 0 &&
    topDecor.length === 0
  ) {
    return null;
  }

  const handleAddDecor = (decor: typeof decorProducts[0]) => {
    const cartItem = {
      productId: decor.id,
      title: decor.title,
      image: decor.images[0],
      price: decor.price,
      quantity: 1,
      confectionerId: decor.shopId,
    };
    useAppStore.setState((state) => ({
      cart: [...state.cart, cartItem],
    }));
    toast.success("Добавлено в корзину", {
      description: decor.title,
    });
  };

  const handleAddBundle = (bundle: typeof bundles[0]) => {
    bundle.items.forEach((item) => {
      const cartItem = {
        productId: item.productId,
        title: item.title,
        image: item.image,
        price:
          item.productType === "cake"
            ? item.price
            : item.price,
        quantity: item.quantity,
        confectionerId: item.productType === "cake" ? product.confectionerId : "decor",
      };
      useAppStore.setState((state) => ({
        cart: [...state.cart, cartItem],
      }));
    });
    toast.success(`Набор «${bundle.name}» добавлен в корзину!`, {
      description: `Вы сэкономили ${formatCurrency(bundle.originalPrice - bundle.bundlePrice)}`,
    });
  };

  return (
    <div className="space-y-6 mt-8">
      {/* Выгодные наборы */}
      {relatedBundles.length > 0 && (
        <div>
          <h2 className="font-display text-xl font-bold mb-4 flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Выгодные наборы с этим тортом
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {relatedBundles.map((bundle) => (
              <Card
                key={bundle.id}
                className="overflow-hidden p-0 hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => handleAddBundle(bundle)}
              >
                <div className="relative aspect-video bg-muted overflow-hidden">
                  <img
                    src={bundle.items[0]?.image}
                    alt={bundle.name}
                    className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                  <Badge className="absolute top-2 right-2 bg-emerald-500 text-white">
                    −{bundle.discount}%
                  </Badge>
                  <div className="absolute bottom-2 left-3 right-3">
                    <h3 className="font-display font-bold text-white text-sm">
                      {bundle.name}
                    </h3>
                  </div>
                </div>
                <div className="p-3">
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                    {bundle.description}
                  </p>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {bundle.items.map((item, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px]">
                        {item.productType === "cake" && "🎂"}
                        {item.productType === "decor" && "🎀"}
                        {item.productType === "packaging" && "📦"}
                        {item.title.length > 20
                          ? item.title.slice(0, 20) + "..."
                          : item.title}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground line-through">
                        {formatCurrency(bundle.originalPrice)}
                      </div>
                      <div className="font-display font-bold text-base text-primary">
                        {formatCurrency(bundle.bundlePrice)}
                      </div>
                    </div>
                    <div className="text-xs text-emerald-600 font-medium">
                      Выгода {formatCurrency(bundle.originalPrice - bundle.bundlePrice)}
                    </div>
                  </div>
                  <Button size="sm" className="w-full mt-2">
                    <Plus className="h-4 w-4 mr-1" />
                    Добавить набор
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* С этим товаром покупают */}
      {relatedDecor.length > 0 && (
        <div>
          <h2 className="font-display text-xl font-bold mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            С этим товаром покупают
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {relatedDecor.map((decor) => {
              const inCart = cart.some((c) => c.productId === decor.id);
              return (
                <Card key={decor.id} className="p-3 hover:shadow-md transition-shadow">
                  <div className="aspect-square rounded-lg overflow-hidden bg-muted mb-2">
                    <img
                      src={decor.images[0]}
                      alt={decor.title}
                      className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  </div>
                  <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                    <Avatar className="h-3 w-3">
                      <AvatarImage src={decor.shopAvatar} alt="" />
                      <AvatarFallback className="text-[8px]">
                        {decor.shopName.slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    {decor.shopName}
                  </div>
                  <h3 className="font-medium text-xs line-clamp-2 mb-1 min-h-[2rem]">
                    {decor.title}
                  </h3>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-2">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    {decor.rating}
                    {decor.reusable && (
                      <Badge variant="secondary" className="text-[9px] ml-1">
                        Многораз.
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-display font-bold text-sm">
                      {formatCurrency(decor.price)}
                    </span>
                    <Button
                      size="icon"
                      variant={inCart ? "default" : "outline"}
                      className="h-7 w-7"
                      onClick={() => handleAddDecor(decor)}
                      disabled={inCart}
                    >
                      {inCart ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Дополните образ — топ декора */}
      {relatedDecor.length < 4 && topDecor.length > 0 && (
        <div>
          <h2 className="font-display text-xl font-bold mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-rose-600" />
            Дополните образ
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {topDecor.slice(0, 4 - relatedDecor.length).map((decor) => {
              const inCart = cart.some((c) => c.productId === decor.id);
              return (
                <Card key={decor.id} className="p-3 hover:shadow-md transition-shadow">
                  <div className="aspect-square rounded-lg overflow-hidden bg-muted mb-2">
                    <img
                      src={decor.images[0]}
                      alt={decor.title}
                      className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  </div>
                  <h3 className="font-medium text-xs line-clamp-2 mb-1 min-h-[2rem]">
                    {decor.title}
                  </h3>
                  <div className="flex items-center justify-between">
                    <span className="font-display font-bold text-sm">
                      {formatCurrency(decor.price)}
                    </span>
                    <Button
                      size="icon"
                      variant={inCart ? "default" : "outline"}
                      className="h-7 w-7"
                      onClick={() => handleAddDecor(decor)}
                      disabled={inCart}
                    >
                      {inCart ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Услуги для праздника (фейерверки, шары, аниматоры) */}
      {relatedServices.length > 0 && (
        <div>
          <h2 className="font-display text-xl font-bold mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            Услуги для праздника
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {relatedServices.slice(0, 6).map((service) => {
              const inCart = cart.some((c) => c.productId === service.id);
              const catInfo = SERVICE_CATEGORIES.find((c) => c.slug === service.category);
              return (
                <Card key={service.id} className="p-3 hover:shadow-md transition-shadow">
                  <div className="flex gap-3">
                    <div className="w-20 h-20 rounded-lg overflow-hidden bg-muted shrink-0">
                      <img
                        src={service.images[0]}
                        alt={service.title}
                        className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <Badge className="text-[9px] bg-purple-100 text-purple-700 mb-1">
                        {catInfo?.icon} {catInfo?.name}
                      </Badge>
                      <h3 className="font-medium text-xs line-clamp-2 mb-1">
                        {service.title}
                      </h3>
                      <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground mb-1">
                        {service.duration && (
                          <span className="flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5" />
                            {service.duration}
                          </span>
                        )}
                        {service.ageRange && (
                          <span className="flex items-center gap-0.5">
                            <Users className="h-2.5 w-2.5" />
                            {service.ageRange}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                        <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                        {service.rating} ({service.reviewsCount})
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-display font-bold text-sm">
                            {formatCurrency(service.price)}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-1">
                            {PRICE_UNIT_LABELS[service.priceUnit]}
                          </span>
                        </div>
                        <Button
                          size="icon"
                          variant={inCart ? "default" : "outline"}
                          className="h-7 w-7"
                          onClick={() => {
                            const cartItem = {
                              productId: service.id,
                              title: service.title,
                              image: service.images[0],
                              price: service.price,
                              quantity: 1,
                              confectionerId: service.shopId,
                            };
                            useAppStore.setState((state) => ({
                              cart: [...state.cart, cartItem],
                            }));
                            toast.success("Добавлено в корзину", {
                              description: service.title,
                            });
                          }}
                          disabled={inCart}
                        >
                          {inCart ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Plus className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Похожие вкусы */}
      {similarProducts.length > 0 && (
        <div>
          <h2 className="font-display text-xl font-bold mb-4">
            Похожие вкусы
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {similarProducts.map((p) => (
              <Card
                key={p.id}
                className="overflow-hidden p-0 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() =>
                  useAppStore.getState().navigate("product", { id: p.id })
                }
              >
                <div className="aspect-square bg-muted">
                  <img
                    src={p.images[0]}
                    alt={p.title}
                    className="w-full h-full object-cover" loading="lazy" decoding="async" />
                </div>
                <div className="p-2">
                  <h3 className="font-medium text-xs line-clamp-2 mb-1 min-h-[2rem]">
                    {p.title}
                  </h3>
                  <div className="flex items-center justify-between">
                    <span className="font-display font-bold text-sm">
                      {formatCurrency(p.price)}
                    </span>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {p.rating}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
