"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, ShoppingCart, Star, Check, Calendar, Cake } from "lucide-react";
import {
  formatCurrency,
  TRUST_LEVELS,
  getProductPaymentOptions,
  formatInstallmentPlan,
} from "@/lib/finance";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { hasRealDiscount, isFromPrice } from "@/lib/price-display";

interface ProductCardProps {
  product: Product;
  variant?: "default" | "compact";
}

export function ProductCard({ product, variant = "default" }: ProductCardProps) {
  const navigate = useAppStore((s) => s.navigate);
  const addToCart = useAppStore((s) => s.addToCart);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const isFavorite = useAppStore((s) => s.isFavorite(product.id));
  const confectioners = useAppStore((s) => s.confectioners);
  const confectioner = confectioners.find((c) => c.id === product.confectionerId);

  // Design Revamp V1: битый URL изображения не должен показывать «иконку сломанной картинки» —
  // честный placeholder с иконкой кондитерской (данные не подменяются).
  const [primaryFailed, setPrimaryFailed] = useState(false);
  const [secondaryFailed, setSecondaryFailed] = useState(false);

  // Вторая фотография (для тортов — цельный вид + альтернативный ракурс/разрез
  // из реального набора изображений товара). Показывается crossfade на hover.
  const hasSecondaryPhoto = Boolean(product.images?.[1]) && !secondaryFailed;

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (product.isAvailable === false) return; // кнопка задизейблена — защита на всякий случай
    addToCart(product);
  };

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(product.id);
  };

  return (
    <Card
      onClick={() => navigate("product", { id: product.id })}
      className="card-hover group relative overflow-hidden cursor-pointer border-border p-0 h-full flex flex-col focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate("product", { id: product.id });
        }
      }}
    >
      {/* Фото — главный визуальный элемент карточки */}
      <div className="relative aspect-[4/3] overflow-hidden bg-accent/60">
        {product.images?.[0] && !primaryFailed ? (
          <>
            <img
              src={product.images[0]}
              alt={product.title}
              loading="lazy"
              onError={() => setPrimaryFailed(true)}
              className={cn(
                "w-full h-full object-cover transition-all duration-500 group-hover:scale-[1.04]",
                hasSecondaryPhoto && "group-hover:opacity-0",
              )}
              decoding="async" />
            {/* Второе фото товара (реальные данные; для тортов — вид в разрезе/альтернативный ракурс) */}
            {hasSecondaryPhoto && (
              <img
                src={product.images[1]}
                alt={`${product.title} — дополнительное фото`}
                loading="lazy"
                onError={() => setSecondaryFailed(true)}
                className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                decoding="async" />
            )}
          </>
        ) : (
          <div
            className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground/45"
            aria-label="Фотография появится после модерации"
          >
            <Cake className="h-10 w-10" aria-hidden />
            <span className="text-[11px]">Фото скоро появится</span>
          </div>
        )}

        {/* Индикатор второго фото */}
        {hasSecondaryPhoto && (
          <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 pointer-events-none" aria-hidden>
            <span className="h-1.5 w-1.5 rounded-full bg-white shadow-sm" />
            <span className="h-1.5 w-1.5 rounded-full bg-white/50 shadow-sm" />
          </div>
        )}

        {/* Badges */}
        <div className="absolute top-2.5 left-2.5 flex flex-col gap-1 items-start">
          {product.isAvailable === false && (
            <Badge className="bg-muted/95 text-muted-foreground text-[10px] px-2 py-0.5 border border-border/60">
              Нет в наличии
            </Badge>
          )}
          {product.isHit && (
            <Badge className="bg-primary text-primary-foreground text-[10px] px-2 py-0.5">
              Хит
            </Badge>
          )}
          {product.isNew && (
            <Badge className="bg-emerald-700 text-white text-[10px] px-2 py-0.5">
              Новинка
            </Badge>
          )}
          {product.isPopular && !product.isHit && (
            <Badge className="bg-accent text-accent-foreground text-[10px] px-2 py-0.5 border border-border/60">
              Популярное
            </Badge>
          )}
          {/* PR-4: бейдж скидки — только на реальную скидку (old_price > price) */}
          {hasRealDiscount(product) && product.oldPrice !== undefined && (
            <Badge className="bg-destructive text-white text-[10px] px-2 py-0.5">
              -{Math.round((1 - product.price / product.oldPrice) * 100)}%
            </Badge>
          )}
        </div>

        {/* Favorite */}
        <button
          onClick={handleFavorite}
          className="absolute top-2.5 right-2.5 h-9 w-9 rounded-full bg-background/90 backdrop-blur border border-border/50 flex items-center justify-center hover:bg-background hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring shadow-sm transition-colors"
          aria-label="В избранное"
        >
          <Heart
            className={cn(
              "h-4 w-4 transition-colors",
              isFavorite ? "fill-primary text-primary" : "text-muted-foreground"
            )}
          />
        </button>
      </div>

      {/* Content */}
      <div className="p-3.5 sm:p-4 space-y-2 flex flex-col flex-1">
        {/* Кондитер */}
        {confectioner && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Avatar className="h-5 w-5 border border-border/60">
              <AvatarImage src={confectioner.avatar} alt={confectioner.businessName} />
              <AvatarFallback className="text-[9px] bg-accent">
                {confectioner.businessName.slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{confectioner.businessName}</span>
            {confectioner.verified && (
              <Check className="h-3 w-3 text-primary fill-primary/20 shrink-0" />
            )}
          </div>
        )}

        {/* Название */}
        <h3 className="text-[15px] leading-snug line-clamp-2 text-foreground group-hover:text-primary transition-colors min-h-[2.6rem]">
          {product.title}
        </h3>

        {variant === "default" && (
          <p className="text-[13px] text-muted-foreground line-clamp-2">
            {product.description}
          </p>
        )}

        {/* Рейтинг — только при наличии настоящих отзывов; вес */}
        <div className="flex items-center justify-between text-xs mt-auto">
          {product.reviewsCount > 0 ? (
            <div className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              <span className="font-medium">{product.rating.toFixed(1)}</span>
              <span className="text-muted-foreground">({product.reviewsCount})</span>
            </div>
          ) : (
            <span />
          )}
          {product.weight && (
            <span className="text-muted-foreground">{product.weight}</span>
          )}
        </div>

        {/* Payment options */}
        {(() => {
          const opts = getProductPaymentOptions(product, confectioner);
          if (!opts.installment && !opts.split) return null;
          return (
            <div className="flex flex-wrap gap-1 pt-1.5 border-t border-border/70">
              {opts.installment && opts.installments[0] && (
                <Badge variant="outline" className="text-[11px] bg-primary/5 text-primary border-primary/20">
                  <Calendar className="h-2.5 w-2.5 mr-0.5" />
                  {formatInstallmentPlan(opts.installments[0], product.price)}
                </Badge>
              )}
              {opts.split && (
                <Badge variant="outline" className="text-[11px] bg-accent text-accent-foreground border-border">
                  <span aria-hidden>🔀</span>
                  <span className="ml-0.5">Сплит</span>
                </Badge>
              )}
            </div>
          );
        })()}

        {/* Цена и действие */}
        <div className="flex items-end justify-between pt-1.5">
          <div>
            {/* PR-4: зачёркнутая old_price — только реальная скидка (old_price > price) */}
            {hasRealDiscount(product) && product.oldPrice !== undefined && (
              <div className="text-xs text-muted-foreground line-through">
                {formatCurrency(product.oldPrice)}
              </div>
            )}
            <div className="font-bold text-lg text-foreground tracking-tight">
              {/* PR-4: маркер «от» — цена базовая, опции могут её повысить */}
              {isFromPrice(product) && (
                <span
                  className="text-primary mr-0.5 text-sm font-semibold"
                  title="Итоговая цена зависит от выбранных опций"
                >
                  от
                </span>
              )}
              {formatCurrency(product.price)}
            </div>
          </div>
          <Button
            size="icon"
            onClick={handleAddToCart}
            disabled={product.isAvailable === false}
            aria-disabled={product.isAvailable === false}
            title={product.isAvailable === false ? "Нет в наличии" : "Добавить в корзину"}
            className="h-10 w-10 shrink-0 rounded-xl"
            aria-label="Добавить в корзину"
          >
            <ShoppingCart className="h-4.5 w-4.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
