"use client";

/**
 * VideoProductCard — карточка товара с видео (раздел 8, 62).
 *
 * Lazy-load видео через Intersection Observer.
 * Commerce actions: VIEW, SAVE, CUSTOMIZE.
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, Heart, Sparkles, Eye } from "lucide-react";
import { formatCurrency } from "@/lib/finance";

export interface VideoProductData {
  id: string;
  title: string;
  price: number;
  oldPrice?: number;
  imageUrl?: string;
  videoUrl?: string;
  rating?: number;
  reviewsCount?: number;
  dietary?: string[];
  isFeatured?: boolean;
}

interface VideoProductCardProps {
  product: VideoProductData;
  onSave?: () => void;
  onCustomize?: () => void;
  onView?: () => void;
}

export function VideoProductCard({ product, onSave, onCustomize, onView }: VideoProductCardProps): React.JSX.Element {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = React.useState(false);
  const [isPlaying, setIsPlaying] = React.useState(false);

  React.useEffect(() => {
    if (!containerRef.current || !product.videoUrl) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.5 }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [product.videoUrl]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !product.videoUrl) return;
    if (isVisible && !isPlaying) {
      video.play().catch(() => {});
    } else if (!isVisible && isPlaying) {
      video.pause();
    }
  }, [isVisible, isPlaying, product.videoUrl]);

  return (
    <Card ref={containerRef} className="overflow-hidden group cursor-pointer hover:shadow-lg transition-shadow">
      <div className="relative aspect-square bg-muted" onClick={onView}>
        {product.videoUrl && isVisible ? (
          <video
            ref={videoRef}
            src={product.videoUrl}
            className="w-full h-full object-cover"
            muted
            loop
            playsInline
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        ) : (
          <>
            {product.imageUrl && (
              <img src={product.imageUrl} alt={product.title} className="w-full h-full object-cover" loading="lazy" />
            )}
            {product.videoUrl && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <Play className="h-12 w-12 text-white" />
              </div>
            )}
          </>
        )}

        {product.isFeatured && (
          <Badge className="absolute top-2 left-2 bg-primary text-[10px]">
            <Sparkles className="h-3 w-3 mr-1" />
            Рекомендуем
          </Badge>
        )}

        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={(e) => { e.stopPropagation(); onSave?.(); }}>
            <Heart className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="p-3">
        <h3 className="font-medium text-sm line-clamp-2 mb-1" onClick={onView}>{product.title}</h3>

        <div className="flex items-center gap-2 mb-2">
          <span className="font-bold text-sm">{formatCurrency(product.price)}</span>
          {product.oldPrice && (
            <span className="text-xs text-muted-foreground line-through">{formatCurrency(product.oldPrice)}</span>
          )}
        </div>

        {product.dietary && product.dietary.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {product.dietary.slice(0, 2).map((d, i) => (
              <Badge key={i} variant="outline" className="text-[9px]">{d}</Badge>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          {product.rating !== undefined && (
            <span className="text-xs text-muted-foreground">⭐ {product.rating.toFixed(1)}</span>
          )}
          {onCustomize && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCustomize}>
              <Sparkles className="h-3 w-3 mr-1" />
              Свой
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
