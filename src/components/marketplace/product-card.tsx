"use client";

import { useAppStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, ShoppingCart, Star, Check, Calendar } from "lucide-react";
import {
  formatCurrency,
  TRUST_LEVELS,
  getProductPaymentOptions,
  formatInstallmentPlan,
} from "@/lib/finance";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TiltCard } from "@/components/ui/modern-effects";

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

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    addToCart(product);
  };

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(product.id);
  };

  return (
    <TiltCard className="h-full">
    <Card
      onClick={() => navigate("product", { id: product.id })}
      className="group relative overflow-hidden cursor-pointer border-border hover:border-primary/40 hover:shadow-xl transition-all duration-300 p-0 h-full"
    >
      {/* Image */}
      <div className="relative aspect-square overflow-hidden bg-muted">
        <img
          src={product.images[0]}
          alt={product.title}
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" decoding="async" />

        {/* Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {product.isHit && (
            <Badge className="bg-primary text-primary-foreground text-[10px] px-2 py-0.5">
              Хит
            </Badge>
          )}
          {product.isNew && (
            <Badge className="bg-emerald-600 text-white text-[10px] px-2 py-0.5">
              Новинка
            </Badge>
          )}
          {product.isPopular && !product.isHit && (
            <Badge className="bg-amber-500 text-white text-[10px] px-2 py-0.5">
              Популярное
            </Badge>
          )}
          {product.oldPrice && (
            <Badge className="bg-red-500 text-white text-[10px] px-2 py-0.5">
              -{Math.round((1 - product.price / product.oldPrice) * 100)}%
            </Badge>
          )}
        </div>

        {/* Favorite */}
        <button
          onClick={handleFavorite}
          className="absolute top-2 right-2 h-8 w-8 rounded-full bg-background/90 backdrop-blur flex items-center justify-center hover:bg-background shadow-sm transition-colors"
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
      <div className="p-3 sm:p-4 space-y-2">
        {/* Confectioner */}
        {confectioner && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Avatar className="h-4 w-4">
              <AvatarImage src={confectioner.avatar} alt={confectioner.businessName} />
              <AvatarFallback className="text-[8px]">
                {confectioner.businessName.slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{confectioner.businessName}</span>
            {confectioner.verified && (
              <Check className="h-3 w-3 text-primary fill-primary/20" />
            )}
          </div>
        )}

        {/* Title */}
        <h3 className="font-medium text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors min-h-[2.5rem]">
          {product.title}
        </h3>

        {variant === "default" && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {product.description}
          </p>
        )}

        {/* Rating & meta */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            <span className="font-medium">{product.rating.toFixed(1)}</span>
            <span className="text-muted-foreground">({product.reviewsCount})</span>
          </div>
          {product.weight && (
            <span className="text-muted-foreground">{product.weight}</span>
          )}
        </div>

        {/* Payment options */}
        {(() => {
          const opts = getProductPaymentOptions(product, confectioner);
          if (!opts.installment && !opts.split) return null;
          return (
            <div className="flex flex-wrap gap-1 pt-1 border-t">
              {opts.installment && opts.installments[0] && (
                <Badge variant="outline" className="text-[9px] bg-rose-50 text-rose-700 border-rose-200">
                  <Calendar className="h-2.5 w-2.5 mr-0.5" />
                  {formatInstallmentPlan(opts.installments[0], product.price)}
                </Badge>
              )}
              {opts.split && (
                <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200">
                  🔀 Сплит
                </Badge>
              )}
            </div>
          );
        })()}

        {/* Price & add */}
        <div className="flex items-end justify-between pt-1">
          <div>
            {product.oldPrice && (
              <div className="text-xs text-muted-foreground line-through">
                {formatCurrency(product.oldPrice)}
              </div>
            )}
            <div className="font-display font-bold text-base text-foreground">
              {formatCurrency(product.price)}
            </div>
          </div>
          <Button
            size="icon"
            onClick={handleAddToCart}
            className="h-9 w-9 shrink-0"
            aria-label="Добавить в корзину"
          >
            <ShoppingCart className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
    </TiltCard>
  );
}
