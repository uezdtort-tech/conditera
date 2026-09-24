"use client";

/**
 * RecommendationRail — карусель рекомендаций (раздел 15, 62).
 *
 * Горизонтальный скролл рекомендованных товаров.
 * Lazy-load через TanStack Query.
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Star, Sparkles } from "lucide-react";
import { formatCurrency } from "@/lib/finance";

export interface RecommendationItem {
  id: string;
  title: string;
  price: number;
  oldPrice?: number;
  imageUrl?: string;
  rating?: number;
  isFeatured?: boolean;
  reason?: string;
}

interface RecommendationRailProps {
  items: RecommendationItem[];
  title?: string;
  onItemClick?: (id: string) => void;
}

export function RecommendationRail({ items, title = "Рекомендуем", onItemClick }: RecommendationRailProps): React.JSX.Element {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const scroll = (dir: "left" | "right"): void => {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -300 : 300, behavior: "smooth" });
  };

  if (items.length === 0) return <></>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-display font-bold text-lg">{title}</h3>
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => scroll("left")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => scroll("right")}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide"
        style={{ scrollbarWidth: "none" }}
      >
        {items.map((item) => (
          <Card
            key={item.id}
            className="shrink-0 w-48 overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => onItemClick?.(item.id)}
          >
            <div className="aspect-square bg-muted relative">
              {item.imageUrl && (
                <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
              )}
              {item.isFeatured && (
                <Badge className="absolute top-2 left-2 text-[9px]">
                  <Sparkles className="h-2.5 w-2.5 mr-0.5" /> Хит
                </Badge>
              )}
            </div>
            <div className="p-2">
              <h4 className="text-xs font-medium line-clamp-2 mb-1">{item.title}</h4>
              {item.reason && (
                <p className="text-[10px] text-muted-foreground mb-1 line-clamp-1">{item.reason}</p>
              )}
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs">{formatCurrency(item.price)}</span>
                {item.rating !== undefined && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                    {item.rating.toFixed(1)}
                  </span>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
