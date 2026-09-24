"use client";

import { useAppStore } from "@/lib/store";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search,
  Clock,
  Users,
  Heart,
  Eye,
  MessageCircle,
  Play,
  BookOpen,
  ChefHat,
  Sparkles,
  Lock,
  ChevronLeft,
  Star,
} from "lucide-react";
import { RECIPE_DIFFICULTY_INFO } from "@/lib/mock-data-extra";
import { formatCurrency, formatDate } from "@/lib/finance";
import type { RecipeType, RecipeDifficulty } from "@/lib/types";

const TYPE_INFO: Record<RecipeType, { label: string; icon: typeof BookOpen; color: string }> = {
  recipe: { label: "Рецепт", icon: BookOpen, color: "bg-blue-100 text-blue-800" },
  master_class: { label: "Мастер-класс", icon: ChefHat, color: "bg-purple-100 text-purple-800" },
  video_lesson: { label: "Видеоурок", icon: Play, color: "bg-rose-100 text-rose-800" },
  article: { label: "Статья", icon: BookOpen, color: "bg-emerald-100 text-emerald-800" },
};

export function RecipesPage() {
  const navigate = useAppStore((s) => s.navigate);
  const recipes = useAppStore((s) => s.recipes);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [difficultyFilter, setDifficultyFilter] = useState<string>("all");
  const [accessFilter, setAccessFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState("popular");

  const filtered = useMemo(() => {
    let result = recipes.filter((r) => {
      if (!r.published) return false;
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
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (difficultyFilter !== "all" && r.difficulty !== difficultyFilter) return false;
      if (accessFilter !== "all" && r.access !== accessFilter) return false;
      return true;
    });

    switch (sortBy) {
      case "newest":
        result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case "rated":
        result.sort((a, b) => b.likes - a.likes);
        break;
      case "popular":
      default:
        result.sort((a, b) => b.views - a.views);
    }

    return result;
  }, [recipes, search, typeFilter, difficultyFilter, accessFilter, sortBy]);

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
        <h1 className="font-display text-2xl lg:text-3xl font-bold mb-2">
          Рецепты и мастер-классы от кондитеров
        </h1>
        <p className="text-muted-foreground">
          {filtered.length} материалов от лучших кондитеров платформы.
          Бесплатные и платные рецепты, видеоуроки и статьи.
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
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Тип" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="recipe">Рецепты</SelectItem>
            <SelectItem value="master_class">Мастер-классы</SelectItem>
            <SelectItem value="video_lesson">Видеоуроки</SelectItem>
            <SelectItem value="article">Статьи</SelectItem>
          </SelectContent>
        </Select>
        <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Сложность" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Любая сложность</SelectItem>
            <SelectItem value="easy">Легко</SelectItem>
            <SelectItem value="medium">Средне</SelectItem>
            <SelectItem value="hard">Сложно</SelectItem>
            <SelectItem value="expert">Эксперт</SelectItem>
          </SelectContent>
        </Select>
        <Select value={accessFilter} onValueChange={setAccessFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Доступ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Любой доступ</SelectItem>
            <SelectItem value="free">Бесплатные</SelectItem>
            <SelectItem value="paid">Платные</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Сортировка" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">Популярные</SelectItem>
            <SelectItem value="newest">Новые</SelectItem>
            <SelectItem value="rated">По лайкам</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Quick type filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setTypeFilter("all")}
          className={`px-3 py-1 text-xs rounded-full border ${
            typeFilter === "all"
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border hover:border-primary/40"
          }`}
        >
          Все
        </button>
        {Object.entries(TYPE_INFO).map(([key, info]) => (
          <button
            key={key}
            onClick={() => setTypeFilter(key)}
            className={`px-3 py-1 text-xs rounded-full border flex items-center gap-1 ${
              typeFilter === key
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border hover:border-primary/40"
            }`}
          >
            <info.icon className="h-3 w-3" />
            {info.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Search className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-1">Ничего не найдено</h3>
          <p className="text-sm text-muted-foreground">Измените параметры поиска</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((recipe) => {
            const typeInfo = TYPE_INFO[recipe.type];
            const diffInfo = RECIPE_DIFFICULTY_INFO[recipe.difficulty];
            const TypeIcon = typeInfo.icon;
            return (
              <Card
                key={recipe.id}
                className="overflow-hidden p-0 hover:shadow-lg transition-shadow cursor-pointer group"
                onClick={() => navigate("recipe-detail", { id: recipe.id })}
              >
                <div className="relative aspect-video bg-muted overflow-hidden">
                  <img
                    src={recipe.coverImage}
                    alt={recipe.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" decoding="async" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  {/* Type badge */}
                  <Badge className={`absolute top-2 left-2 ${typeInfo.color}`}>
                    <TypeIcon className="h-3 w-3 mr-1" />
                    {typeInfo.label}
                  </Badge>
                  {/* Access badge */}
                  {recipe.access === "paid" && (
                    <Badge className="absolute top-2 right-2 bg-amber-500 text-white">
                      <Lock className="h-3 w-3 mr-1" />
                      {formatCurrency(recipe.price || 0)}
                    </Badge>
                  )}
                  {recipe.access === "free" && (
                    <Badge className="absolute top-2 right-2 bg-emerald-500 text-white">
                      Бесплатно
                    </Badge>
                  )}
                  {/* Video play icon */}
                  {recipe.videoUrl && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="h-12 w-12 rounded-full bg-white/80 backdrop-blur flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Play className="h-6 w-6 text-primary fill-primary ml-1" />
                      </div>
                    </div>
                  )}
                  {/* Title */}
                  <div className="absolute bottom-2 left-3 right-3">
                    <h3 className="font-display font-bold text-white text-base line-clamp-2 drop-shadow">
                      {recipe.title}
                    </h3>
                  </div>
                </div>

                <div className="p-3 space-y-2">
                  {/* Confectioner */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={recipe.confectionerAvatar} alt={recipe.confectionerName} />
                      <AvatarFallback className="text-[9px]">
                        {recipe.confectionerName.slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{recipe.confectionerName}</span>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {recipe.description}
                  </p>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1">
                    {recipe.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">
                        #{tag}
                      </Badge>
                    ))}
                  </div>

                  {/* Meta */}
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t text-xs">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-0.5 text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {recipe.totalTime < 60
                          ? `${recipe.totalTime}м`
                          : `${Math.floor(recipe.totalTime / 60)}ч ${recipe.totalTime % 60}м`}
                      </div>
                    </div>
                    <div className="text-center border-x">
                      <Badge variant="outline" className={`text-[10px] ${diffInfo.color}`}>
                        {diffInfo.label}
                      </Badge>
                    </div>
                    <div className="text-center text-muted-foreground">
                      <Users className="h-3 w-3 inline mr-0.5" />
                      {recipe.servings} порц.
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-0.5">
                      <Eye className="h-3 w-3" />
                      {recipe.views}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Heart className="h-3 w-3" />
                      {recipe.likes}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <MessageCircle className="h-3 w-3" />
                      {recipe.comments}
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
          платные мастер-классы. Получайте лайки и комментарии от пользователей.
        </p>
        <Button onClick={() => navigate("dashboard-confectioner", { tab: "recipes" })}>
          Опубликовать рецепт
        </Button>
      </Card>
    </div>
  );
}
