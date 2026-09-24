"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { formatCurrency, formatDate } from "@/lib/finance";
import {
  ChefHat, ShoppingBag, Coins, TrendingUp, Clock,
  Flame, Users, Target, Award, ChefHat as ChefIcon,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { toast } from "sonner";

const DIFFICULTY_LABELS: Record<string, { label: string; color: string }> = {
  easy: { label: "Легко", color: "bg-emerald-100 text-emerald-800" },
  medium: { label: "Средне", color: "bg-amber-100 text-amber-800" },
  hard: { label: "Сложно", color: "bg-red-100 text-red-800" },
};

const PIE_COLORS = ["#b8492e", "#d97706", "#0d9488", "#7c3aed", "#1e40af", "#be185d"];

interface RecipeStats {
  summary: {
    totalAcceptances: number;
    activeAcceptances: number;
    totalOrdersViaRecipes: number;
    totalRevenueFromRecipes: number;
    conversionRate: number;
    avgCheck: number;
  };
  topRecipes: any[];
  recentOrders: any[];
  acceptances: any[];
}

export function ConfectionerRecipeStatsTab({ confectionerId }: { confectionerId: string }) {
  const navigate = useAppStore((s) => s.navigate);
  const [data, setData] = useState<RecipeStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/confectioner/recipe-stats")
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [confectionerId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-bold">Статистика рецептов</h1>
        <Card className="p-8 text-center text-muted-foreground">
          Загрузка статистики...
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-bold">Статистика рецептов</h1>
        <Card className="p-8 text-center text-muted-foreground">
          Не удалось загрузить статистику
        </Card>
      </div>
    );
  }

  const { summary } = data;
  const noData = summary.totalAcceptances === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="font-display text-2xl font-bold">Статистика рецептов</h1>
        <Button variant="outline" size="sm" onClick={() => navigate("recipes")}>
          <ChefIcon className="h-4 w-4 mr-2" />
          К рецептам
        </Button>
      </div>

      {/* === Сводка === */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <ChefHat className="h-4 w-4 text-primary" />
            <span className="text-xs text-muted-foreground">Подтверждено рецептов</span>
          </div>
          <div className="font-display text-2xl font-bold">{summary.activeAcceptances}</div>
          <div className="text-xs text-muted-foreground mt-1">
            из {summary.totalAcceptances} всего
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <ShoppingBag className="h-4 w-4 text-emerald-600" />
            <span className="text-xs text-muted-foreground">Заказов через рецепты</span>
          </div>
          <div className="font-display text-2xl font-bold">{summary.totalOrdersViaRecipes}</div>
          <div className="text-xs text-muted-foreground mt-1">
            за всё время
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Coins className="h-4 w-4 text-amber-600" />
            <span className="text-xs text-muted-foreground">Выручка с рецептов</span>
          </div>
          <div className="font-display text-2xl font-bold text-amber-700">
            {formatCurrency(summary.totalRevenueFromRecipes)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            средний чек: {formatCurrency(summary.avgCheck)}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Target className="h-4 w-4 text-purple-600" />
            <span className="text-xs text-muted-foreground">Конверсия</span>
          </div>
          <div className="font-display text-2xl font-bold text-purple-700">
            {summary.conversionRate}%
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            заказов на 1 подтверждение
          </div>
        </Card>
      </div>

      {noData ? (
        <Card className="p-8 text-center">
          <ChefHat className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-40" />
          <h3 className="font-display text-lg font-bold mb-2">Пока нет подтверждённых рецептов</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Откройте любой рецепт на маркетплейсе и нажмите «Подтвердить готовность».
            После этого ваш профиль появится в списке кондитеров, готовых испечь
            этот рецепт — и вы начнёте получать заказы.
          </p>
          <Button onClick={() => navigate("recipes")}>
            <ChefIcon className="h-4 w-4 mr-2" />
            Перейти к рецептам
          </Button>
        </Card>
      ) : (
        <>
          {/* === Графики === */}
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Топ рецептов по заказам */}
            <Card className="p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Award className="h-4 w-4 text-primary" />
                Топ рецептов по числу заказов
              </h3>
              {data.topRecipes.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.topRecipes.slice(0, 6)} layout="vertical" margin={{ left: 20, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.90 0.015 70)" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="title" tick={{ fontSize: 10 }} width={120} />
                    <Tooltip
                      formatter={(v: number) => [`${v} заказов`, "Заказы"]}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Bar dataKey="ordersCount" fill="#b8492e" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
                  Пока нет заказов по подтверждённым рецептам
                </div>
              )}
            </Card>

            {/* Сложность подтверждённых рецептов */}
            <Card className="p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Flame className="h-4 w-4 text-primary" />
                Сложность подтверждённых рецептов
              </h3>
              {(() => {
                const dist: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
                data.acceptances.forEach(a => {
                  const d = a.recipeDifficulty || "easy";
                  dist[d] = (dist[d] || 0) + 1;
                });
                const pieData = Object.entries(dist)
                  .filter(([_, v]) => v > 0)
                  .map(([k, v]) => ({
                    name: DIFFICULTY_LABELS[k]?.label || k,
                    value: v,
                  }));
                if (pieData.length === 0) {
                  return (
                    <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
                      Нет данных
                    </div>
                  );
                }
                return (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        dataKey="value"
                        label={(e: any) => `${e.name}: ${e.value}`}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                );
              })()}
            </Card>
          </div>

          {/* === Топ рецептов таблицей === */}
          {data.topRecipes.length > 0 && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Лучшие рецепты по заказам
              </h3>
              <div className="space-y-2">
                {data.topRecipes.map((r, i) => {
                  const diff = DIFFICULTY_LABELS[r.difficulty] || DIFFICULTY_LABELS.easy;
                  return (
                    <div
                      key={r.recipeId}
                      className="flex items-center gap-3 p-2 border border-border rounded hover:border-primary/30 cursor-pointer transition-colors"
                      onClick={() => navigate("recipe-detail", { id: r.recipeId })}
                    >
                      <div className="font-display font-bold text-lg text-muted-foreground w-6 text-center">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{r.title}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <Badge className={diff.color + " text-[10px]"}>{diff.label}</Badge>
                          <span>•</span>
                          <Clock className="h-3 w-3" />
                          <span>{(r.prepTime || 0) + (r.cookTime || 0)} мин</span>
                          <span>•</span>
                          <Coins className="h-3 w-3" />
                          <span>от {formatCurrency(r.priceFrom)}</span>
                          <span>•</span>
                          <span>{r.prepDays} дн</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-display font-bold text-primary">{r.ordersCount}</div>
                        <div className="text-[10px] text-muted-foreground">заказов</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* === Последние заказы через рецепты === */}
          {data.recentOrders.length > 0 && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-primary" />
                Последние заказы через рецепты
              </h3>
              <div className="space-y-2">
                {data.recentOrders.map((o: any) => (
                  <div
                    key={o.orderId}
                    className="flex items-center gap-3 p-2 border border-border rounded"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {o.recipeTitle}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {typeof o.createdAt === "string" ? o.createdAt : formatDate(o.createdAt)}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {o.status}
                    </Badge>
                    <div className="font-semibold text-sm shrink-0">
                      {formatCurrency(o.total || 0)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* === Все подтверждённые рецепты === */}
          <Card className="p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <ChefHat className="h-4 w-4 text-primary" />
              Все подтверждённые рецепты ({data.acceptances.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {data.acceptances.map((a: any) => {
                const diff = DIFFICULTY_LABELS[a.recipeDifficulty] || DIFFICULTY_LABELS.easy;
                return (
                  <div
                    key={a.acceptanceId}
                    className="flex gap-3 p-3 border border-border rounded hover:border-primary/30 cursor-pointer transition-colors"
                    onClick={() => navigate("recipe-detail", { id: a.recipeId })}
                  >
                    {a.recipeCover && (
                      <img
                        src={a.recipeCover}
                        alt={a.recipeTitle}
                        className="h-14 w-14 rounded object-cover shrink-0"
                        loading="lazy"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{a.recipeTitle}</div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1 flex-wrap">
                        <Badge className={diff.color + " text-[10px]"}>{diff.label}</Badge>
                        <span>от {formatCurrency(a.priceFrom)}</span>
                        <span>•</span>
                        <span>{a.prepDays} дн</span>
                        <span>•</span>
                        <Users className="h-3 w-3" />
                        <span>{a.ordersCount} заказов</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
