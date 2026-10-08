"use client";

/**
 * «Вам может понравиться» на главной (P2.3, ТЗ §9 ⑥, §15).
 *
 * Источник — GET /api/recommendations (auth опционален):
 *   • авторизован и есть якоря (избранное / история заказов) →
 *     персональные рекомендации с причинами «Похоже на то, что вы…»;
 *   • иначе блок НЕ показывается — на главной уже есть честное
 *     «Популярные товары», дублировать его fallback-ом не нужно.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { ProductCard } from "@/components/marketplace/product-card";
import { getSessionAuthHeaders } from "@/lib/api-client";

interface ForYouApiItem {
  id: string;
  reasons: string[];
}

interface ForYouResponse {
  items: ForYouApiItem[];
  personalized: boolean;
}

export function ForYouBlock(): React.JSX.Element | null {
  const products = useAppStore((s) => s.products);

  const { data, isLoading } = useQuery({
    queryKey: ["for-you-recommendations"],
    queryFn: async () => {
      const headers = await getSessionAuthHeaders();
      const res = await fetch("/api/recommendations?limit=4", {
        headers,
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ForYouResponse;
    },
    staleTime: 60_000,
    retry: 1,
  });

  const byId = React.useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const rows = React.useMemo(
    () =>
      (data?.personalized ? data.items : []).filter((it) => byId.has(it.id)),
    [data, byId]
  );

  if (isLoading) return null; // персональный блок не мигает скелетом
  if (rows.length === 0) return null;

  return (
    <section className="container mx-auto px-4" aria-label="Вам может понравиться">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Подобрано для вас
          </span>
        </div>
        <h2 className="font-display text-2xl sm:text-3xl font-bold">
          Вам может понравиться
        </h2>
        <p className="text-muted-foreground mt-1">
          На основе ваших заказов и избранного — с объяснением, почему
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {rows.map((item) => {
          const product = byId.get(item.id);
          if (!product) return null;
          return (
            <div key={item.id} className="flex flex-col gap-1.5">
              <ProductCard product={product} />
              {item.reasons.length > 0 && (
                <p className="text-[11px] text-muted-foreground flex items-start gap-1 line-clamp-2">
                  <Sparkles className="h-3 w-3 mt-0.5 shrink-0 text-primary" aria-hidden />
                  <span>{item.reasons.join(" · ")}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
