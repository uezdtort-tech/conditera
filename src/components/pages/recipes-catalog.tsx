"use client";

/**
 * recipes-catalog.tsx — каталог маркетплейса авторских рецептов (реализация).
 *
 * ОТДЕЛЬНЫЙ файл (не recipes-page.tsx) сознательно: recipes-page.tsx превращён
 * в thin re-export для обратной совместимости (route-fallback, тесты), а
 * /recipes рендерит каталог напрямую через recipes-route.tsx — минуя
 * store-косвенность RouteFallback. Это даёт корректный SSR:/recipes отдаёт
 * контент рецептов сразу, а не HomePage из дефолтного store-view.
 *
 * Данные: GET /api/recipes/marketplace (реальная таблица БД recipe_marketplace,
 * миграция 0012) через TanStack Query + csrfFetch — проектный паттерн
 * (см. src/lib/use-real-products.ts). Раньше страница читала store.recipes,
 * засеянный из MOCK_RECIPES, и не делала ни одного запроса к API.
 *
 * Роутинг карточки — SPA-view: navigate("recipe-detail", { id }) с РЕАЛЬНЫМ
 * uuid из БД; карточку открывает recipe-detail-page.tsx через
 * GET /api/recipes/marketplace/[id].
 *
 * Честные состояния: skeleton при загрузке, error + «Повторить» при ошибке,
 * «Рецептов пока нет» при пустой БД (отдельно от «Ничего не найдено» по фильтрам).
 */

import { useAppStore } from "@/lib/store";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search,
  Clock,
  Eye,
  ChefHat,
  Sparkles,
  Lock,
  ChevronLeft,
  AlertTriangle,
  RefreshCw,
  Star,
} from "lucide-react";
import { formatCurrency } from "@/lib/finance";
import { csrfFetch } from "@/lib/api-client";
import {
  mapMarketplaceRowsToRecipes,
  type ApiRecipeMarketplaceRow,
} from "@/lib/recipe-view-model";
import type { Recipe, RecipeDifficulty } from "@/lib/types";

const DIFFICULTY_BADGE: Record<RecipeDifficulty, string> = {
  easy: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  hard: "bg-orange-100 text-orange-800",
  expert: "bg-red-100 text-red-800",
};

const DIFFICULTY_LABEL: Record<RecipeDifficulty, string> = {
  easy: "Легко",
  medium: "Средне",
  hard: "Сложно",
  expert: "Эксперт",
};

export function RecipesPage() {
  const navigate = useAppStore((s) => s.navigate);

  const [search, setSearch] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState<string>("all");
  const [accessFilter, setAccessFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState("popular");

  // Живой список опубликованных рецептов из БД (public endpoint).
  const recipesQuery = useQuery({
    queryKey: ["recipes-marketplace"],
    staleTime: 60_000,
    queryFn: async (): Promise<ApiRecipeMarketplaceRow[]> => {
      const res = await csrfFetch("/api/recipes/marketplace?sort=popular&limit=100");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || "Не удалось загрузить рецепты");
      }
      return Array.isArray(json?.data) ? json.data : [];
    },
  });

  const recipes = useMemo(
    () => mapMarketplaceRowsToRecipes(recipesQuery.data),
    [recipesQuery.data]
  );

  const filtered = useMemo(() => {
    let result = recipes.filter((r: Recipe) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.title.toLowerCase().includes(q) &&
          !r.description.toLowerCase().includes(q) &&
          !r.tags.some((t) => t.toLowerCase().includes(q))
        ) {
          return false;
        }
      }
      if (difficultyFilter !== "all") {
        const buckets: Record<string, RecipeDifficulty[]> = {
          easy: ["easy"],
          medium: ["medium"],
          hard: ["hard", "expert"],
        };
        if (!buckets[difficultyFilter]?.includes(r.difficulty)) return false;
      }
      if (accessFilter !== "all" && r.access !== accessFilter) return false;
      return true;
    });

    switch (sortBy) {
      case "newest":
        result.sort(
          (a, b) =>
            new Date(b.publishedAt ?? b.createdAt).getTime() -
            new Date(a.publishedAt ?? a.createdAt).getTime()
        );
        break;
      case "popular":
      default:
        result.sort((a, b) => b.views - a.views);
    }

    return result;
  }, [recipes, search, difficultyFilter, accessFilter, sortBy]);

  const isLoading = recipesQuery.isPending;
  const isError = recipesQuery.isError;
  const isEmptyDb = !isLoading && !isError && recipes.length === 0;
  const isFilteredEmpty = !isLoading && !isError && !isEmptyDb && filtered.length === 0;

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10">
      <button
        onClick={() => navigate("home")}
        className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        На главную
      </button>

      <div className="mb-6">
        <Badge className="mb-2 bg-purple-100 text-purple-800 border-purple-200">
          <ChefHat className="h-3 w-3 mr-1" />
          Рецепты и уроки
        </Badge>
        <h1 className="fade-up font-display text-2xl lg:text-3xl font-bold mb-2">
          Рецепты и мастер-классы от кондитеров
        </h1>
        <p className="text-muted-foreground">
          {isLoading
            ? "Загружаем авторские рецепты из маркетплейса…"
            : `${filtered.length} материалов от лучших кондитеров платформы. Бесплатные и платные рецепты и статьи.`}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск рецептов, тегов..."
            className="pl-10"
          />
        </div>
        <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Сложность" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Любая сложность</SelectItem>
            <SelectItem value="easy">Легко</SelectItem>
            <SelectItem value="medium">Средне</SelectItem>
            <SelectItem value="hard">Сложно и выше</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Сортировка" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">Популярные</SelectItem>
            <SelectItem value="newest">Новые</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Quick access filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[
          { key: "all", label: "Все" },
          { key: "free", label: "Бесплатные" },
          { key: "paid", label: "Платные" },
        ].map((chip) => (
          <button
            key={chip.key}
            onClick={() => setAccessFilter(chip.key)}
            className={`px-3 py-1 text-xs rounded-full border ${
              accessFilter === chip.key
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border hover:border-primary/40"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Loading — skeleton grid */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true" aria-label="Загрузка рецептов">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="overflow-hidden p-0">
              <Skeleton className="aspect-video w-full rounded-none" />
              <div className="p-3 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
                <div className="flex gap-2 pt-1">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Error — честная ошибка + повтор */}
      {isError && (
        <Card className="p-10 text-center" role="alert">
          <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-destructive" />
          <h3 className="font-semibold mb-1">Не удалось загрузить рецепты</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {recipesQuery.error instanceof Error
              ? recipesQuery.error.message
              : "Сервис маркетплейса рецептов недоступен. Попробуйте ещё раз."}
          </p>
          <Button onClick={() => recipesQuery.refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Повторить
          </Button>
        </Card>
      )}

      {/* Empty DB — честное «пусто», а не мок-данные */}
      {isEmptyDb && (
        <Card className="p-12 text-center">
          <ChefHat className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-1">Рецептов пока нет</h3>
          <p className="text-sm text-muted-foreground">
            Кондитеры ещё не опубликовали рецепты в маркетплейсе. Загляните позже —
            или опубликуйте первый рецепт сами.
          </p>
        </Card>
      )}

      {/* Filtered empty */}
      {isFilteredEmpty && (
        <Card className="p-12 text-center">
          <Search className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-1">Ничего не найдено</h3>
          <p className="text-sm text-muted-foreground">Измените параметры поиска</p>
        </Card>
      )}

      {/* Grid */}
      {!isLoading && !isError && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((recipe) => {
            const isPaid = recipe.access === "paid" && !!recipe.price;
            return (
              <Card
                key={recipe.id}
                className="overflow-hidden p-0 card-hover cursor-pointer group"
                onClick={() => navigate("recipe-detail", { id: recipe.id })}
                role="link"
                aria-label={`Открыть рецепт: ${recipe.title}`}
              >
                <div className="relative aspect-video bg-muted overflow-hidden">
                  {recipe.coverImage ? (
                    <img
                      src={recipe.coverImage}
                      alt={recipe.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" decoding="async" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-100 via-background to-accent/40">
                      <ChefHat className="h-10 w-10 text-muted-foreground/60" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  {/* Access badge */}
                  {isPaid ? (
                    <Badge className="absolute top-2 right-2 bg-amber-500 text-white">
                      <Lock className="h-3 w-3 mr-1" />
                      {formatCurrency(recipe.price || 0)}
                    </Badge>
                  ) : (
                    <Badge className="absolute top-2 right-2 bg-emerald-500 text-white">
                      Бесплатно
                    </Badge>
                  )}
                  {/* Title */}
                  <div className="absolute bottom-2 left-3 right-3">
                    <h3 className="font-display font-bold text-white text-base line-clamp-2 drop-shadow">
                      {recipe.title}
                    </h3>
                  </div>
                </div>

                <div className="p-3 space-y-2">
                  {/* Description */}
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {recipe.description}
                  </p>

                  {/* Tags */}
                  {recipe.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {recipe.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-[10px]">
                          #{tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Meta */}
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t text-xs">
                    <div className="text-center text-muted-foreground">
                      <Clock className="h-3 w-3 inline mr-0.5" />
                      {recipe.totalTime > 0
                        ? recipe.totalTime < 60
                          ? `${recipe.totalTime}м`
                          : `${Math.floor(recipe.totalTime / 60)}ч ${recipe.totalTime % 60}м`
                        : "—"}
                    </div>
                    <div className="text-center border-x">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${DIFFICULTY_BADGE[recipe.difficulty] ?? ""}`}
                      >
                        {DIFFICULTY_LABEL[recipe.difficulty]}
                      </Badge>
                    </div>
                    <div className="text-center text-muted-foreground">
                      <Star className="h-3 w-3 inline mr-0.5" />
                      {recipe.publishedAt
                        ? new Date(recipe.publishedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
                        : "—"}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-0.5">
                      <Eye className="h-3 w-3" />
                      {recipe.views}
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* CTA */}
      <Card className="mt-8 p-6 bg-gradient-to-br from-purple-50 to-accent/30 border-purple-200">
        <h3 className="font-display font-semibold mb-2 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-600" />
          Вы кондитер? Делитесь своими рецептами!
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          Публикуйте бесплатные рецепты для привлечения аудитории или продавайте
          платные мастер-классы в маркетплейсе рецептов.
        </p>
        <Button onClick={() => navigate("dashboard-confectioner", { tab: "recipes" })}>
          Опубликовать рецепт
        </Button>
      </Card>
    </div>
  );
}
