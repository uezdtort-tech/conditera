"use client";

/**
 * AiCompareDialog — сравнение выбранных тортов через ИИ (сценарий №2).
 *
 * Покупатель отмечает 2-4 товара в каталоге → ИИ сравнивает их простым языком
 * по данным карточек (цена, вес, порции, рейтинг) и подсказывает, какой товар
 * под какой сценарий подходит — без «объективного рейтинга качества».
 */
import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Scale, Info, X } from "lucide-react";
import { toast } from "sonner";
import { getCsrfToken } from "@/lib/api-client";
import type { Product } from "@/lib/types";

interface ComparisonResult {
  summary: string;
  perProduct: Array<{ id: string; summary: string }>;
  bestFor: Array<{ id: string; when: string }>;
}

interface AiCompareDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: Product[];
  onRemove: (id: string) => void;
}

/** Snapshot карточки для серверного фоллбэка (когда БД витрины недоступна) */
function toSnapshot(p: Product) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    price: p.price,
    oldPrice: p.oldPrice,
    weight: p.weight,
    servings: p.servings,
    tags: p.tags,
    rating: p.rating,
    reviewsCount: p.reviewsCount,
  };
}

export function AiCompareDialog({ open, onOpenChange, products, onRemove }: AiCompareDialogProps) {
  const [loading, setLoading] = useState(false);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [generatedBy, setGeneratedBy] = useState<string>("llm");

  useEffect(() => {
    if (!open || products.length < 2) return;
    let cancelled = false;
    setLoading(true);
    setComparison(null);

    (async () => {
      try {
        // CSRF double-submit: мутации требуют header x-csrf-token
        const csrf = await getCsrfToken();
        const res = await fetch("/api/ai/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify({
            productIds: products.map((p) => p.id),
            products: products.map(toSnapshot),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || "Не удалось сравнить товары");
        }
        const data = (await res.json()) as { comparison: ComparisonResult; generatedBy: string };
        if (cancelled) return;
        setComparison(data.comparison);
        setGeneratedBy(data.generatedBy || "llm");
      } catch (e: unknown) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Ошибка сравнения");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, products.map((p) => p.id).join(",")]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-purple-600" />
            Сравнение тортов
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {products.length} товара
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Сравнение по данным карточек. Решение — за вами, а даты и наличие подтверждает мастер.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[55vh] pr-2">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
              ИИ сравнивает выбранные товары…
            </div>
          ) : comparison ? (
            <div className="space-y-4">
              {generatedBy === "rules" && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  разбор без ИИ — показаны факты из карточек
                </Badge>
              )}

              {comparison.summary && (
                <p className="text-sm leading-relaxed rounded-lg bg-purple-50 dark:bg-purple-950/30 p-3 text-foreground">
                  {comparison.summary}
                </p>
              )}

              <div className="space-y-2">
                {products.map((p) => {
                  const per = comparison.perProduct?.find((x) => x.id === p.id);
                  const best = comparison.bestFor?.find((x) => x.id === p.id);
                  return (
                    <div key={p.id} className="flex gap-3 rounded-lg border p-3">
                      {p.images?.[0] && (
                        <img
                          src={p.images[0]}
                          alt={p.title}
                          className="h-16 w-16 rounded-md object-cover shrink-0"
                          loading="lazy"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium leading-snug">{p.title}</span>
                          <button
                            type="button"
                            onClick={() => onRemove(p.id)}
                            className="text-muted-foreground hover:text-foreground shrink-0"
                            aria-label={`Убрать ${p.title} из сравнения`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {per?.summary && (
                          <p className="text-xs text-muted-foreground mt-1">{per.summary}</p>
                        )}
                        {best?.when && (
                          <Badge variant="outline" className="text-[10px] mt-1.5 bg-amber-50 text-amber-700 border-amber-200">
                            {best.when}
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                ИИ сравнивает только по данным карточек и не оценивает «качество»:
                рейтинг — это отзывы покупателей, а не вердикт ИИ.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Отметьте минимум 2 товара в каталоге, чтобы сравнить их.
            </p>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
