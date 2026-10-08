"use client";

/**
 * «Понравился этот торт?» — полоса похожих товаров в карточке
 * ВЫПОЛНЕННОГО заказа (P2.3, ТЗ §10).
 *
 * Источник — GET /api/products/[id]/similar (детерминированный движок,
 * те же причины). Открывается по кнопке «Похожие товары», чтобы не
 * перегружать карточку заказа; «Повторить заказ» остаётся рядом (P1).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Heart, Sparkles } from "lucide-react";
import { formatCurrency } from "@/lib/finance";

interface SimilarApiItem {
  id: string;
  title: string;
  price: number;
  images: string[];
  rating: number;
  reviewsCount: number;
  reasons: string[];
}

interface OrderSimilarStripProps {
  orderId: string;
  productId: string;
}

export function OrderSimilarStrip({ orderId, productId }: OrderSimilarStripProps): React.JSX.Element | null {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  // Переход на товар: /dashboard — отдельный роут, SPA-navigate здесь
  // сбрасывается guard'ом дашборда. /product?id — реальный Next-роут
  // (RouteFallback view="product"), deep link работает напрямую.
  const openProduct = React.useCallback(
    (id: string) => {
      router.push(`/product?id=${encodeURIComponent(id)}`);
    },
    [router]
  );

  // Похожесть считается по товару заказа; данные карточки — из API
  // (на дашборде live-стор товаров может быть не гидрирован)
  const { data, isLoading } = useQuery({
    queryKey: ["order-similar", orderId, productId],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}/similar?limit=3`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { items: SimilarApiItem[] };
    },
    enabled: open,
    staleTime: 60_000,
    retry: 1,
  });

  const rows = data?.items ?? [];

  return (
    <div className="pt-3 border-t">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <Heart className="h-4 w-4 text-rose-500" aria-hidden />
        Понравился этот торт? Похожие товары
        {open ? (
          <ChevronUp className="h-4 w-4" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4" aria-hidden />
        )}
      </button>

      {open && (
        <div className="mt-3">
          {isLoading && (
            <p className="text-xs text-muted-foreground">Подбираем похожие…</p>
          )}
          {!isLoading && rows.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Пока не нашлось похожих товаров
            </p>
          )}
          <div className="flex gap-3 overflow-x-auto pb-1">
            {rows.map((item) => {
              const image = item.images?.[0];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openProduct(item.id)}
                  className="shrink-0 w-40 text-left rounded-lg border p-2 hover:shadow-md transition-shadow bg-card"
                >
                  <div className="aspect-square rounded-md bg-muted overflow-hidden mb-2">
                    {image ? (
                      <img
                        src={image}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}
                  </div>
                  <div className="text-xs font-medium line-clamp-2 mb-1 min-h-[2rem]">
                    {item.title}
                  </div>
                  <div className="text-sm font-semibold mb-1">
                    {formatCurrency(item.price)}
                  </div>
                  {item.reasons.length > 0 && (
                    <p className="text-[10px] text-muted-foreground flex items-start gap-1 line-clamp-2">
                      <Sparkles className="h-2.5 w-2.5 mt-0.5 shrink-0 text-primary" aria-hidden />
                      <span>{item.reasons[0]}</span>
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
