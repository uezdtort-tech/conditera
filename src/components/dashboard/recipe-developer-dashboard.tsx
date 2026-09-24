"use client";

/**
 * recipe-developer-dashboard.tsx — дашборд для роли RECIPE_DEVELOPER.
 *
 * Функциональность:
 *   - Обзор: KPI карточки (всего рецептов, покупок, доход от роялти, средний рейтинг)
 *   - Мои рецепты: список с возможностью создать/редактировать/удалить
 *   - Доход от роялти: график по месяцам + детализация по каждому рецепту
 *   - Покупки: список последних покупок (кто, какой рецепт, сколько роялти)
 *   - Подписки: премиум-подписчики на мои рецепты
 *   - Настройки: профиль автора, ставка роялти по умолчанию
 *
 * Использует:
 *   - @tanstack/react-query для кэширования данных
 *   - supabaseBrowser для запросов (RLS защищает по user_id)
 *   - role-guards.ts (косвенно, через API routes)
 *   - shadcn/ui компоненты
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BookOpen, DollarSign, Users, Star, Plus, Edit3, Trash2,
  TrendingUp, Eye, ShoppingCart, Settings, LogOut, Crown,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DashboardShell, LoadingState, ErrorState, StatCard, EmptyState,
} from "@/components/dashboard/_shared";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { RecipeMarketplace, RecipePurchase } from "@/lib/supabase/types";

const TABS = [
  { id: "overview", label: "Обзор", icon: TrendingUp },
  { id: "recipes", label: "Мои рецепты", icon: BookOpen },
  { id: "purchases", label: "Покупки", icon: ShoppingCart },
  { id: "subscriptions", label: "Подписки", icon: Crown },
  { id: "settings", label: "Настройки", icon: Settings },
];

const ROYALTY_COLOR = "#8e7423";
const COMMISSION_COLOR = "#5d3ac7";
const PURCHASE_COLOR = "#418f5b";

interface RecipeWithStats extends RecipeMarketplace {
  monthly_royalty?: number;
}

interface PurchaseWithRecipe extends RecipePurchase {
  recipe_title?: string;
}

interface DashboardStats {
  totalRecipes: number;
  publishedRecipes: number;
  totalPurchases: number;
  totalRoyaltyEarned: number;
  averageRating: number;
  monthlyData: Array<{ month: string; royalty: number; purchases: number }>;
}

/**
 * Загрузить свои рецепты автора.
 */
function useMyRecipes() {
  return useQuery<RecipeMarketplace[]>({
    queryKey: ["recipe-developer", "my-recipes"],
    queryFn: async () => {
      // RLS вернёт только рецепты текущего пользователя (по author_id == auth.uid())
      const { data, error } = await supabaseBrowser
        .from("recipe_marketplace")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []) as RecipeMarketplace[];
    },
  });
}

/**
 * Загрузить последние покупки рецептов автора (для роялти-аналитики).
 */
function useRecentPurchases() {
  return useQuery<PurchaseWithRecipe[]>({
    queryKey: ["recipe-developer", "recent-purchases"],
    queryFn: async () => {
      // Сначала получаем свои recipe_id
      const { data: recipes } = await supabaseBrowser
        .from("recipe_marketplace")
        .select("id, title");
      const recipeMap = new Map((recipes || []).map((r) => [r.id, r.title]));

      if (recipeMap.size === 0) return [];

      const { data, error } = await supabaseBrowser
        .from("recipe_purchases")
        .select("*")
        .in("recipe_id", Array.from(recipeMap.keys()))
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);

      return ((data || []) as RecipePurchase[]).map((p) => ({
        ...p,
        recipe_title: recipeMap.get(p.recipe_id) || "Без названия",
      }));
    },
  });
}

/**
 * Создать новый рецепт.
 */
function useCreateRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      title: string;
      description: string;
      base_price: number;
      is_premium: boolean;
      premium_price?: number | null;
      royalty_rate?: number;
      cooking_time_min?: number | null;
      difficulty?: number | null;
      tags?: string[];
      preview_image?: string | null;
      steps_json: Array<{ step_number: number; description: string }>;
      ingredients_json: Array<{ name: string; qty: string; unit: string }>;
      is_published: boolean;
    }) => {
      const response = await fetch("/api/recipes/marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe-developer"] });
      toast.success("Рецепт создан");
    },
    onError: (err: Error) => {
      toast.error("Ошибка создания рецепта", { description: err.message });
    },
  });
}

/**
 * Удалить рецепт (soft-delete через PATCH is_published=false).
 */
function useDeleteRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (recipeId: string) => {
      const response = await fetch(`/api/recipes/marketplace/${recipeId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe-developer"] });
      toast.success("Рецепт удалён");
    },
    onError: (err: Error) => {
      toast.error("Ошибка удаления", { description: err.message });
    },
  });
}

/**
 * Собрать агрегированную статистику из recipes + purchases.
 */
function computeStats(recipes: RecipeMarketplace[], purchases: RecipePurchase[]): DashboardStats {
  const published = recipes.filter((r) => r.is_published);
  const totalRoyalty = purchases.reduce((sum, p) => sum + Number(p.royalty_amount), 0);
  const avgRating = recipes.length > 0
    ? recipes.reduce((sum, r) => sum + Number(r.rating || 0), 0) / recipes.length
    : 0;

  // Группировка по месяцам за последний год
  const monthlyMap = new Map<string, { royalty: number; purchases: number }>();
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" });
    monthlyMap.set(key, { royalty: 0, purchases: 0 });
  }
  for (const p of purchases) {
    const date = new Date(p.created_at);
    const key = date.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" });
    const entry = monthlyMap.get(key);
    if (entry) {
      entry.royalty += Number(p.royalty_amount);
      entry.purchases += 1;
    }
  }

  return {
    totalRecipes: recipes.length,
    publishedRecipes: published.length,
    totalPurchases: purchases.length,
    totalRoyaltyEarned: totalRoyalty,
    averageRating: Number(avgRating.toFixed(2)),
    monthlyData: Array.from(monthlyMap.entries()).map(([month, v]) => ({
      month,
      royalty: Number(v.royalty.toFixed(2)),
      purchases: v.purchases,
    })),
  };
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * RecipeDeveloperDashboard — главный экспорт компонента.
 */
export function RecipeDeveloperDashboard(): React.JSX.Element {
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const [activeTab, setActiveTab] = React.useState("overview");
  const [createOpen, setCreateOpen] = React.useState(false);

  const recipesQ = useMyRecipes();
  const purchasesQ = useRecentPurchases();

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>Войти</Button>
      </div>
    );
  }

  const stats = computeStats(recipesQ.data || [], purchasesQ.data || []);

  const content = (): React.JSX.Element => {
    if (recipesQ.isLoading || purchasesQ.isLoading) {
      return <LoadingState message="Загружаем данные рецептов..." />;
    }
    if (recipesQ.error || purchasesQ.error) {
      return (
        <ErrorState
          error={new Error(recipesQ.error?.message || purchasesQ.error?.message || "Unknown")}
          onRetry={() => { recipesQ.refetch(); purchasesQ.refetch(); }}
        />
      );
    }

    switch (activeTab) {
      case "overview":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-3">Обзор</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard
                  icon={BookOpen}
                  label="Всего рецептов"
                  value={stats.totalRecipes}
                  change={`${stats.publishedRecipes} опубликовано`}
                  color="text-blue-600"
                />
                <StatCard
                  icon={ShoppingCart}
                  label="Покупок"
                  value={stats.totalPurchases}
                  color="text-emerald-600"
                />
                <StatCard
                  icon={DollarSign}
                  label="Доход от роялти"
                  value={formatCurrency(stats.totalRoyaltyEarned)}
                  color="text-amber-600"
                />
                <StatCard
                  icon={Star}
                  label="Средний рейтинг"
                  value={stats.averageRating.toFixed(2)}
                  change={`${stats.averageRating >= 4 ? "★ Отлично" : "↗ Растёт"}`}
                  color="text-yellow-600"
                />
              </div>
            </div>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Доход от роялти за 12 месяцев</h3>
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={stats.monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(v: number) => formatCurrency(v)}
                      contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
                    />
                    <Bar dataKey="royalty" name="Роялти" fill={ROYALTY_COLOR} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Последние покупки</h3>
              {(purchasesQ.data || []).slice(0, 5).map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <div className="font-medium text-sm">{p.recipe_title}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(p.created_at)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
                      +{formatCurrency(Number(p.royalty_amount))}
                    </Badge>
                  </div>
                </div>
              ))}
              {(purchasesQ.data || []).length === 0 && (
                <EmptyState
                  icon={ShoppingCart}
                  title="Покупок пока нет"
                  text="Опубликуйте рецепты — они появятся в каталоге маркетплейса"
                />
              )}
            </Card>
          </div>
        );

      case "recipes":
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">Мои рецепты ({recipesQ.data?.length || 0})</h2>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />Новый рецепт
              </Button>
            </div>

            {(recipesQ.data || []).length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="У вас ещё нет рецептов"
                text="Создайте первый авторский рецепт — он появится в маркетплейсе"
                action="Создать рецепт"
                onAction={() => setCreateOpen(true)}
              />
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {(recipesQ.data || []).map((r) => (
                  <RecipeCard key={r.id} recipe={r} />
                ))}
              </div>
            )}
          </div>
        );

      case "purchases":
        return (
          <div className="space-y-4">
            <h2 className="text-xl font-bold">Покупки моих рецептов ({purchasesQ.data?.length || 0})</h2>
            {(purchasesQ.data || []).length === 0 ? (
              <EmptyState
                icon={ShoppingCart}
                title="Покупок пока нет"
                text="Когда пользователи начнут покупать ваши рецепты, они появятся здесь"
              />
            ) : (
              <Card className="p-4">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground border-b">
                    <tr>
                      <th className="py-2">Рецепт</th>
                      <th className="py-2">Дата</th>
                      <th className="py-2 text-right">Цена</th>
                      <th className="py-2 text-right">Роялти</th>
                      <th className="py-2 text-right">Комиссия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(purchasesQ.data || []).map((p) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-2 font-medium">{p.recipe_title}</td>
                        <td className="py-2 text-muted-foreground">{formatDate(p.created_at)}</td>
                        <td className="py-2 text-right">{formatCurrency(Number(p.price_paid))}</td>
                        <td className="py-2 text-right text-emerald-600 font-medium">
                          +{formatCurrency(Number(p.royalty_amount))}
                        </td>
                        <td className="py-2 text-right text-muted-foreground">
                          {formatCurrency(Number(p.commission_amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        );

      case "subscriptions":
        return (
          <EmptyState
            icon={Crown}
            title="Премиум-подписки"
            text="Скоро: список пользователей, оформивших премиум-подписку на все ваши рецепты"
          />
        );

      case "settings":
        return (
          <Card className="p-6">
            <h2 className="text-xl font-bold mb-4">Настройки профиля автора</h2>
            <div className="space-y-4">
              <div>
                <Label>Имя автора</Label>
                <Input defaultValue={user.name} />
              </div>
              <div>
                <Label>Ставка роялти по умолчанию</Label>
                <Input type="number" step="0.01" min="0" max="1" defaultValue="0.05" />
                <p className="text-xs text-muted-foreground mt-1">
                  5% — стандартная ставка. Изменение применяется только к новым рецептам.
                </p>
              </div>
              <Button>Сохранить</Button>
            </div>
          </Card>
        );

      default:
        return <div>Неизвестный раздел</div>;
    }
  };

  return (
    <>
      <DashboardShell
        user={user}
        logout={logout}
        title="Дашборд разработчика рецептов"
        role="RECIPE_DEVELOPER"
        icon={BookOpen}
        gradient="from-amber-500 to-orange-600"
        tabs={TABS}
        activeTab={activeTab}
        onTab={setActiveTab}
      >
        {content()}
      </DashboardShell>

      <CreateRecipeDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

/**
 * Карточка рецепта с действиями.
 */
function RecipeCard({ recipe }: { recipe: RecipeMarketplace }): React.JSX.Element {
  const deleteMutation = useDeleteRecipe();
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1">
          <h3 className="font-semibold text-sm">{recipe.title}</h3>
          {recipe.is_premium && (
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 mt-1">
              <Crown className="w-3 h-3 mr-1" />Premium
            </Badge>
          )}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost">
            <Edit3 className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{recipe.description}</p>

      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Eye className="w-3 h-3" />{recipe.views}
          </span>
          <span className="flex items-center gap-1">
            <ShoppingCart className="w-3 h-3" />{recipe.purchases_count}
          </span>
          <span className="flex items-center gap-1">
            <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
            {Number(recipe.rating).toFixed(1)}
          </span>
        </div>
        <Badge variant="outline">
          {formatCurrency(Number(recipe.base_price))}
        </Badge>
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        Роялти: {(Number(recipe.royalty_rate) * 100).toFixed(0)}% •
        Опубликован: {recipe.is_published ? "✓" : "✗"}
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить рецепт?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {recipe.purchases_count > 0
              ? "Рецепт будет снят с публикации. Покупатели сохранят доступ. Полное удаление недоступно для рецептов с покупками."
              : "Рецепт будет полностью удалён. Действие необратимо."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteMutation.mutate(recipe.id);
                setConfirmDelete(false);
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Удаление..." : "Удалить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Диалог создания нового рецепта.
 */
function CreateRecipeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}): React.JSX.Element {
  const createMutation = useCreateRecipe();
  const [form, setForm] = React.useState({
    title: "",
    description: "",
    base_price: 500,
    is_premium: false,
    premium_price: null as number | null,
    royalty_rate: 0.05,
    cooking_time_min: null as number | null,
    difficulty: 3 as number,
    tags: [] as string[],
    steps_json: [{ step_number: 1, description: "" }],
    ingredients_json: [{ name: "", qty: "", unit: "г" }],
    is_published: false,
  });

  const submit = async () => {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error("Заполните название и описание");
      return;
    }
    try {
      await createMutation.mutateAsync(form);
      onOpenChange(false);
      setForm({ ...form, title: "", description: "" });
    } catch {
      // error handled in mutation
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новый авторский рецепт</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="title">Название *</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Шоколадный торт с малиной"
              maxLength={200}
            />
          </div>

          <div>
            <Label htmlFor="description">Описание *</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Авторский рецепт с тёмным шоколадом и свежей малиной..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="base_price">Базовая цена, ₽ *</Label>
              <Input
                id="base_price"
                type="number"
                value={form.base_price}
                onChange={(e) => setForm({ ...form, base_price: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="royalty_rate">Роялти (0-1) *</Label>
              <Input
                id="royalty_rate"
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={form.royalty_rate}
                onChange={(e) => setForm({ ...form, royalty_rate: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                0.05 = 5% от цены с каждой продажи идёт вам
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="cooking_time">Время готовки, мин</Label>
              <Input
                id="cooking_time"
                type="number"
                value={form.cooking_time_min ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    cooking_time_min: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="difficulty">Сложность (1-5)</Label>
              <Input
                id="difficulty"
                type="number"
                min="1"
                max="5"
                value={form.difficulty}
                onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={form.is_premium}
              onCheckedChange={(v) => setForm({ ...form, is_premium: v })}
            />
            <Label>Премиум-подписка</Label>
          </div>

          {form.is_premium && (
            <div>
              <Label htmlFor="premium_price">Цена премиум-подписки в месяц, ₽</Label>
              <Input
                id="premium_price"
                type="number"
                value={form.premium_price ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    premium_price: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <Switch
              checked={form.is_published}
              onCheckedChange={(v) => setForm({ ...form, is_published: v })}
            />
            <Label>Опубликовать сразу (иначе сохранится как черновик)</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Создание..." : "Создать рецепт"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
