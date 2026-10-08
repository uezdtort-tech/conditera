"use client";

/**
 * Похожие товары на карточке товара (P2.3, ТЗ §9).
 *
 * Источник причин — GET /api/products/[id]/similar: детерминированный
 * движок recommendations.ts. Каждая карточка несёт фактическую причину
 * («Похожая категория», «От того же кондитера», «Похожий вкус: …») —
 * никаких «AI считает, что вам понравится». Рендер — обычный ProductCard
 * из live-стора; причина — строкой под карточкой.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { ProductCard } from "@/components/marketplace/product-card";
import { Skeleton } from "@/components/ui/skeleton";

interface SimilarApiItem {
  id: string;
  reasons: string[];
}

interface SimilarRow {
  item: SimilarApiItem;
  productId: string;
}

export function SimilarProductsBlock({ productId }: { productId: string }): React.JSX.Element | null {
  const products = useAppStore((s) => s.products);

  const { data, isLoading } = useQuery({
    queryKey: ["similar-products", productId],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}/similar?limit=4`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { items: SimilarApiItem[] };
    },
    enabled: Boolean(productId),
    staleTime: 60_000,
    retry: 1,
  });

  const byId = React.useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const rows: SimilarRow[] = React.useMemo(
    () =>
      (data?.items ?? [])
        .filter((it) => byId.has(it.id))
        .map((it) => ({ item: it, productId: it.id })),
    [data, byId]
  );

  if (isLoading) {
    return (
      <div className="mt-8" aria-hidden>
        <div className="h-6 w-56 bg-muted rounded mb-4 animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-square rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0) return null;

  return (
    <section className="mt-8" aria-label="Похожие товары">
      <h2 className="font-display text-xl font-bold mb-4">Похожие товары</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {rows.map(({ item, productId: pid }) => {
          const product = byId.get(pid);
          if (!product) return null;
          return (
            <div key={pid} className="flex flex-col gap-1.5">
              <ProductCard product={product} />
              {item.reasons.length > 0 && (
                <p className="text-[11px] text-muted-foreground flex items-start gap-1 line-clamp-2">
                  <Sparkles className="h-3 w-3 mt-0.5 shrink-0 text-primary" aria-hidden />
                  <span>
                    Потому что: {item.reasons.join(" · ").toLowerCase()}
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
