"use client";

/**
 * my-purchased-recipes.tsx — вкладка «Мои рецепты» дашборда покупателя
 * (RECIPE-03, РЕШ-6: список entitlements из реального API).
 *
 * Данные: GET /api/recipes/purchases (csrfFetch) — сервер отдаёт recipe_purchases
 * + серверно подтверждённые платежи; поле access вычисляет СЕРВЕР
 * ("full" | "revoked_refund" | "pending"). Клиент ничего не вычисляет о доступе.
 *
 * Переход к рецепту — SPA-навигация store, как из каталога:
 * navigate("recipe-detail", { id: recipe_id }) (см. recipes-catalog.tsx:286).
 */

import { useAppStore } from "@/lib/store";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ChefHat, BookOpen, Loader2, RefreshCw, AlertTriangle, ChevronRight } from "lucide-react";
import { csrfFetch } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/finance";

/** Строка ответа GET /api/recipes/purchases (контракт API, snake_case). */
interface PurchasedRecipeRow {
  id: string;
  recipe_id: string;
  recipe_title: string;
  recipe_slug: string;
  recipe_image: string | null;
  price_paid: number | string | null;
  is_active: boolean;
  payment_status: string;
  refund_amount: number | null;
  recipe_version_id: string | null;
  purchased_at: string;
  access: "full" | "revoked_refund" | "pending";
}

const ACCESS_BADGES: Record<PurchasedRecipeRow["access"], { label: string; className: string }> = {
  full: { label: "Доступ открыт", className: "bg-emerald-100 text-emerald-800 border-transparent" },
  pending: { label: "Ожидает оплаты", className: "bg-amber-100 text-amber-800 border-transparent" },
  revoked_refund: { label: "Доступ отозван", className: "bg-muted text-muted-foreground border-transparent" },
};

function toPriceLabel(price: number | string | null): string {
  const n = typeof price === "string" ? Number(price) : price;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "—";
  return formatCurrency(n);
}

export function MyPurchasedRecipes() {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);

  const purchasesQuery = useQuery({
    queryKey: ["my-recipe-purchases"],
    enabled: Boolean(user),
    queryFn: async (): Promise<PurchasedRecipeRow[]> => {
      const res = await csrfFetch("/api/recipes/purchases");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || "Не удалось загрузить купленные рецепты");
      }
      return (Array.isArray(json?.data) ? json.data : []) as PurchasedRecipeRow[];
    },
  });

  // Загрузка — skeletons в структуре списка
  if (purchasesQuery.isPending) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Загрузка купленных рецептов">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-16 w-16 rounded-lg shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  // Ошибка API — честное сообщение + повтор
  if (purchasesQuery.isError) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Не удалось загрузить купленные рецепты</AlertTitle>
        <AlertDescription>
          {purchasesQuery.error instanceof Error
            ? purchasesQuery.error.message
            : "Попробуйте ещё раз позже."}
          <Button
            variant="outline"
            size="sm"
            className="mt-2 min-h-11"
            onClick={() => purchasesQuery.refetch()}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Повторить
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const rows = purchasesQuery.data ?? [];

  // Пустое состояние — без купленных рецептов
  if (rows.length === 0) {
    return (
      <Card className="p-12 text-center">
        <BookOpen className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
        <h3 className="font-semibold mb-1">У вас пока нет купленных рецептов</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Купите авторский рецепт — он появится здесь, а полный доступ откроется навсегда
        </p>
        <Button onClick={() => navigate("recipes")} className="min-h-11">
          Перейти в каталог рецептов
        </Button>
      </Card>
    );
  }

  return (
    <div className="max-h-96 overflow-y-auto space-y-3 pr-1">
      {rows.map((row) => {
        const badge = ACCESS_BADGES[row.access] ?? ACCESS_BADGES.pending;
        const title = row.recipe_title?.trim() || "Без названия";
        return (
          <Card key={row.id} className="overflow-hidden">
            <button
              type="button"
              onClick={() => navigate("recipe-detail", { id: row.recipe_id })}
              className="w-full flex items-center gap-3 p-3 sm:p-4 text-left min-h-11 hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Открыть рецепт: ${title}`}
            >
              {/* Превью или заглушка */}
              {row.recipe_image ? (
                <img
                  src={row.recipe_image}
                  alt={title}
                  className="h-16 w-16 rounded-lg object-cover shrink-0"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <ChefHat className="h-7 w-7 text-muted-foreground/50" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="font-medium line-clamp-2">{title}</div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {toPriceLabel(row.price_paid)}
                  </span>
                  <span aria-hidden="true">•</span>
                  <span>{row.purchased_at ? formatDate(row.purchased_at) : "—"}</span>
                </div>
                <Badge className={`mt-1.5 text-[10px] ${badge.className}`}>{badge.label}</Badge>
              </div>

              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          </Card>
        );
      })}

      {/* Обновление списка */}
      {purchasesQuery.isRefetching && (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          Обновляем…
        </p>
      )}
    </div>
  );
}
