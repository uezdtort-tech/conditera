"use client";

import { useAppStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, ShoppingCart, Star, Check, Calendar, Cake, Image as ImageIcon, Scale, SlidersHorizontal } from "lucide-react";
import {
  formatCurrency,
  getProductPaymentOptions,
  formatInstallmentPlan,
} from "@/lib/finance";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ProductCardProps {
  product: Product;
  variant?: "default" | "compact";
  onCompare?: () => void;
  isCompared?: boolean;
}

export function ProductCard({ product, variant = "default", onCompare, isCompared = false }: ProductCardProps) {
  const navigate = useAppStore((s) => s.navigate);
  const addToCart = useAppStore((s) => s.addToCart);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const isFavorite = useAppStore((s) => s.isFavorite(product.id));
  const confectioners = useAppStore((s) => s.confectioners);
  const confectioner = confectioners.find((c) => c.id === product.confectionerId);
  const slicePreview = product.slices?.find((slice) => Boolean(slice.image));
  const paymentOptions = getProductPaymentOptions(product, confectioner);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (product.isAvailable === false) return;
    addToCart(product);
  };

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(product.id);
  };

  const handleCompare = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCompare?.();
  };

  const handleCustomize = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate("product", { id: product.id, customize: "true" });
  };

  const hasCustomization = Boolean(product.fillings?.length);

  return (
    <Card
      onClick={() => navigate("product", { id: product.id })}
      className="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border-border/80 bg-card p-0 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-foreground/10"
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-muted">
        {product.images?.[0] ? (
          <img
            src={product.images[0]}
            alt={product.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary via-muted to-accent/40">
            <Cake className="h-14 w-14 text-muted-foreground/30" aria-hidden />
          </div>
        )}

        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <div className="flex flex-wrap gap-1.5">
            {product.isAvailable === false && <Badge className="border-0 bg-foreground/80 text-background shadow-sm">Нет в наличии</Badge>}
            {product.isHit && <Badge className="border-0 bg-primary text-primary-foreground shadow-sm">Хит</Badge>}
            {product.isNew && <Badge className="border-0 bg-emerald-700 text-white shadow-sm">Новинка</Badge>}
            {product.isPopular && !product.isHit && <Badge className="border-0 bg-amber-600 text-white shadow-sm">Популярное</Badge>}
            {product.oldPrice && product.oldPrice > product.price && (
              <Badge className="border-0 bg-rose-700 text-white shadow-sm">
                −{Math.round((1 - product.price / product.oldPrice) * 100)}%
              </Badge>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {onCompare && (
              <button
                type="button"
                onClick={handleCompare}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full border shadow-md backdrop-blur transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isCompared
                    ? "border-purple-600 bg-purple-600 text-white"
                    : "border-white/50 bg-white/90 text-foreground hover:bg-white"
                )}
                aria-label={isCompared ? "Убрать из сравнения" : "Добавить к сравнению"}
                aria-pressed={isCompared}
                title={isCompared ? "Убрать из сравнения" : "Добавить к сравнению"}
              >
                <Scale className="h-[18px] w-[18px]" />
              </button>
            )}
          <button
            type="button"
            onClick={handleFavorite}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/50 bg-white/90 text-foreground shadow-md backdrop-blur transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={isFavorite ? "Убрать из избранного" : "В избранное"}
            aria-pressed={isFavorite}
          >
            <Heart className={cn("h-[18px] w-[18px] transition-colors", isFavorite ? "fill-primary text-primary" : "text-foreground/70")} />
          </button>
          </div>
        </div>

        {slicePreview?.image && (
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-xl border border-white/70 bg-white/95 p-1.5 pr-3 shadow-lg backdrop-blur">
            <img
              src={slicePreview.image}
              alt={slicePreview.caption || `Разрез торта «${product.title}»`}
              loading="lazy"
              decoding="async"
              className="h-12 w-12 rounded-lg object-cover"
            />
            <span className="flex flex-col text-xs font-medium leading-tight text-stone-700">
              <span className="flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5" />
                Разрез
              </span>
              {slicePreview.fillingName && <span className="max-w-28 truncate text-[10px] font-normal text-stone-500">{slicePreview.fillingName}</span>}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
        <div className="flex min-h-5 items-center justify-between gap-3">
          {confectioner ? (
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <Avatar className="h-5 w-5 shrink-0">
                <AvatarImage src={confectioner.avatar} alt={confectioner.businessName} />
                <AvatarFallback className="text-[9px]">{confectioner.businessName.slice(0, 2)}</AvatarFallback>
              </Avatar>
              <span className="truncate">{confectioner.businessName}</span>
              {confectioner.verified && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-label="Проверенный кондитер" />}
            </div>
          ) : <span className="text-xs text-muted-foreground">Авторский десерт</span>}
          <div className="flex shrink-0 items-center gap-1 text-xs">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
            <span className="font-semibold tabular-nums">{product.rating.toFixed(1)}</span>
            <span className="text-muted-foreground">({product.reviewsCount})</span>
          </div>
        </div>

        <div className="space-y-1">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug tracking-tight text-foreground transition-colors group-hover:text-primary sm:text-[17px]">
            {product.title}
          </h3>
          {variant === "default" && (product.shortDescription || product.description) && (
            <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {product.shortDescription || product.description}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {product.weight && <span>{product.weight}</span>}
          {product.servings && <span>{product.servings} порций</span>}
          {product.prepTime && <span>Изготовление: {product.prepTime}</span>}
        </div>

        {(product.dietaryFeatures?.length || product.ecoBadges?.length) ? (
          <div className="flex flex-wrap gap-1.5">
            {[...(product.dietaryFeatures ?? []), ...(product.ecoBadges ?? [])].slice(0, 3).map((label) => (
              <Badge key={label} variant="secondary" className="rounded-full px-2.5 py-1 text-[10px] font-medium">{label}</Badge>
            ))}
          </div>
        ) : null}

        {(paymentOptions.installment || paymentOptions.split) && (
          <div className="flex flex-wrap gap-1.5 border-t border-border/70 pt-2">
            {paymentOptions.installment && paymentOptions.installments[0] && (
              <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[10px] text-rose-800">
                <Calendar className="mr-1 h-3 w-3" />
                {formatInstallmentPlan(paymentOptions.installments[0], product.price)}
              </Badge>
            )}
            {paymentOptions.split && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">Сплит</Badge>}
          </div>
        )}

        {hasCustomization && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleCustomize}
            className="w-full gap-2 rounded-xl"
            aria-label={`Настроить ${product.title}`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Настроить
          </Button>
        )}

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-border/70 pt-3">
          <div className="min-w-0">
            {product.oldPrice && product.oldPrice > product.price && (
              <div className="text-xs text-muted-foreground line-through">{formatCurrency(product.oldPrice)}</div>
            )}
            <div className="font-display text-xl font-bold leading-tight tracking-tight text-foreground sm:text-2xl">
              {formatCurrency(product.price)}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">Цена за изделие</div>
          </div>
          <Button
            size="lg"
            onClick={handleAddToCart}
            disabled={product.isAvailable === false}
            aria-disabled={product.isAvailable === false}
            title={product.isAvailable === false ? "Нет в наличии" : "Добавить в корзину"}
            className="h-11 shrink-0 gap-2 rounded-xl px-4 shadow-sm"
            aria-label="Добавить в корзину"
          >
            <ShoppingCart className="h-4 w-4" />
            <span className="hidden sm:inline">В корзину</span>
          </Button>
        </div>
      </div>
    </Card>
  );
}
